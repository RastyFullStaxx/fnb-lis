import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  forfeitCreate,
  lineTotal,
  purchaseCreate,
  purchaseLineCreate,
  remainingContent,
  resolveDensityFactor,
  voidRequest,
} from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { logActivity } from "../services/activity";
import { effectiveWeighMode, netRemaining } from "./counts";
import { requirePermission, type AppEnv } from "../middleware/auth";

const createGuard = requirePermission("entries.create");
const voidGuard = requirePermission("entries.void");

const LI_INCLUDE = {
  locationItem: { include: { itemVariant: { include: { unit: true, item: { include: { category: true } } } } } },
} as const;

async function getOwnedPurchase(locationId: string, purchaseId: string) {
  const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });
  if (!purchase || purchase.locationId !== locationId) throw new AppError(404, "Purchase not found");
  return purchase;
}

export const purchaseRoutes = new Hono<AppEnv>()
  .get("/purchases", async (c) => {
    const location = c.get("location");
    const purchases = await prisma.purchase.findMany({
      where: { locationId: location.id },
      include: { supplier: true, lines: { where: { status: "ACTIVE" }, select: { qty: true, lineTotal: true } } },
      orderBy: [{ purchaseDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    return c.json(
      purchases.map(({ lines, ...p }) => ({
        ...p,
        lineCount: lines.length,
        total: lines.reduce((s, l) => s + l.lineTotal, 0),
      })),
    );
  })

  .post("/purchases", createGuard, zValidator("json", purchaseCreate), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const body = c.req.valid("json");
    const purchase = await prisma.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: {
          locationId: location.id,
          purchaseDate: body.purchaseDate,
          supplierId: body.supplierId ?? null,
          refNo: body.refNo ?? null,
          note: body.note ?? null,
          createdById: user.id,
          createdByName: `${user.firstName} ${user.lastName}`,
        },
      });
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "purchase.create", entity: "Purchase", entityId: created.id, summary: `Started purchase draft for ${body.purchaseDate}` },
        tx,
      );
      return created;
    });
    return c.json(purchase, 201);
  })

  .get("/purchases/:id", async (c) => {
    const location = c.get("location");
    const purchase = await prisma.purchase.findUnique({
      where: { id: c.req.param("id") },
      include: { supplier: true, lines: { include: LI_INCLUDE, orderBy: { createdAt: "asc" } } },
    });
    if (!purchase || purchase.locationId !== location.id) throw new AppError(404, "Purchase not found");
    return c.json(purchase);
  })

  .put("/purchases/:id", createGuard, zValidator("json", purchaseCreate.partial()), async (c) => {
    const location = c.get("location");
    const purchase = await getOwnedPurchase(location.id, c.req.param("id"));
    if (purchase.status !== "DRAFT") throw new AppError(409, "Only drafts can be edited");
    const body = c.req.valid("json");
    const updated = await prisma.purchase.update({ where: { id: purchase.id }, data: body });
    return c.json(updated);
  })

  .post("/purchases/:id/lines", createGuard, zValidator("json", purchaseLineCreate), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const purchase = await getOwnedPurchase(location.id, c.req.param("id"));
    if (purchase.status !== "DRAFT") throw new AppError(409, "Committed purchases take corrections, not new draft lines");
    const body = c.req.valid("json");
    const locationItem = await prisma.locationItem.findUnique({ where: { id: body.locationItemId } });
    if (!locationItem || locationItem.locationId !== location.id) throw new AppError(404, "Item not found in this catalog");
    const line = await prisma.purchaseLine.create({
      data: {
        purchaseId: purchase.id,
        locationItemId: body.locationItemId,
        qty: body.qty,
        unitCost: body.unitCost,
        lineTotal: lineTotal(body.qty, body.unitCost),
        createdById: user.id,
        createdByName: `${user.firstName} ${user.lastName}`,
      },
      include: LI_INCLUDE,
    });
    return c.json(line, 201);
  })

  .delete("/purchases/:id/lines/:lineId", createGuard, async (c) => {
    const location = c.get("location");
    const purchase = await getOwnedPurchase(location.id, c.req.param("id"));
    if (purchase.status !== "DRAFT") throw new AppError(409, "Committed lines cannot be removed — void instead");
    await prisma.purchaseLine.delete({ where: { id: c.req.param("lineId") } });
    return c.json({ ok: true });
  })

  .post("/purchases/:id/commit", createGuard, async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const purchase = await getOwnedPurchase(location.id, c.req.param("id"));
    if (purchase.status !== "DRAFT") throw new AppError(409, "Already committed");
    const lineCount = await prisma.purchaseLine.count({ where: { purchaseId: purchase.id } });
    if (lineCount === 0) throw new AppError(400, "Add at least one line before committing");
    const committed = await prisma.$transaction(async (tx) => {
      const updated = await tx.purchase.update({
        where: { id: purchase.id },
        data: { status: "COMMITTED", committedAt: new Date(), committedById: user.id },
      });
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "purchase.commit", entity: "Purchase", entityId: purchase.id, summary: `Committed purchase for ${purchase.purchaseDate} (${lineCount} lines)` },
        tx,
      );
      return updated;
    });
    return c.json(committed);
  })

  .post("/purchases/:id/void", voidGuard, zValidator("json", voidRequest), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const { reason } = c.req.valid("json");
    const purchase = await getOwnedPurchase(location.id, c.req.param("id"));
    if (purchase.status === "VOID") throw new AppError(409, "Already voided");
    const voided = await prisma.$transaction(async (tx) => {
      const updated = await tx.purchase.update({
        where: { id: purchase.id },
        data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: reason },
      });
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "purchase.void", entity: "Purchase", entityId: purchase.id, summary: `Voided purchase for ${purchase.purchaseDate}: ${reason}` },
        tx,
      );
      return updated;
    });
    return c.json(voided);
  })

  .post("/purchases/:id/lines/:lineId/void", voidGuard, zValidator("json", voidRequest), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const { reason } = c.req.valid("json");
    await getOwnedPurchase(location.id, c.req.param("id"));
    const line = await prisma.purchaseLine.findUnique({ where: { id: c.req.param("lineId") }, include: LI_INCLUDE });
    if (!line || line.purchaseId !== c.req.param("id")) throw new AppError(404, "Purchase line not found");
    if (line.status === "VOID") throw new AppError(409, "Already voided");
    const voided = await prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseLine.update({
        where: { id: line.id },
        data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: reason },
        include: LI_INCLUDE,
      });
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "purchaseLine.void", entity: "PurchaseLine", entityId: line.id, summary: `Voided purchase line (${line.locationItem.itemVariant.item.name} ×${line.qty}): ${reason}` },
        tx,
      );
      return updated;
    });
    return c.json(voided);
  })

  // ── Forfeits: returned partial bottles — content re-entering stock ──
  .get("/forfeits", async (c) => {
    const location = c.get("location");
    const forfeits = await prisma.forfeit.findMany({
      where: { locationId: location.id },
      include: LI_INCLUDE,
      orderBy: [{ forfeitDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    return c.json(forfeits);
  })

  .post("/forfeits", createGuard, zValidator("json", forfeitCreate), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const body = c.req.valid("json");
    const locationItem = await prisma.locationItem.findUnique({
      where: { id: body.locationItemId },
      include: { itemVariant: { include: { unit: true, item: { include: { category: true } } } } },
    });
    if (!locationItem || locationItem.locationId !== location.id) throw new AppError(404, "Item not found in this catalog");

    let weighFields: {
      scaleWeight: number | null;
      scaleUnit: string | null;
      tareWeight: number | null;
      densityFactor: number | null;
      remainingContent: number;
    } = { scaleWeight: null, scaleUnit: null, tareWeight: null, densityFactor: null, remainingContent: 0 };

    if (body.scaleWeight !== undefined) {
      const variant = locationItem.itemVariant;
      const mode = effectiveWeighMode(variant);
      if (!mode) throw new AppError(400, "This item is counted whole — enable Liquid Weight or Net Weight on the variant to weigh it");
      const tare = body.tareWeight ?? variant.tareWeight;
      if (tare === null || tare === undefined) throw new AppError(400, "No tare weight configured for this item");
      if (body.scaleWeight < tare) throw new AppError(400, "Scale reading is below the empty-container weight");
      const scaleUnit = body.scaleUnit ?? variant.tareWeightUnit ?? "oz";
      if (mode === "NET") {
        weighFields = {
          scaleWeight: body.scaleWeight,
          scaleUnit,
          tareWeight: tare,
          densityFactor: null,
          remainingContent: await netRemaining(body.scaleWeight, tare, scaleUnit, variant.unit),
        };
      } else {
        const density =
          body.densityFactor ?? resolveDensityFactor(variant.densityFactor, variant.item.category.defaultDensityFactor);
        if (!density) throw new AppError(400, "No density factor configured for this item or its category");
        weighFields = {
          scaleWeight: body.scaleWeight,
          scaleUnit,
          tareWeight: tare,
          densityFactor: density,
          remainingContent: remainingContent({ scaleWeight: body.scaleWeight, tareWeight: tare, densityFactor: density }),
        };
      }
    }

    const forfeit = await prisma.$transaction(async (tx) => {
      const created = await tx.forfeit.create({
        data: {
          locationId: location.id,
          forfeitDate: body.forfeitDate,
          locationItemId: body.locationItemId,
          ...weighFields,
          qty: body.qty ?? 0,
          note: body.note ?? null,
          createdById: user.id,
          createdByName: `${user.firstName} ${user.lastName}`,
        },
        include: LI_INCLUDE,
      });
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "forfeit.create", entity: "Forfeit", entityId: created.id, summary: `Recorded returned stock (${locationItem.itemVariant.item.name}) for ${body.forfeitDate}` },
        tx,
      );
      return created;
    });
    return c.json(forfeit, 201);
  })

  .post("/forfeits/:id/void", voidGuard, zValidator("json", voidRequest), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const { reason } = c.req.valid("json");
    const forfeit = await prisma.forfeit.findUnique({ where: { id: c.req.param("id") }, include: LI_INCLUDE });
    if (!forfeit || forfeit.locationId !== location.id) throw new AppError(404, "Record not found");
    if (forfeit.status === "VOID") throw new AppError(409, "Already voided");
    const voided = await prisma.$transaction(async (tx) => {
      const updated = await tx.forfeit.update({
        where: { id: forfeit.id },
        data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: reason },
        include: LI_INCLUDE,
      });
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "forfeit.void", entity: "Forfeit", entityId: forfeit.id, summary: `Voided returned-stock record: ${reason}` },
        tx,
      );
      return updated;
    });
    return c.json(voided);
  });
