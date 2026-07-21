import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  countLineCreate,
  countSessionCreate,
  netQuantity,
  remainingContent,
  resolveDensityFactor,
  voidRequest,
  type CountLineCreate,
} from "@fnb/core";
import { prisma, type Tx } from "../db";
import { AppError } from "../lib/errors";
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
    const tare = body.tareWeight ?? variant.tareWeight;
    if (tare === null || tare === undefined) throw new AppError(400, "No tare weight configured for this item");
    if (body.scaleWeight! < tare) throw new AppError(400, "Scale reading is below the empty weight");
    const scaleUnit = body.scaleUnit ?? variant.tareWeightUnit ?? "oz";

    if (mode === "NET") {
      return {
        locationItem,
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
      resolveDensityFactor(variant.densityFactor, variant.item.category.defaultDensityFactor);
    if (!density) throw new AppError(400, "No density factor configured for this item or its category");
    return {
      locationItem,
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

async function getOwnedSession(locationId: string, sessionId: string) {
  const session = await prisma.countSession.findUnique({ where: { id: sessionId } });
  if (!session || session.locationId !== locationId) throw new AppError(404, "Count session not found");
  return session;
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
    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.countSession.create({
        data: {
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

    const body = c.req.valid("json");
    const { locationItem, data } = await buildLineData(location.id, body);

    const line = await prisma.countLine.create({
      data: {
        countSessionId: session.id,
        locationItemId: locationItem.id,
        ...data,
        unitCost: locationItem.cost, // price snapshots at entry time
        unitRetail: locationItem.retail,
        createdById: user.id,
        createdByName: `${user.firstName} ${user.lastName}`,
      },
      include: LINE_INCLUDE,
    });
    return c.json(line, 201);
  })

  .put("/counts/:id/lines/:lineId", createGuard, zValidator("json", countLineCreate), async (c) => {
    const location = c.get("location");
    const session = await getOwnedSession(location.id, c.req.param("id"));
    if (session.status !== "OPEN") throw new AppError(409, "Committed count lines cannot be edited — void or correct instead");
    // The line must belong to THIS session — a raw update by id would reach
    // any CountLine in the database, including committed ones elsewhere.
    const existing = await prisma.countLine.findUnique({ where: { id: c.req.param("lineId") } });
    if (!existing || existing.countSessionId !== session.id) throw new AppError(404, "Count line not found");
    const body = c.req.valid("json");
    const { locationItem, data } = await buildLineData(location.id, body);
    const line = await prisma.countLine.update({
      where: { id: existing.id },
      data: { locationItemId: locationItem.id, ...data, unitCost: locationItem.cost, unitRetail: locationItem.retail },
      include: LINE_INCLUDE,
    });
    return c.json(line);
  })

  .delete("/counts/:id/lines/:lineId", createGuard, async (c) => {
    const location = c.get("location");
    const session = await getOwnedSession(location.id, c.req.param("id"));
    if (session.status !== "OPEN") throw new AppError(409, "Committed count lines cannot be removed — void instead");
    const existing = await prisma.countLine.findUnique({ where: { id: c.req.param("lineId") } });
    if (!existing || existing.countSessionId !== session.id) throw new AppError(404, "Count line not found");
    await prisma.countLine.delete({ where: { id: existing.id } });
    return c.json({ ok: true });
  })

  .post("/counts/:id/commit", createGuard, async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const session = await getOwnedSession(location.id, c.req.param("id"));
    if (session.status !== "OPEN") throw new AppError(409, "Already committed");
    const lineCount = await prisma.countLine.count({ where: { countSessionId: session.id } });
    if (lineCount === 0) throw new AppError(400, "Add at least one count line before committing");

    const committed = await prisma.$transaction(async (tx) => {
      const updated = await tx.countSession.update({
        where: { id: session.id },
        data: { status: "COMMITTED", committedAt: new Date(), committedById: user.id },
      });
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
    const { reason } = c.req.valid("json");
    const session = await getOwnedSession(location.id, c.req.param("id"));
    if (session.status === "VOID") throw new AppError(409, "Already voided");
    const voided = await prisma.$transaction(async (tx) => {
      const updated = await tx.countSession.update({
        where: { id: session.id },
        data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: reason },
      });
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
      const original = await prisma.countLine.findUnique({ where: { id: c.req.param("lineId") } });
      if (!original || original.countSessionId !== session.id) throw new AppError(404, "Count line not found");
      if (original.status === "VOID") throw new AppError(409, "Line is already voided — add a new line instead");

      const { locationItem, data } = await buildLineData(location.id, body);
      const replacement = await prisma.$transaction(async (tx) => {
        await tx.countLine.update({
          where: { id: original.id },
          data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: body.reason },
        });
        const created = await tx.countLine.create({
          data: {
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
        return created;
      });
      return c.json(replacement, 201);
    },
  );
