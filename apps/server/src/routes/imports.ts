import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { zValidator } from "../lib/validate";
import { dateString, importRowUpdate, normalizeAlias } from "@fnb/core";
import { prisma, type Tx } from "../db";
import { AppError } from "../lib/errors";
import { logActivity } from "../services/activity";
import { requirePermission, type AppEnv } from "../middleware/auth";
import { parseCsv, parseXlsx, type ParsedRow } from "../services/import-parse";
import { AI_MODEL, extractWithAi, isAiEnabled } from "../services/import-extract";
import { matchRows } from "../services/import-match";
import { describeSniff, looksLikeText, sniffFileType } from "../services/file-type";

const uploadGuard = requirePermission("imports.upload");
const commitGuard = requirePermission("imports.commit");
const MAX_BYTES = 20 * 1024 * 1024;

const here = path.dirname(fileURLToPath(import.meta.url));
/**
 * Beside the code on the hosted server; overridden on the desktop.
 *
 * A packaged install lives in Program Files, which is read-only for the account
 * running it — resolving uploads relative to the bundle would put every AI
 * import one permission error away from failing. The desktop points this at the
 * per-user data directory instead.
 */
const uploadsDir = process.env.FNB_UPLOADS_DIR
  ? path.resolve(process.env.FNB_UPLOADS_DIR)
  : path.resolve(here, "..", "..", "data", "uploads");

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Which parser this file goes to — decided by its BYTES, with the filename as a
 * hint of last resort.
 *
 * The name and MIME type both come from the caller, so choosing a parser from
 * them alone let the caller choose the parser. Sniffing first means a PDF named
 * `sales.csv` reaches the PDF path (or is refused) rather than being fed to the
 * CSV reader as text.
 *
 * The extension still decides between the formats bytes cannot separate — XLSX
 * and any other Zip look identical until something opens the archive — and it
 * is the only signal available for CSV, which has no magic number at all.
 */
function detectSource(
  fileName: string,
  mime: string,
  bytes: Buffer,
): { sourceType: "CSV" | "XLSX" | "PDF" | "IMAGE"; mediaType: string } {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const sniffed = sniffFileType(bytes);

  // Bytes first, and they are conclusive for these.
  if (sniffed === "PDF") return { sourceType: "PDF", mediaType: "application/pdf" };
  if (sniffed === "PNG") return { sourceType: "IMAGE", mediaType: "image/png" };
  if (sniffed === "JPEG") return { sourceType: "IMAGE", mediaType: "image/jpeg" };
  if (sniffed === "GIF") return { sourceType: "IMAGE", mediaType: "image/gif" };
  if (sniffed === "WEBP") return { sourceType: "IMAGE", mediaType: "image/webp" };

  // A Zip container. Only the extension can say whether it is a spreadsheet.
  if (sniffed === "ZIP") {
    if (ext === "xlsx" || ext === "xls") return { sourceType: "XLSX", mediaType: mime };
    throw new AppError(400, "That looks like a Zip archive. Upload the CSV, Excel, PDF or image itself.");
  }

  // No magic number matched, so it is either text or something unknown.
  if (ext === "csv" || mime === "text/csv") {
    if (!looksLikeText(bytes)) {
      throw new AppError(400, `That file is named .csv but its contents are ${describeSniff(sniffed)}.`);
    }
    return { sourceType: "CSV", mediaType: "text/csv" };
  }

  /**
   * The name claims a binary format the bytes did not confirm. Refused rather
   * than passed through: the previous behaviour handed it to that format's
   * parser anyway, which is the exact assumption being removed.
   */
  if (["xlsx", "xls", "pdf", "png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
    throw new AppError(
      400,
      `That file is named .${ext} but its contents don't match. It may be renamed or corrupted — re-export it and try again.`,
    );
  }

  throw new AppError(400, "Unsupported file type. Use CSV, Excel, PDF, or an image.");
}

async function getBatch(locationId: string, batchId: string) {
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.locationId !== locationId) throw new AppError(404, "Import batch not found");
  return batch;
}

export const importRoutes = new Hono<AppEnv>()
  .get("/imports", uploadGuard, async (c) => {
    const location = c.get("location");
    const batches = await prisma.importBatch.findMany({
      where: { locationId: location.id },
      include: { _count: { select: { rows: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return c.json(batches);
  })

  .post("/imports", uploadGuard, async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const body = await c.req.parseBody();

    const kind = String(body.kind ?? "");
    if (!["SALES", "PURCHASES", "NON_REVENUE"].includes(kind)) {
      throw new AppError(400, "Choose an import type: SALES, PURCHASES, or NON_REVENUE");
    }
    // This route is multipart, so zod never sees the body and this was the one
    // unvalidated business date on the server. It persists to
    // `ImportBatch.businessDate` and becomes the commit-time fallback
    // `saleDate`/`purchaseDate`, so an impossible day here silently produces
    // committed sales that fall outside every audit window — see the note on
    // `dateString`, which now rejects the calendar-impossible ones too.
    let businessDate: string | null = null;
    if (body.businessDate !== undefined && String(body.businessDate) !== "") {
      const parsed = dateString.safeParse(String(body.businessDate));
      if (!parsed.success) throw new AppError(400, "Enter the date as YYYY-MM-DD.");
      businessDate = parsed.data;
    }

    const file = body.file;
    if (!(file instanceof File)) throw new AppError(400, "No file uploaded");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0) throw new AppError(400, "The file is empty");
    if (bytes.length > MAX_BYTES) throw new AppError(413, "File too large (max 20 MB)");

    const { sourceType, mediaType } = detectSource(file.name, file.type, bytes);
    if ((sourceType === "PDF" || sourceType === "IMAGE") && !isAiEnabled()) {
      throw new AppError(400, "PDF and image import needs the AI extractor. Add ANTHROPIC_API_KEY to enable it — CSV and Excel work without it.");
    }

    let rows: ParsedRow[];
    let extractor: "DETERMINISTIC" | "AI" = "DETERMINISTIC";
    let rawExtract: string | null = null;
    let model: string | null = null;
    let extractWarnings: string[] = [];

    if (sourceType === "CSV") {
      rows = parseCsv(bytes.toString("utf-8"));
    } else if (sourceType === "XLSX") {
      rows = await parseXlsx(bytes);
    } else {
      const out = await extractWithAi(bytes, mediaType, sourceType, kind);
      rows = out.rows;
      rawExtract = out.raw;
      extractWarnings = out.warnings;
      extractor = "AI";
      model = AI_MODEL;
    }
    if (rows.length === 0) throw new AppError(400, "No line items found in the file.");

    const sha = createHash("sha256").update(bytes).digest("hex");
    mkdirSync(uploadsDir, { recursive: true });
    const storedPath = path.join(uploadsDir, `${sha}.${sourceType.toLowerCase()}`);
    writeFileSync(storedPath, bytes);

    const matches = await matchRows(location.clientId, location.id, kind, rows);

    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.importBatch.create({
        data: {
          locationId: location.id,
          kind,
          fileName: file.name,
          fileSha256: sha,
          storedPath,
          sourceType,
          extractor,
          model,
          rawExtractJson: rawExtract,
          status: "NEEDS_REVIEW",
          businessDate,
          createdById: user.id,
          createdByName: `${user.firstName} ${user.lastName}`,
          rows: {
            create: rows.map((row, i) => {
              const m = matches[i]!;
              return {
                rowIndex: i,
                rawJson: JSON.stringify(row.raw),
                itemText: row.itemText,
                qty: row.qty,
                unitCost: row.unitCost,
                unitPrice: row.unitPrice,
                rowDate: row.rowDate,
                matchedLocationItemId: m.matchedLocationItemId,
                matchedMenuItemId: m.matchedMenuItemId,
                matchMethod: m.matchMethod,
                confidence: m.confidence,
                warning: m.warning,
                status: m.suggestedStatus,
              };
            }),
          },
        },
      });
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "import.upload", entity: "ImportBatch", entityId: created.id, summary: `Uploaded ${file.name} — ${rows.length} ${rows.length === 1 ? "row" : "rows"} (${kind}, ${extractor})` },
        tx,
      );
      return created;
    });

    return c.json({ id: batch.id, warnings: extractWarnings }, 201);
  })

  .get("/imports/:batchId", uploadGuard, async (c) => {
    const location = c.get("location");
    const batch = await prisma.importBatch.findUnique({
      where: { id: c.req.param("batchId") },
      include: { rows: { orderBy: { rowIndex: "asc" } } },
    });
    if (!batch || batch.locationId !== location.id) throw new AppError(404, "Import batch not found");
    return c.json(batch);
  })

  .put("/imports/:batchId/rows/:rowId", uploadGuard, zValidator("json", importRowUpdate), async (c) => {
    const location = c.get("location");
    const batch = await getBatch(location.id, c.req.param("batchId"));
    if (batch.status !== "NEEDS_REVIEW") throw new AppError(409, "This batch is no longer editable");

    const body = c.req.valid("json");
    const row = await prisma.importRow.findUnique({ where: { id: c.req.param("rowId") } });
    if (!row || row.batchId !== batch.id) throw new AppError(404, "Row not found");

    // A reviewer may only point a row at something this location owns. Checked
    // here as well as at commit: commit is the gate that protects the ledger,
    // but a wrong match accepted here sits in the review table looking approved
    // until someone tries to commit the whole batch and gets it rejected.
    if (body.matchedLocationItemId) {
      const target = await prisma.locationItem.findUnique({
        where: { id: body.matchedLocationItemId },
        select: { locationId: true },
      });
      if (!target || target.locationId !== location.id) {
        throw new AppError(404, "Item not found in this catalog");
      }
    }
    if (body.matchedMenuItemId) {
      const target = await prisma.menuItem.findUnique({
        where: { id: body.matchedMenuItemId },
        select: { locationId: true },
      });
      if (!target || target.locationId !== location.id) throw new AppError(404, "Menu item not found");
    }

    const data: Record<string, unknown> = { ...body };
    // A manual match is exclusive (item XOR menu) and marks the row MANUAL.
    if (body.matchedLocationItemId !== undefined) {
      data.matchedLocationItemId = body.matchedLocationItemId;
      data.matchedMenuItemId = null;
      data.matchMethod = "MANUAL";
      data.confidence = 1;
      data.warning = null;
    } else if (body.matchedMenuItemId !== undefined) {
      data.matchedMenuItemId = body.matchedMenuItemId;
      data.matchedLocationItemId = null;
      data.matchMethod = "MANUAL";
      data.confidence = 1;
      data.warning = null;
    }
    // Logged, in the same transaction as the write.
    //
    // This is the human-review step CLAUDE.md singles out — "imports/AI never
    // mutate inventory without human review" — and it was the one part of that
    // promise with no evidence behind it. Only the batch-level `import.commit`
    // was recorded, so "who approved this row, and did they change the quantity
    // on the way through?" had no answer. Only fields that actually moved are
    // recorded, so re-saving an untouched row does not fill the trail with
    // no-ops.
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, next] of Object.entries(data)) {
      const before = (row as Record<string, unknown>)[key];
      if (before !== next) changed[key] = { from: before, to: next };
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.importRow.update({ where: { id: row.id }, data });
      if (Object.keys(changed).length > 0) {
        await logActivity(
          {
            user: c.get("user")!, clientId: location.clientId, locationId: location.id,
            action: "importRow.review", entity: "ImportRow", entityId: row.id,
            summary: `Reviewed import row "${row.itemText}"${changed.status ? ` — ${String(changed.status.to).toLowerCase()}` : ""}`,
            details: { batchId: batch.id, changed },
          },
          tx,
        );
      }
      return saved;
    });
    return c.json(updated);
  })

  .post("/imports/:batchId/commit", commitGuard, async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const batch = await getBatch(location.id, c.req.param("batchId"));
    if (batch.status !== "NEEDS_REVIEW") throw new AppError(409, "This batch has already been committed or reversed");

    const approved = await prisma.importRow.findMany({
      where: { batchId: batch.id, status: "APPROVED" },
      orderBy: { rowIndex: "asc" },
    });
    if (approved.length === 0) throw new AppError(400, "Approve at least one row before committing");
    for (const row of approved) {
      if (!row.matchedLocationItemId && !row.matchedMenuItemId) throw new AppError(400, `Row "${row.itemText}" has no matched item`);
      if (!row.qty || row.qty <= 0) throw new AppError(400, `Row "${row.itemText}" needs a quantity`);
    }

    // Price/cost/version lookups for the approved rows.
    const liIds = approved.map((r) => r.matchedLocationItemId).filter((x): x is string => Boolean(x));
    const menuIds = approved.map((r) => r.matchedMenuItemId).filter((x): x is string => Boolean(x));
    // Scoped to THIS location. Unscoped, a `matchedLocationItemId` pointing at
    // another establishment's catalog resolved fine here and was written
    // straight onto the committed SaleRecord/PurchaseLine, taking its price
    // from the foreign row.
    const [locationItems, menus] = await Promise.all([
      prisma.locationItem.findMany({ where: { id: { in: liIds }, locationId: location.id } }),
      prisma.menuItem.findMany({
        where: { id: { in: menuIds }, locationId: location.id },
        include: { versions: { take: 1, orderBy: { versionNo: "desc" } } },
      }),
    ]);
    const liMap = new Map(locationItems.map((li) => [li.id, li]));
    const menuMap = new Map(menus.map((m) => [m.id, m]));

    // Scoping alone would not be enough. Both price lookups below fall back to
    // zero on a miss (`li?.retail ?? 0`, `li?.cost ?? 0`), so a filtered-out row
    // would have committed silently at ₱0 instead of leaking — trading a
    // cross-tenant read for corrupt figures in the reconciliation. Fail loudly
    // instead: if a match no longer resolves inside this location, the batch
    // does not commit.
    for (const row of approved) {
      if (row.matchedLocationItemId && !liMap.has(row.matchedLocationItemId)) {
        throw new AppError(400, `Row "${row.itemText}" is matched to an item that isn't in this location's catalog — re-match it before committing.`);
      }
      if (row.matchedMenuItemId && !menuMap.has(row.matchedMenuItemId)) {
        throw new AppError(400, `Row "${row.itemText}" is matched to a menu item that isn't in this location — re-match it before committing.`);
      }
    }

    const encoder = { createdById: user.id, createdByName: `${user.firstName} ${user.lastName}` };
    const fallbackDate = batch.businessDate ?? today();

    let committed = 0;
    await prisma.$transaction(async (tx) => {
      if (batch.kind === "PURCHASES") {
        await commitPurchases(tx, batch, approved, liMap, encoder, fallbackDate, user, location);
      } else {
        await commitSales(tx, batch, approved, liMap, menuMap, encoder, fallbackDate, user, location);
      }
      // Alias write-back so re-imports auto-match (skip EXACT — already a catalog name).
      for (const row of approved) {
        if (row.matchMethod === "EXACT") continue;
        const alias = normalizeAlias(row.itemText);
        await tx.itemAlias.upsert({
          where: { clientId_aliasNormalized: { clientId: location.clientId, aliasNormalized: alias } },
          update: { locationItemId: row.matchedLocationItemId, menuItemId: row.matchedMenuItemId, source: "IMPORT" },
          create: { clientId: location.clientId, aliasNormalized: alias, locationItemId: row.matchedLocationItemId, menuItemId: row.matchedMenuItemId, source: "IMPORT" },
        });
      }
      committed = approved.length;
      await tx.importBatch.update({
        where: { id: batch.id },
        data: { status: "COMMITTED", committedAt: new Date(), committedById: user.id },
      });
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "import.commit", entity: "ImportBatch", entityId: batch.id, summary: `Committed ${committed} rows from ${batch.fileName}` },
        tx,
      );
    });

    return c.json({ committed });
  })

  .post("/imports/:batchId/reverse", commitGuard, async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const batch = await getBatch(location.id, c.req.param("batchId"));
    if (batch.status !== "COMMITTED") throw new AppError(409, "Only a committed batch can be reversed");

    const rows = await prisma.importRow.findMany({ where: { batchId: batch.id, resultId: { not: null } } });
    const reason = `Import batch ${batch.fileName} reversed`;

    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        if (row.resultType === "SALE") {
          await tx.saleRecord.updateMany({
            where: { id: row.resultId!, status: "ACTIVE" },
            data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: reason },
          });
        } else if (row.resultType === "PURCHASE_LINE") {
          await tx.purchaseLine.updateMany({
            where: { id: row.resultId!, status: "ACTIVE" },
            data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: reason },
          });
        }
      }
      await tx.importBatch.update({
        where: { id: batch.id },
        data: { status: "REVERSED", reversedAt: new Date(), reversedById: user.id },
      });
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "import.reverse", entity: "ImportBatch", entityId: batch.id, summary: `Reversed import ${batch.fileName} (${rows.length} records voided)` },
        tx,
      );
    });

    return c.json({ reversed: rows.length });
  });

type ApprovedRow = Awaited<ReturnType<typeof prisma.importRow.findMany>>[number];
type Encoder = { createdById: string; createdByName: string };

async function commitSales(
  tx: Tx,
  batch: { id: string; kind: string },
  rows: ApprovedRow[],
  liMap: Map<string, { id: string; retail: number }>,
  menuMap: Map<string, { id: string; versions: Array<{ id: string; srp: number }> }>,
  encoder: Encoder,
  fallbackDate: string,
  user: { id: string },
  location: { id: string; clientId: string },
) {
  const kind = batch.kind === "NON_REVENUE" ? "NON_REVENUE" : "SALE";
  for (const row of rows) {
    const saleDate = row.rowDate ?? fallbackDate;
    let unitPrice = row.unitPrice ?? 0;
    let recipeVersionId: string | null = null;

    if (row.matchedMenuItemId) {
      const menu = menuMap.get(row.matchedMenuItemId);
      const version = menu?.versions[0];
      if (!version) throw new AppError(400, `Menu "${row.itemText}" has no published recipe`);
      recipeVersionId = version.id;
      if (row.unitPrice == null) unitPrice = kind === "SALE" ? version.srp : 0;
    } else if (row.matchedLocationItemId) {
      const li = liMap.get(row.matchedLocationItemId);
      if (row.unitPrice == null) unitPrice = kind === "SALE" ? (li?.retail ?? 0) : 0;
    }

    const created = await tx.saleRecord.create({
      data: {
        locationId: location.id,
        saleDate,
        kind,
        locationItemId: row.matchedLocationItemId,
        menuItemId: row.matchedMenuItemId,
        recipeVersionId,
        qty: row.qty!,
        unitPrice: kind === "SALE" ? unitPrice : 0,
        // Only meaningful for non-revenue; a sale has no reason to carry.
        reason: kind === "NON_REVENUE" ? reasonFromRaw(row.rawJson) : null,
        source: "IMPORT",
        ...encoder,
      },
    });
    await tx.importRow.update({ where: { id: row.id }, data: { status: "COMMITTED", resultType: "SALE", resultId: created.id } });
  }
}

/**
 * The reason column out of an imported non-revenue row.
 *
 * Read from `rawJson` — the untouched source row, already stored — rather than
 * a new ImportRow column. The parser deliberately keeps only the five fields
 * every kind shares; a reason belongs to exactly one kind, and adding a column
 * plus a migration to carry it would be schema for one caller's convenience.
 *
 * Without this the reason was simply dropped: their sheet records "Bleed" /
 * "R&D" against every line, and an imported batch produced non-revenue records
 * with `reason: null`, so the Non-Revenue report's whole by-reason breakdown
 * was blank for anything not typed in by hand. `nonRevenueGroupOf` does the
 * folding, so any synonym staff actually write lands in the right bucket.
 */
function reasonFromRaw(rawJson: string | null): string | null {
  if (!rawJson) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    return null;
  }
  const key = Object.keys(raw).find((k) => /reason|purpose|remark/i.test(k));
  const value = key ? String(raw[key] ?? "").trim() : "";
  return value || null;
}

async function commitPurchases(
  tx: Tx,
  batch: { id: string; fileName?: string },
  rows: ApprovedRow[],
  liMap: Map<string, { id: string; cost: number }>,
  encoder: Encoder,
  fallbackDate: string,
  user: { id: string },
  location: { id: string; clientId: string },
) {
  // Group by date → one committed Purchase header per date.
  const byDate = new Map<string, ApprovedRow[]>();
  for (const row of rows) {
    const d = row.rowDate ?? fallbackDate;
    (byDate.get(d) ?? byDate.set(d, []).get(d)!).push(row);
  }
  for (const [purchaseDate, group] of byDate) {
    const purchase = await tx.purchase.create({
      data: {
        locationId: location.id,
        purchaseDate,
        note: `Imported from ${(batch as { fileName?: string }).fileName ?? "file"}`,
        status: "COMMITTED",
        committedAt: new Date(),
        committedById: user.id,
        ...encoder,
      },
    });
    for (const row of group) {
      const li = liMap.get(row.matchedLocationItemId!);
      const unitCost = row.unitCost ?? li?.cost ?? 0;
      const line = await tx.purchaseLine.create({
        data: {
          purchaseId: purchase.id,
          locationItemId: row.matchedLocationItemId!,
          qty: row.qty!,
          unitCost,
          lineTotal: row.qty! * unitCost,
          ...encoder,
        },
      });
      await tx.importRow.update({ where: { id: row.id }, data: { status: "COMMITTED", resultType: "PURCHASE_LINE", resultId: line.id } });
    }
  }
}
