import { Hono } from "hono";
import { zValidator } from "../lib/validate";
import {
  checkContentVsHistory,
  commitRequest,
  countLineCreate,
  countSessionCreate,
  netQuantity,
  remainingContent,
  resolveBottleWeights,
  resolveDensityFactor,
  splitTotalAmount,
  validateNetWeigh,
  validateWeigh,
  voidRequest,
  type CountLineCreate,
  type SessionUser,
  type WeighWarning,
} from "@fnb/core";
import { prisma, type Tx } from "../db";
import { AppError } from "../lib/errors";
import { replay } from "../lib/idempotency";
import { getTrailingAverage } from "../lib/weigh-history";
import {
  assertExpectedStatus,
  assertMayEditDraft,
  opAlreadyApplied,
  originOf,
  recordOp,
} from "../lib/two-way";
import { logActivity } from "../services/activity";
import { requirePermission, type AppEnv } from "../middleware/auth";

const createGuard = requirePermission("entries.create");
const voidGuard = requirePermission("entries.void");

const LINE_INCLUDE = {
  locationItem: { include: { itemVariant: { include: { unit: true, item: { include: { category: true } } } } } },
  correctionOf: true,
} as const;

/**
 * The variant's effective weigh mode (client req #16):
 *   explicit weighMode wins; legacy inference otherwise — contentTracked ⇒
 *   DENSITY (the bar open-bottle formula), else not weighable.
 */
export function effectiveWeighMode(variant: { weighMode: string | null; contentTracked: boolean }): "DENSITY" | "NET" | null {
  // Defense in depth: a content-tracked variant is ALWAYS density-weighed —
  // NET would make reconciliation divide the net weight by the container
  // size. master.ts rejects the combination at write time; this guards any
  // row that predates that rule.
  if (variant.contentTracked) return "DENSITY";
  if (variant.weighMode === "NET" || variant.weighMode === "DENSITY") return variant.weighMode;
  return null;
}

/**
 * NET-mode conversion: net scale weight (integer, g/oz) → the variant's own
 * counting unit (e.g. 3500 g → 3.5 kg). Because NET variants are not
 * content-tracked, openEquivalent() passes the stored value through raw —
 * the converted net weight IS the open quantity, and reconciliation needs no
 * changes at all.
 */
export async function netRemaining(
  scaleWeight: number,
  tare: number,
  scaleUnitName: string,
  variantUnit: { name: string; kind: string; factorToBase: number },
): Promise<number> {
  if (variantUnit.kind !== "MASS") {
    throw new AppError(400, `Net weighing needs a weight-based counting unit — this item counts in ${variantUnit.name}`);
  }
  const scaleUnit = await prisma.unit.findUnique({ where: { name: scaleUnitName } });
  if (!scaleUnit || scaleUnit.kind !== "MASS") throw new AppError(400, `Unknown scale unit "${scaleUnitName}"`);
  return netQuantity({
    scaleWeight,
    tareWeight: tare,
    scaleFactorToBase: scaleUnit.factorToBase,
    targetFactorToBase: variantUnit.factorToBase,
  });
}

/** Resolves + validates a count line body into row data (shared by create/correct). */
async function buildLineData(locationId: string, body: CountLineCreate) {
  const locationItem = await prisma.locationItem.findUnique({
    where: { id: body.locationItemId },
    include: { itemVariant: { include: { unit: true, item: { include: { category: true } } } } },
  });
  if (!locationItem || locationItem.locationId !== locationId) {
    throw new AppError(404, "Item not found in this location's catalog");
  }

  if (body.countType === "WEIGH") {
    const variant = locationItem.itemVariant;
    const mode = effectiveWeighMode(variant);
    if (!mode) {
      throw new AppError(400, "This item is counted whole — enable Liquid Weight or Net Weight on the variant to weigh it");
    }

    // Combined total entry (client req 2026-07-31, Mayonnaise scenario): the
    // counter typed one number covering full units plus one open container.
    // Server runs the split, not the browser, since remainingContent /
    // qtyFull are the trusted fields everywhere else in this file.
    if (body.totalAmount !== undefined) {
      const split = splitTotalAmount(body.totalAmount, variant.size);
      if (!split.ok) throw new AppError(400, split.message);
      return {
        locationItem,
        entryPath: "totalAmount" as const,
        data: {
          countType: "WEIGH",
          qtyFull: split.fullCount,
          scaleWeight: null,
          scaleUnit: null,
          tareWeight: null,
          densityFactor: null,
          remainingContent: split.openRemainder,
        },
      };
    }

    // Direct open-amount entry (client req 2026-07-21): the counter typed the
    // remaining content itself, no scale/tare. Stored as a weigh line with the
    // content set directly — reconciliation reads remainingContent identically.
    if (body.remainingContent !== undefined) {
      return {
        locationItem,
        entryPath: "openAmount" as const,
        data: {
          countType: "WEIGH",
          qtyFull: 0,
          scaleWeight: null,
          scaleUnit: null,
          tareWeight: null,
          densityFactor: null,
          remainingContent: body.remainingContent,
        },
      };
    }

    // The client's own weighing of THEIR bottle wins over the shared master
    // library (client decision 2026-07-25) — see resolveBottleWeights.
    const resolved = resolveBottleWeights(locationItem, variant, variant.item.category.defaultDensityFactor);
    const tare = body.tareWeight ?? resolved.tareWeight;
    if (tare === null || tare === undefined) throw new AppError(400, "No tare weight configured for this item");
    if (body.scaleWeight! < tare) throw new AppError(400, "Scale reading is below the empty weight");
    const scaleUnit = body.scaleUnit ?? resolved.tareWeightUnit ?? "oz";

    if (mode === "NET") {
      return {
        locationItem,
        entryPath: "scale" as const,
        data: {
          countType: "WEIGH",
          qtyFull: 0,
          scaleWeight: body.scaleWeight!,
          scaleUnit,
          tareWeight: tare,
          densityFactor: null,
          remainingContent: await netRemaining(body.scaleWeight!, tare, scaleUnit, variant.unit),
        },
      };
    }

    const density =
      body.densityFactor ??
      resolveDensityFactor(resolved.densityFactor, variant.item.category.defaultDensityFactor);
    if (!density) throw new AppError(400, "No density factor configured for this item or its category");
    return {
      locationItem,
      entryPath: "scale" as const,
      data: {
        countType: "WEIGH",
        qtyFull: 0,
        scaleWeight: body.scaleWeight!,
        scaleUnit,
        tareWeight: tare,
        densityFactor: density,
        remainingContent: remainingContent({ scaleWeight: body.scaleWeight!, tareWeight: tare, densityFactor: density }),
      },
    };
  }
  return {
    locationItem,
    entryPath: "full" as const,
    data: {
      countType: "FULL",
      qtyFull: body.qtyFull!,
      scaleWeight: null,
      scaleUnit: null,
      tareWeight: null,
      densityFactor: null,
      remainingContent: 0,
    },
  };
}

/**
 * The unit cost/retail to freeze onto a count line.
 *
 * The catalog's CURRENT price is right for a browser entry, where "now" and
 * "when it was counted" are the same instant. It is wrong for an offline
 * desktop: a count taken Monday and pushed Wednesday would be stamped with
 * Wednesday's price, so a repricing in between restates a finished count's
 * valuation — and `report-assembly` reads these as "snapshot from count time".
 */
function snapshotPrices(
  user: SessionUser,
  body: { unitCost?: number; unitRetail?: number },
  locationItem: { cost: number; retail: number },
): { unitCost: number; unitRetail: number } {
  const fromDevice = Boolean(user.deviceId);
  return {
    unitCost: fromDevice && body.unitCost !== undefined ? body.unitCost : locationItem.cost,
    unitRetail: fromDevice && body.unitRetail !== undefined ? body.unitRetail : locationItem.retail,
  };
}

async function getOwnedSession(locationId: string, sessionId: string) {
  const session = await prisma.countSession.findUnique({ where: { id: sessionId } });
  if (!session || session.locationId !== locationId) throw new AppError(404, "Count session not found");
  return session;
}

/**
 * Runs the Phase 1 core checks server-side (plan §6 step 4; phases doc
 * Phase 5) — closes the gap client-only checks leave open: a device sync or
 * a direct API call bypasses the browser UI entirely, so the server needs
 * its own copy to catch an outlier even when no one saw a live preview.
 *
 * Reuses validateWeigh/validateNetWeigh directly rather than re-deriving
 * their checks — the plan is explicit this extends the existing mechanism,
 * not a parallel one. Re-runs from the STORED scale/tare/content, not a
 * browser-supplied warning list, so a direct API call gets the same
 * coverage as one that went through the live preview.
 *
 * Advisory only, same as CONTENT_EXCEEDS_SIZE today — never blocks the save.
 * Logged to the activity trail only when a warning actually fires, so a
 * clean entry doesn't add noise to the log the way every append would.
 *
 * Scoped to exactly the two paths phases doc 5.1 names — Weigh Partial and
 * Open Amount — via the caller-supplied `entryPath`, not inferred from
 * data.scaleWeight/tareWeight being null. totalAmount also nulls out
 * scale/tare (see buildLineData), so a null-based check would silently
 * sweep that third path into the same history check as Open Amount: real
 * coverage, but undocumented, asymmetric with the client (no live preview
 * for totalAmount), and would log an outlier for a save the counter never
 * saw a warning on at entry time. entryPath makes the exclusion explicit
 * instead of accidental.
 */
async function checkOutlierWarnings(
  locationItem: { id: string; itemVariant: { size: number; weighMode: string | null; contentTracked: boolean } },
  data: {
    countType: string;
    remainingContent: number;
    scaleWeight: number | null;
    tareWeight: number | null;
    densityFactor: number | null;
  },
  entryPath: "scale" | "openAmount" | "totalAmount" | "full",
): Promise<WeighWarning[]> {
  if (data.countType !== "WEIGH") return [];
  if (entryPath === "totalAmount") return [];

  const trailingAverage = await getTrailingAverage(locationItem.id);

  // Weigh Partial (scale reading present): re-run the same validator the
  // live preview used, from the stored scale/tare/density — recomputing
  // the same remainingContent that was actually saved, not a placeholder.
  if (entryPath === "scale") {
    if (data.scaleWeight == null || data.tareWeight == null) return [];
    const mode = effectiveWeighMode(locationItem.itemVariant);
    if (mode === "NET") {
      return validateNetWeigh(
        { scaleWeight: data.scaleWeight, tareWeight: data.tareWeight },
        data.remainingContent,
        trailingAverage,
      );
    }
    if (data.densityFactor == null) return [];
    return validateWeigh(
      { scaleWeight: data.scaleWeight, tareWeight: data.tareWeight, densityFactor: data.densityFactor },
      locationItem.itemVariant.size,
      trailingAverage,
    );
  }

  // Open Amount (typed content, no scale reading): history-only check, the
  // only one that doesn't need a scale/tare pair (plan §6 step 1).
  const historyWarning = checkContentVsHistory(data.remainingContent, trailingAverage);
  return historyWarning ? [historyWarning] : [];
}

/**
 * Runs checkOutlierWarnings and logs any that fire (phases doc 5.3). Shared
 * by all three CountLine save sites (create, edit, correct) so the coverage
 * and the log shape can't drift between them.
 */
async function logOutlierWarnings(
  user: SessionUser,
  location: { clientId: string; id: string },
  locationItem: { id: string; itemVariant: { size: number; weighMode: string | null; contentTracked: boolean; item: { name: string } } },
  data: {
    countType: string;
    remainingContent: number;
    scaleWeight: number | null;
    tareWeight: number | null;
    densityFactor: number | null;
  },
  entryPath: "scale" | "openAmount" | "totalAmount" | "full",
  lineId: string,
  tx?: Tx,
): Promise<void> {
  const warnings = await checkOutlierWarnings(locationItem, data, entryPath);
  for (const warning of warnings) {
    await logActivity(
      {
        user,
        clientId: location.clientId,
        locationId: location.id,
        action: "countLine.weighOutlier",
        entity: "CountLine",
        entityId: lineId,
        summary: `Weigh outlier on ${locationItem.itemVariant.item.name}: ${warning.message}`,
        details: { code: warning.code, remainingContent: data.remainingContent },
      },
      tx,
    );
  }
}

export const countRoutes = new Hono<AppEnv>()
  .get("/counts", async (c) => {
    const location = c.get("location");
    const sessions = await prisma.countSession.findMany({
      where: { locationId: location.id },
      include: { _count: { select: { lines: { where: { status: "ACTIVE" } } } } },
      orderBy: [{ countDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    return c.json(sessions);
  })

  .post("/counts", createGuard, zValidator("json", countSessionCreate), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const body = c.req.valid("json");

    const already = await replay(
      body.id,
      (id) => prisma.countSession.findUnique({ where: { id } }),
      (row) => row.locationId === location.id,
    );
    if (already) return c.json(already, 200);

    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.countSession.create({
        data: {
          // undefined on every browser request — Prisma's cuid() default applies.
          id: body.id,
          occurredAt: body.occurredAt,
          // Which source started this count — it owns the session until commit.
          originDeviceId: originOf(user),
          locationId: location.id,
          countDate: body.countDate,
          name: body.name ?? null,
          note: body.note ?? null,
          createdById: user.id,
          createdByName: `${user.firstName} ${user.lastName}`,
        },
      });
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "count.create", entity: "CountSession", entityId: created.id, summary: `Opened count session for ${body.countDate}` },
        tx,
      );
      return created;
    });
    return c.json(session, 201);
  })

  .get("/counts/:id", async (c) => {
    const location = c.get("location");
    const session = await prisma.countSession.findUnique({
      where: { id: c.req.param("id") },
      include: { lines: { include: LINE_INCLUDE, orderBy: { createdAt: "desc" } } },
    });
    if (!session || session.locationId !== location.id) throw new AppError(404, "Count session not found");
    return c.json(session);
  })

  .post("/counts/:id/lines", createGuard, zValidator("json", countLineCreate), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const session = await getOwnedSession(location.id, c.req.param("id"));
    if (session.status !== "OPEN") throw new AppError(409, "This count session is committed — void or correct lines instead");
    assertMayEditDraft(session, user, "count");

    const body = c.req.valid("json");

    const already = await replay(
      body.id,
      (id) => prisma.countLine.findUnique({ where: { id }, include: LINE_INCLUDE }),
      (row) => row.countSessionId === session.id,
    );
    if (already) return c.json(already, 200);

    const { locationItem, data, entryPath } = await buildLineData(location.id, body);

    const line = await prisma.countLine.create({
      data: {
        id: body.id,
        occurredAt: body.occurredAt,
        countSessionId: session.id,
        locationItemId: locationItem.id,
        ...data,
        // Price snapshots at ENTRY time. A device replaying an offline count
        // sends what the price was when the bottle was actually counted; the
        // browser sends nothing and the live catalog is the same instant.
        // Only a device session may override, so this is not a way to post
        // arbitrary prices from a browser.
        ...snapshotPrices(user, body, locationItem),
        createdById: user.id,
        createdByName: `${user.firstName} ${user.lastName}`,
      },
      include: LINE_INCLUDE,
    });

    // Server-side outlier enforcement (plan §6 step 4; phases doc Phase 5):
    // a device sync or direct API call skips the browser, so this is the
    // only guaranteed place a fired warning gets logged. Advisory only —
    // never blocks the save above, and only logged when one actually fires.
    await logOutlierWarnings(user, location, locationItem, data, entryPath, line.id);

    return c.json(line, 201);
  })

  .put("/counts/:id/lines/:lineId", createGuard, zValidator("json", countLineCreate), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const session = await getOwnedSession(location.id, c.req.param("id"));
    if (session.status !== "OPEN") throw new AppError(409, "Committed count lines cannot be edited — void or correct instead");
    assertMayEditDraft(session, user, "count");
    // The line must belong to THIS session — a raw update by id would reach
    // any CountLine in the database, including committed ones elsewhere.
    const existing = await prisma.countLine.findUnique({ where: { id: c.req.param("lineId") } });
    if (!existing || existing.countSessionId !== session.id) throw new AppError(404, "Count line not found");
    const body = c.req.valid("json");
    const { locationItem, data, entryPath } = await buildLineData(location.id, body);
    const line = await prisma.countLine.update({
      where: { id: existing.id },
      data: {
        locationItemId: locationItem.id,
        ...data,
        ...snapshotPrices(user, body, locationItem),
      },
      include: LINE_INCLUDE,
    });
    // Same server-side outlier enforcement as create (phases doc Phase 5) —
    // an edit can turn a clean reading into an outlier just as easily.
    await logOutlierWarnings(user, location, locationItem, data, entryPath, line.id);
    return c.json(line);
  })

  .delete("/counts/:id/lines/:lineId", createGuard, async (c) => {
    const location = c.get("location");
    const session = await getOwnedSession(location.id, c.req.param("id"));
    if (session.status !== "OPEN") throw new AppError(409, "Committed count lines cannot be removed — void instead");
    assertMayEditDraft(session, c.get("user")!, "count");
    const existing = await prisma.countLine.findUnique({ where: { id: c.req.param("lineId") } });
    if (!existing || existing.countSessionId !== session.id) throw new AppError(404, "Count line not found");
    await prisma.countLine.delete({ where: { id: existing.id } });
    return c.json({ ok: true });
  })

  .post("/counts/:id/commit", createGuard, async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const session = await getOwnedSession(location.id, c.req.param("id"));

    // Optional body: commit historically took none, and the browser still sends
    // none. Parsed leniently so an empty request stays valid.
    const op = commitRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!op.success) throw new AppError(400, "Invalid commit request");

    // Replay before every other check: a device retrying its own commit finds
    // the session already COMMITTED and would otherwise be told "already
    // committed" forever, unable to tell that apart from someone else's commit.
    if (await opAlreadyApplied(op.data.opId)) return c.json(session, 200);
    assertExpectedStatus(session.status, op.data.expectedStatus, "count");
    assertMayEditDraft(session, user, "count");

    if (session.status !== "OPEN") throw new AppError(409, "Already committed");
    const lineCount = await prisma.countLine.count({ where: { countSessionId: session.id } });
    if (lineCount === 0) throw new AppError(400, "Add at least one count line before committing");

    const committed = await prisma.$transaction(async (tx) => {
      const updated = await tx.countSession.update({
        where: { id: session.id },
        data: { status: "COMMITTED", committedAt: new Date(), committedById: user.id },
      });
      await recordOp(tx, op.data.opId, user, "CountSession", session.id, "commit");
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "count.commit", entity: "CountSession", entityId: session.id, summary: `Committed count for ${session.countDate} (${lineCount} lines)` },
        tx,
      );
      return updated;
    });
    return c.json(committed);
  })

  .post("/counts/:id/void", voidGuard, zValidator("json", voidRequest), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const { reason, opId, expectedStatus } = c.req.valid("json");
    const session = await getOwnedSession(location.id, c.req.param("id"));

    if (await opAlreadyApplied(opId)) return c.json(session, 200);
    assertExpectedStatus(session.status, expectedStatus, "count");

    if (session.status === "VOID") throw new AppError(409, "Already voided");
    const voided = await prisma.$transaction(async (tx) => {
      const updated = await tx.countSession.update({
        where: { id: session.id },
        data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: reason },
      });
      await recordOp(tx, opId, user, "CountSession", session.id, "void");
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "count.void", entity: "CountSession", entityId: session.id, summary: `Voided count for ${session.countDate}: ${reason}` },
        tx,
      );
      return updated;
    });
    return c.json(voided);
  })

  .post("/counts/:id/lines/:lineId/void", voidGuard, zValidator("json", voidRequest), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const { reason } = c.req.valid("json");
    await getOwnedSession(location.id, c.req.param("id"));
    const line = await prisma.countLine.findUnique({ where: { id: c.req.param("lineId") }, include: LINE_INCLUDE });
    if (!line || line.countSessionId !== c.req.param("id")) throw new AppError(404, "Count line not found");
    if (line.status === "VOID") throw new AppError(409, "Already voided");
    const voided = await prisma.$transaction(async (tx) => {
      const updated = await tx.countLine.update({
        where: { id: line.id },
        data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: reason },
        include: LINE_INCLUDE,
      });
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "countLine.void", entity: "CountLine", entityId: line.id, summary: `Voided count line (${line.locationItem.itemVariant.item.name}): ${reason}` },
        tx,
      );
      return updated;
    });
    return c.json(voided);
  })

  /** Post-commit correction: void the old line and create a linked replacement. */
  .post(
    "/counts/:id/lines/:lineId/correct",
    voidGuard,
    zValidator("json", countLineCreate.and(voidRequest)),
    async (c) => {
      const location = c.get("location");
      const user = c.get("user")!;
      const body = c.req.valid("json");
      const session = await getOwnedSession(location.id, c.req.param("id"));

      // Ahead of the already-voided check: a replayed correction finds the
      // original already VOID from its own first attempt, and would otherwise
      // be rejected forever as a double-void.
      const already = await replay(
        body.id,
        (id) => prisma.countLine.findUnique({ where: { id }, include: LINE_INCLUDE }),
        (row) => row.countSessionId === session.id,
      );
      if (already) return c.json(already, 200);

      const original = await prisma.countLine.findUnique({ where: { id: c.req.param("lineId") } });
      if (!original || original.countSessionId !== session.id) throw new AppError(404, "Count line not found");
      if (original.status === "VOID") throw new AppError(409, "Line is already voided");

      const { locationItem, data, entryPath } = await buildLineData(location.id, body);
      const replacement = await prisma.$transaction(async (tx) => {
        await tx.countLine.update({
          where: { id: original.id },
          data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: body.reason },
        });
        const created = await tx.countLine.create({
          data: {
            id: body.id,
            occurredAt: body.occurredAt,
            countSessionId: session.id,
            locationItemId: locationItem.id,
            ...data,
            unitCost: original.unitCost, // corrections keep the original snapshot prices
            unitRetail: original.unitRetail,
            correctionOfId: original.id,
            createdById: user.id,
            createdByName: `${user.firstName} ${user.lastName}`,
          },
          include: LINE_INCLUDE,
        });
        await logActivity(
          { user, clientId: location.clientId, locationId: location.id, action: "countLine.correct", entity: "CountLine", entityId: created.id, summary: `Corrected count line (${locationItem.itemVariant.item.name}): ${body.reason}`, details: { originalId: original.id } },
          tx,
        );
        // Same server-side outlier enforcement as create/edit (phases doc
        // Phase 5) — a correction can introduce or clear an outlier just
        // like any other save, and stays in the same transaction as the
        // rest of the correction.
        await logOutlierWarnings(user, location, locationItem, data, entryPath, created.id, tx);
        return created;
      });
      return c.json(replacement, 201);
    },
  );
