import { Hono } from "hono";
import { zValidator } from "../lib/validate";
import {
  commitRequest,
  forfeitCreate,
  lineTotal,
  purchaseCreate,
  purchaseLineCorrect,
  purchaseLineCreate,
  remainingContent,
  resolveDensityFactor,
  voidRequest,
} from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { replay } from "../lib/idempotency";
import {
  assertExpectedStatus,
  holdParentOpen,
  transitionStatus,
  assertMayEditDraft,
  opAlreadyApplied,
  originOf,
  recordOp,
} from "../lib/two-way";
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

/**
 * A delivery may only name a supplier belonging to this establishment.
 *
 * `Supplier` is client-scoped, but both the create and the header PUT took
 * `supplierId` straight from the body — and `GET /purchases/:id` returns
 * `include: { supplier: true }`, i.e. the whole row: contact person, phone,
 * email, address and payment terms. Setting another client's supplier id on
 * your own draft read all of that back out.
 *
 * Every other foreign key in this file is checked; this one was missed. Kept as
 * one function so the two call sites cannot drift apart again.
 */
async function assertSupplierInClient(supplierId: string | null | undefined, clientId: string): Promise<void> {
  if (!supplierId) return;
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { clientId: true } });
  if (!supplier || supplier.clientId !== clientId) throw new AppError(404, "Supplier not found");
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

    const already = await replay(
      body.id,
      (id) => prisma.purchase.findUnique({ where: { id } }),
      (row) => row.locationId === location.id,
    );
    if (already) return c.json(already, 200);

    await assertSupplierInClient(body.supplierId, location.clientId);

    const purchase = await prisma.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: {
          // undefined on every browser request — Prisma's cuid() default applies.
          id: body.id,
          occurredAt: body.occurredAt,
          originDeviceId: originOf(user), // owns the draft until commit
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

  // `id` and `occurredAt` are stripped from the editable set, not merely
  // ignored: `data: body` is a passthrough, so leaving purchaseCreate's sync
  // fields in the partial would let a caller PUT a new primary key onto someone
  // else's draft — or rewrite when the work supposedly happened.
  .put("/purchases/:id", createGuard, zValidator("json", purchaseCreate.omit({ id: true, occurredAt: true }).partial()), async (c) => {
    const location = c.get("location");
    const purchase = await getOwnedPurchase(location.id, c.req.param("id"));
    if (purchase.status !== "DRAFT") throw new AppError(409, "Only drafts can be edited");
    assertMayEditDraft(purchase, c.get("user")!, "delivery");
    const body = c.req.valid("json");
    // `data: body` is a passthrough, so an unchecked supplierId lands directly.
    await assertSupplierInClient(body.supplierId, location.clientId);
    // The DRAFT check above is outside any transaction; a commit landing in
    // between would edit a committed delivery's header.
    const updated = await prisma.$transaction(async (tx) => {
      await holdParentOpen(
        () => tx.purchase.updateMany({ where: { id: purchase.id, status: "DRAFT" }, data: { status: "DRAFT" } }),
        "delivery",
      );
      return tx.purchase.update({ where: { id: purchase.id }, data: body });
    });
    return c.json(updated);
  })

  .post("/purchases/:id/lines", createGuard, zValidator("json", purchaseLineCreate), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const purchase = await getOwnedPurchase(location.id, c.req.param("id"));
    if (purchase.status !== "DRAFT")
      throw new AppError(409, "This delivery is committed — correct an existing line, or record a missed item as a new delivery");
    assertMayEditDraft(purchase, user, "delivery");
    const body = c.req.valid("json");

    const already = await replay(
      body.id,
      (id) => prisma.purchaseLine.findUnique({ where: { id }, include: LI_INCLUDE }),
      (row) => row.purchaseId === purchase.id,
    );
    if (already) return c.json(already, 200);

    const locationItem = await prisma.locationItem.findUnique({ where: { id: body.locationItemId } });
    if (!locationItem || locationItem.locationId !== location.id) throw new AppError(404, "Item not found in this catalog");
    const line = await prisma.$transaction(async (tx) => {
      await holdParentOpen(
        () => tx.purchase.updateMany({ where: { id: purchase.id, status: "DRAFT" }, data: { status: "DRAFT" } }),
        "delivery",
      );
      return tx.purchaseLine.create({
        data: {
          id: body.id,
          occurredAt: body.occurredAt,
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
    });
    return c.json(line, 201);
  })

  .delete("/purchases/:id/lines/:lineId", createGuard, async (c) => {
    const location = c.get("location");
    const purchase = await getOwnedPurchase(location.id, c.req.param("id"));
    if (purchase.status !== "DRAFT") throw new AppError(409, "Committed lines cannot be removed — void instead");
    assertMayEditDraft(purchase, c.get("user")!, "delivery");
    // The line must belong to THIS draft — a raw delete by id would reach any
    // PurchaseLine in the database, including other clients'.
    const line = await prisma.purchaseLine.findUnique({ where: { id: c.req.param("lineId") }, include: LI_INCLUDE });
    if (!line || line.purchaseId !== purchase.id) throw new AppError(404, "Purchase line not found");
    await prisma.$transaction(async (tx) => {
      await holdParentOpen(
        () => tx.purchase.updateMany({ where: { id: purchase.id, status: "DRAFT" }, data: { status: "DRAFT" } }),
        "delivery",
      );
      await tx.purchaseLine.delete({ where: { id: line.id } });
      // Legitimate hard delete (nothing has reached the ledger pre-commit), but
      // it was leaving no record at all — the only mutation class in this file
      // that did. The row goes; what it was stays.
      await logActivity(
        {
          user: c.get("user")!, clientId: location.clientId, locationId: location.id,
          action: "purchaseLine.remove", entity: "PurchaseLine", entityId: line.id,
          summary: `Removed ${line.locationItem.itemVariant.item.name} from the ${purchase.purchaseDate} delivery draft`,
          details: { purchaseId: purchase.id, locationItemId: line.locationItemId, qty: line.qty, unitCost: line.unitCost },
        },
        tx,
      );
    });
    return c.json({ ok: true });
  })

  .post("/purchases/:id/commit", createGuard, async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const purchase = await getOwnedPurchase(location.id, c.req.param("id"));

    const op = commitRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!op.success) throw new AppError(400, "Invalid commit request");
    if (await opAlreadyApplied(op.data.opId)) return c.json(purchase, 200);
    assertExpectedStatus(purchase.status, op.data.expectedStatus, "delivery");
    assertMayEditDraft(purchase, user, "delivery");

    if (purchase.status !== "DRAFT") throw new AppError(409, "Already committed");
    const lineCount = await prisma.purchaseLine.count({ where: { purchaseId: purchase.id } });
    if (lineCount === 0) throw new AppError(400, "Add at least one line before committing");
    const committed = await prisma.$transaction(async (tx) => {
      await transitionStatus(
        () =>
          tx.purchase.updateMany({
            where: { id: purchase.id, status: "DRAFT" },
            data: { status: "COMMITTED", committedAt: new Date(), committedById: user.id },
          }),
        "delivery",
        "committed",
      );
      const updated = await tx.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
      await recordOp(tx, op.data.opId, user, "Purchase", purchase.id, "commit");
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
    const { reason, opId, expectedStatus } = c.req.valid("json");
    const purchase = await getOwnedPurchase(location.id, c.req.param("id"));

    if (await opAlreadyApplied(opId)) return c.json(purchase, 200);
    assertExpectedStatus(purchase.status, expectedStatus, "delivery");

    if (purchase.status === "VOID") throw new AppError(409, "Already voided");
    const voided = await prisma.$transaction(async (tx) => {
      await transitionStatus(
        () =>
          tx.purchase.updateMany({
            where: { id: purchase.id, status: { not: "VOID" } },
            data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: reason },
          }),
        "delivery",
        "voided",
      );
      const updated = await tx.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
      await recordOp(tx, opId, user, "Purchase", purchase.id, "void");
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

  /** Post-commit correction: void the wrong line and write its replacement onto
   *  the SAME purchase, linked by correctionOfId (sales.ts / transfers.ts
   *  pattern). Reports read only ACTIVE lines, so the void drops the original
   *  and the replacement takes its place in the same period — no double count,
   *  no gap. */
  .post("/purchases/:id/lines/:lineId/correct", voidGuard, zValidator("json", purchaseLineCorrect), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const body = c.req.valid("json");
    const purchase = await getOwnedPurchase(location.id, c.req.param("id"));
    if (purchase.status !== "COMMITTED") throw new AppError(409, "Only committed deliveries take corrections");

    // Ahead of the already-voided check: a replayed correction finds the
    // original already VOID from its own first attempt.
    const already = await replay(
      body.id,
      (id) => prisma.purchaseLine.findUnique({ where: { id }, include: LI_INCLUDE }),
      (row) => row.purchaseId === purchase.id,
    );
    if (already) return c.json(already, 200);

    const line = await prisma.purchaseLine.findUnique({ where: { id: c.req.param("lineId") }, include: LI_INCLUDE });
    if (!line || line.purchaseId !== purchase.id) throw new AppError(404, "Purchase line not found");
    if (line.status === "VOID") throw new AppError(409, "Already voided — correct the replacement instead");
    const unitCost = body.unitCost ?? line.unitCost;
    const replacement = await prisma.$transaction(async (tx) => {
      await tx.purchaseLine.update({
        where: { id: line.id },
        data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: body.reason },
      });
      const created = await tx.purchaseLine.create({
        data: {
          id: body.id,
          occurredAt: body.occurredAt,
          purchaseId: purchase.id,
          locationItemId: line.locationItemId,
          qty: body.qty,
          unitCost,
          lineTotal: lineTotal(body.qty, unitCost),
          correctionOfId: line.id,
          createdById: user.id,
          createdByName: `${user.firstName} ${user.lastName}`,
        },
        include: LI_INCLUDE,
      });
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "purchaseLine.correct", entity: "PurchaseLine", entityId: created.id, summary: `Corrected purchase line (${line.locationItem.itemVariant.item.name}) ×${line.qty} → ×${body.qty}: ${body.reason}`, details: { correctionOfId: line.id } },
        tx,
      );
      return created;
    });
    return c.json(replacement, 201);
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

    const already = await replay(
      body.id,
      (id) => prisma.forfeit.findUnique({ where: { id }, include: LI_INCLUDE }),
      (row) => row.locationId === location.id,
    );
    if (already) return c.json(already, 200);

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
      if (body.scaleWeight < tare) throw new AppError(400, "Scale reading is below the empty weight");
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
          id: body.id,
          occurredAt: body.occurredAt,
          originDeviceId: originOf(user), // provenance only — a forfeit has no draft state
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
