import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { importRowUpdate, normalizeAlias } from "@fnb/core";
import { prisma, type Tx } from "../db";
import { AppError } from "../lib/errors";
import { logActivity } from "../services/activity";
import { requirePermission, type AppEnv } from "../middleware/auth";
import { parseCsv, parseXlsx, type ParsedRow } from "../services/import-parse";
import { AI_MODEL, extractWithAi, isAiEnabled } from "../services/import-extract";
import { matchRows } from "../services/import-match";

const uploadGuard = requirePermission("imports.upload");
const commitGuard = requirePermission("imports.commit");
const MAX_BYTES = 20 * 1024 * 1024;

const here = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(here, "..", "..", "data", "uploads");

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function detectSource(fileName: string, mime: string): { sourceType: "CSV" | "XLSX" | "PDF" | "IMAGE"; mediaType: string } {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || mime === "text/csv") return { sourceType: "CSV", mediaType: "text/csv" };
  if (ext === "xlsx" || ext === "xls") return { sourceType: "XLSX", mediaType: mime };
  if (ext === "pdf" || mime === "application/pdf") return { sourceType: "PDF", mediaType: "application/pdf" };
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
    return { sourceType: "IMAGE", mediaType: ext === "jpg" ? "image/jpeg" : `image/${ext}` };
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
    const businessDate = body.businessDate ? String(body.businessDate) : null;

    const file = body.file;
    if (!(file instanceof File)) throw new AppError(400, "No file uploaded");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0) throw new AppError(400, "The file is empty");
    if (bytes.length > MAX_BYTES) throw new AppError(413, "File too large (max 20 MB)");

    const { sourceType, mediaType } = detectSource(file.name, file.type);
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
        { user, clientId: location.clientId, locationId: location.id, action: "import.upload", entity: "ImportBatch", entityId: created.id, summary: `Uploaded ${file.name} — ${rows.length} rows (${kind}, ${extractor})` },
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
    const updated = await prisma.importRow.update({ where: { id: row.id }, data });
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
    const [locationItems, menus] = await Promise.all([
      prisma.locationItem.findMany({ where: { id: { in: liIds } } }),
      prisma.menuItem.findMany({ where: { id: { in: menuIds } }, include: { versions: { take: 1, orderBy: { versionNo: "desc" } } } }),
    ]);
    const liMap = new Map(locationItems.map((li) => [li.id, li]));
    const menuMap = new Map(menus.map((m) => [m.id, m]));

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
        source: "IMPORT",
        ...encoder,
      },
    });
    await tx.importRow.update({ where: { id: row.id }, data: { status: "COMMITTED", resultType: "SALE", resultId: created.id } });
  }
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
