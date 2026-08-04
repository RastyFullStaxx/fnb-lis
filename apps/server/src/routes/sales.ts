import { Hono } from "hono";
import { zValidator } from "../lib/validate";
import { saleCorrect, saleCreate, voidRequest } from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { replay } from "../lib/idempotency";
import { assertExpectedStatus, opAlreadyApplied, originOf, recordOp } from "../lib/two-way";
import { logActivity } from "../services/activity";
import { requirePermission, type AppEnv } from "../middleware/auth";

const createGuard = requirePermission("entries.create");
const voidGuard = requirePermission("entries.void");

const SALE_INCLUDE = {
  locationItem: { include: { itemVariant: { include: { unit: true, item: { include: { category: true } } } } } },
  menuItem: true,
  correctionOf: true,
} as const;

const KIND_LABEL: Record<string, string> = {
  SALE: "sale",
  NON_REVENUE: "non-revenue entry",
  PRODUCTION: "production entry",
};

export const saleRoutes = new Hono<AppEnv>()
  .get("/sales", async (c) => {
    const location = c.get("location");
    const kind = c.req.query("kind");
    const date = c.req.query("date");
    const where = {
      locationId: location.id,
      kind: kind || undefined,
      saleDate: date || undefined,
    };
    // The list is capped at 300 rows, but the footer summary is NOT: computing
    // count and net from the fetched page would silently under-report the
    // moment a location passes 300 entries, presenting a partial figure as a
    // total on the one screen whose job is trustworthy numbers. Count and net
    // are aggregated over every non-void row instead, from a lightweight
    // second query that pulls only the three fields the sum needs.
    const [rows, summable] = await Promise.all([
      prisma.saleRecord.findMany({
        where,
        include: SALE_INCLUDE,
        orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }],
        take: 300,
      }),
      prisma.saleRecord.findMany({
        where: { ...where, status: { not: "VOID" } },
        select: { unitPrice: true, qty: true, discountPct: true },
      }),
    ]);
    const netTotal = summable.reduce(
      (sum, r) => sum + r.unitPrice * r.qty * (1 - r.discountPct / 100),
      0,
    );
    return c.json({ rows, totalCount: summable.length, netTotal });
  })

  /** Single-step commit — sales are quick entries (drafting lives in Purchases/Counts). */
  .post("/sales", createGuard, zValidator("json", saleCreate), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const body = c.req.valid("json");

    // A desktop re-pushing after a dropped connection gets its own record back,
    // not a second sale. 200 rather than 201: nothing was created this time.
    const already = await replay(
      body.id,
      (id) => prisma.saleRecord.findUnique({ where: { id }, include: SALE_INCLUDE }),
      (row) => row.locationId === location.id,
    );
    if (already) return c.json(already, 200);

    let unitPrice = body.unitPrice ?? 0;
    let recipeVersionId: string | null = null;

    if (body.locationItemId) {
      const locationItem = await prisma.locationItem.findUnique({ where: { id: body.locationItemId } });
      if (!locationItem || locationItem.locationId !== location.id) {
        throw new AppError(404, "Item not found in this catalog");
      }
      if (body.unitPrice === undefined) unitPrice = body.kind === "SALE" ? locationItem.retail : 0;
    } else if (body.menuItemId) {
      const menu = await prisma.menuItem.findUnique({
        where: { id: body.menuItemId },
        include: { versions: { orderBy: { versionNo: "desc" }, take: 1 } },
      });
      if (!menu || menu.locationId !== location.id) throw new AppError(404, "Menu item not found");
      const activeVersion = menu.versions[0];
      if (!activeVersion) throw new AppError(400, "This menu has no published recipe yet");
      recipeVersionId = activeVersion.id; // snapshot: history is immune to future recipe edits
      // A device replaying an offline sale sends the version that was live when
      // the drink was actually poured. Resolving "latest" at push time instead
      // would deplete the wrong recipe's ingredients for anything sold before a
      // recipe edit. Verified to belong to THIS menu so it cannot point at
      // another item's recipe. Device sessions only.
      if (user.deviceId && body.recipeVersionId) {
        const claimed = menu.versions.find((v) => v.id === body.recipeVersionId)
          ? body.recipeVersionId
          : (await prisma.recipeVersion.findFirst({
              where: { id: body.recipeVersionId, menuItemId: menu.id },
              select: { id: true },
            }))?.id;
        if (!claimed) throw new AppError(400, "That recipe version doesn't belong to this menu item");
        recipeVersionId = claimed;
      }
      if (body.unitPrice === undefined) unitPrice = body.kind === "SALE" ? activeVersion.srp : 0;
    }

    if (body.kind !== "SALE") unitPrice = body.unitPrice ?? 0;

    const sale = await prisma.$transaction(async (tx) => {
      const created = await tx.saleRecord.create({
        data: {
          // undefined on every browser request, so Prisma's cuid() default applies.
          id: body.id,
          occurredAt: body.occurredAt,
          originDeviceId: originOf(user), // provenance — see SaleRecord.originDeviceId
          locationId: location.id,
          saleDate: body.saleDate,
          kind: body.kind,
          locationItemId: body.locationItemId ?? null,
          menuItemId: body.menuItemId ?? null,
          recipeVersionId,
          qty: body.qty,
          unitPrice,
          discountPct: body.discountPct ?? 0,
          contentOverride: body.contentOverride ?? null,
          reason: body.reason ?? null,
          note: body.note ?? null,
          createdById: user.id,
          createdByName: `${user.firstName} ${user.lastName}`,
        },
        include: SALE_INCLUDE,
      });
      const what = created.locationItem?.itemVariant.item.name ?? created.menuItem?.name ?? "item";
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: `sale.${body.kind.toLowerCase()}`, entity: "SaleRecord", entityId: created.id, summary: `Recorded ${KIND_LABEL[body.kind]}: ${what} ×${body.qty} on ${body.saleDate}` },
        tx,
      );
      return created;
    });
    return c.json(sale, 201);
  })

  .post("/sales/:id/void", voidGuard, zValidator("json", voidRequest), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const { reason, opId, expectedStatus } = c.req.valid("json");
    const sale = await prisma.saleRecord.findUnique({ where: { id: c.req.param("id") }, include: SALE_INCLUDE });
    if (!sale || sale.locationId !== location.id) throw new AppError(404, "Record not found");

    if (await opAlreadyApplied(opId)) return c.json(sale, 200);
    assertExpectedStatus(sale.status, expectedStatus, "record");

    if (sale.status === "VOID") throw new AppError(409, "Already voided");
    const voided = await prisma.$transaction(async (tx) => {
      const updated = await tx.saleRecord.update({
        where: { id: sale.id },
        data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: reason },
        include: SALE_INCLUDE,
      });
      await recordOp(tx, opId, user, "SaleRecord", sale.id, "void");
      const what = sale.locationItem?.itemVariant.item.name ?? sale.menuItem?.name ?? "item";
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "sale.void", entity: "SaleRecord", entityId: sale.id, summary: `Voided ${KIND_LABEL[sale.kind] ?? "record"} (${what} ×${sale.qty}): ${reason}` },
        tx,
      );
      return updated;
    });
    return c.json(voided);
  })

  /** Edit a committed entry = void the original + create a linked replacement
   *  in one transaction, exactly like every other correction. The row keeps its
   *  history: the old record stays VOID with the change reason, the new one
   *  carries correctionOfId, and one ActivityLog entry records the edit. */
  .post("/sales/:id/correct", voidGuard, zValidator("json", saleCorrect), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const body = c.req.valid("json");

    // Before the already-voided check, not after: a replayed correction finds
    // its own original already VOID — this route did that on the first attempt
    // — and would otherwise be rejected as a double-void, leaving the device
    // permanently unable to converge on a correction it already made.
    const already = await replay(
      body.id,
      (id) => prisma.saleRecord.findUnique({ where: { id }, include: SALE_INCLUDE }),
      (row) => row.locationId === location.id,
    );
    if (already) return c.json(already, 200);

    const original = await prisma.saleRecord.findUnique({ where: { id: c.req.param("id") }, include: SALE_INCLUDE });
    if (!original || original.locationId !== location.id) throw new AppError(404, "Record not found");
    if (original.status === "VOID") throw new AppError(409, "Record is already voided — create a new entry instead");

    // Verifying the record belongs here is NOT enough — the replacement's target
    // comes from the request body, and `saleCorrect` extends `saleCreate`, so
    // both FKs are accepted here too. Without this the row lands with
    // `locationId` = this location but pointing at another establishment's
    // catalog: the Sales report joins `locationItem` and would print that
    // establishment's item name, size and category, and the Full Audit would
    // value usage against a catalog row this location does not own.
    //
    // Same checks POST /sales makes above; kept explicit rather than shared
    // because create interleaves them with its price/recipe resolution.
    if (body.locationItemId) {
      const target = await prisma.locationItem.findUnique({
        where: { id: body.locationItemId },
        select: { locationId: true },
      });
      if (!target || target.locationId !== location.id) {
        throw new AppError(404, "Item not found in this catalog");
      }
    }
    if (body.menuItemId) {
      const target = await prisma.menuItem.findUnique({
        where: { id: body.menuItemId },
        select: { locationId: true },
      });
      if (!target || target.locationId !== location.id) throw new AppError(404, "Menu item not found");
    }

    const replacement = await prisma.$transaction(async (tx) => {
      await tx.saleRecord.update({
        where: { id: original.id },
        data: { status: "VOID", voidedAt: new Date(), voidedById: user.id, voidReason: body.voidReason },
      });
      const created = await tx.saleRecord.create({
        data: {
          id: body.id,
          occurredAt: body.occurredAt,
          originDeviceId: originOf(user), // provenance — see SaleRecord.originDeviceId
          locationId: location.id,
          saleDate: body.saleDate,
          kind: body.kind,
          locationItemId: body.locationItemId ?? null,
          menuItemId: body.menuItemId ?? null,
          recipeVersionId: original.recipeVersionId,
          qty: body.qty,
          unitPrice: body.unitPrice ?? original.unitPrice,
          discountPct: body.discountPct ?? 0,
          contentOverride: body.contentOverride ?? null,
          // The non-revenue bucket, distinct from the void reason above.
          reason: body.reason ?? null,
          note: body.note ?? null,
          correctionOfId: original.id,
          createdById: user.id,
          createdByName: `${user.firstName} ${user.lastName}`,
        },
        include: SALE_INCLUDE,
      });
      const what = created.locationItem?.itemVariant.item.name ?? created.menuItem?.name ?? "item";
      await logActivity(
        { user, clientId: location.clientId, locationId: location.id, action: "sale.correct", entity: "SaleRecord", entityId: created.id, summary: `Edited ${KIND_LABEL[body.kind] ?? "record"} (${what} ×${body.qty}): ${body.voidReason}`, details: { originalId: original.id } },
        tx,
      );
      return created;
    });
    return c.json(replacement, 201);
  });
