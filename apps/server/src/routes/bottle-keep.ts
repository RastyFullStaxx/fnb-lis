import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../lib/validate";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { logActivity } from "../services/activity";
import { replay } from "../lib/idempotency";
import { requirePermission, type AppEnv } from "../middleware/auth";

/**
 * Bottle Keep — bottles a customer paid for and left to finish next visit, and
 * the Forfeited Inventory report built on them (client req 2026-08-04).
 *
 * The reason this is its own record rather than a note on a sale: between being
 * paid for and being drunk, the bottle is **on the shelf but not the bar's to
 * sell**. Counted as stock it produces a surplus now and a shortage the day the
 * guest returns and drinks it with no sale behind it. Held here, it is invisible
 * to stock until it expires — and then it enters through the existing zero-cost
 * Forfeit, which is the client's "transferred to bar stock as purchased at zero
 * cost".
 *
 * Mounted inside the location-scoped group: auth and client scoping already ran.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const keepCreate = z.object({
  /**
   * Client-supplied id, like every other create route (lib/idempotency.ts).
   *
   * `/bottle-keeps` is not in the outbox's NEVER_QUEUE list, so an offline
   * desktop queues it and replays on reconnect. Without an id a lost response
   * means the retry creates a SECOND bottle for the same guest — and since the
   * whole design is one row per bottle, a duplicate is not a cosmetic problem:
   * it is a bottle the bar thinks it owes someone.
   */
  id: z.string().min(1).optional(),
  locationItemId: z.string().min(1),
  areaId: z.string().min(1).optional(),
  customerName: z.string().trim().min(1, "Whose bottle is it?").max(120),
  customerContact: z.string().trim().max(120).optional(),
  qty: z.number().positive().max(9999).optional(),
  remainingContent: z.number().min(0).optional(),
  keptDate: z.string().regex(DATE, "Expected YYYY-MM-DD"),
  /** Either an explicit date, or a number of days from keptDate. */
  expiresOn: z.string().regex(DATE, "Expected YYYY-MM-DD").optional(),
  expiryDays: z.number().int().positive().max(3650).optional(),
  note: z.string().trim().max(500).optional(),
});

const writeGuard = requirePermission("entries.create");

/** keptDate + n days, in UTC so a +08 clock cannot shift the boundary. */
function addDays(businessDate: string, days: number): string {
  const [y, m, d] = businessDate.split("-").map(Number);
  const t = Date.UTC(y!, m! - 1, d!) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export const bottleKeepRoutes = new Hono<AppEnv>()
  /**
   * The register, and the Forfeited Inventory report — one endpoint.
   *
   * They are the same list read two ways, and splitting them would mean two
   * queries that can disagree about which bottles are overdue.
   */
  .get("/bottle-keeps", async (c) => {
    const location = c.get("location");
    /**
     * Validated, not passed through.
     *
     * An unrecognised value used to filter on itself and return an empty list —
     * so a typo, or a caller sending the UI's own "ALL" sentinel, produced
     * "no bottles on keep" rather than an error. On a register whose job is to
     * say what the house is holding, silently answering "nothing" is the worst
     * available failure.
     */
    const rawStatus = c.req.query("status");
    const KEEP_STATUSES = ["ACTIVE", "CLAIMED", "FORFEITED", "VOID"];
    if (rawStatus && !KEEP_STATUSES.includes(rawStatus)) {
      throw new AppError(400, `Unknown status "${rawStatus}". Use one of: ${KEEP_STATUSES.join(", ")}.`);
    }
    const status = rawStatus;
    const customer = c.req.query("customer");
    const today = new Date().toISOString().slice(0, 10);

    const keeps = await prisma.bottleKeep.findMany({
      where: {
        locationId: location.id,
        ...(status ? { status } : {}),
        ...(customer ? { customerName: { contains: customer } } : {}),
      },
      include: {
        locationItem: { include: { itemVariant: { include: { unit: true, item: true } } } },
        area: { select: { id: true, name: true } },
      },
      orderBy: [{ expiresOn: "asc" }, { customerName: "asc" }],
    });

    const rows = keeps.map((k) => ({
      ...k,
      /**
       * Computed, never stored: "is it due" is a fact about today, and a stored
       * flag would be wrong every morning until something rewrote it.
       */
      dueForForfeit: k.status === "ACTIVE" && k.expiresOn <= today,
      daysLeft: Math.round(
        (Date.parse(`${k.expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
      ),
    }));

    // The client asked for "number of Bottle Keep under client name" — the
    // breakdown his own question demands, since ten Jack Daniel's under ten
    // guests must not read as one line of ten.
    const byCustomer = new Map<string, { customerName: string; bottles: number; active: number; dueForForfeit: number }>();
    for (const r of rows) {
      // Grouped on a normalised key, displayed with the name as typed.
      // "Lourd B.", "lourd b." and "Lourd  B." are one guest; splitting them
      // would understate how many bottles somebody is holding, which is
      // precisely the number the client wants to watch.
      const key = r.customerName.trim().toLowerCase().replace(/\s+/g, " ");
      const agg = byCustomer.get(key) ?? {
        customerName: r.customerName,
        bottles: 0,
        active: 0,
        dueForForfeit: 0,
      };
      // VOID rows are excluded from every tally.
      //
      // A voided keep is one that was recorded in error — it is not a bottle
      // this guest holds, and counting it inflates the very number the client
      // watches for fraud. It stays in `rows` so the mistake and its reason
      // remain auditable; it just does not add up to anything.
      if (r.status !== "VOID") {
        agg.bottles += 1;
        if (r.status === "ACTIVE") agg.active += 1;
        if (r.dueForForfeit) agg.dueForForfeit += 1;
      }
      byCustomer.set(key, agg);
    }

    return c.json({
      rows,
      byCustomer: [...byCustomer.values()]
        // A guest whose every row was voided would otherwise sit in the list at
        // zero, reading as somebody with bottles rather than somebody with none.
        .filter((c) => c.bottles > 0)
        .sort((a, b) => b.bottles - a.bottles),
      totals: {
        // Same rule as the per-guest tally above — a voided keep is not a bottle.
        bottles: rows.filter((r) => r.status !== "VOID").length,
        active: rows.filter((r) => r.status === "ACTIVE").length,
        dueForForfeit: rows.filter((r) => r.dueForForfeit).length,
      },
    });
  })

  .post("/bottle-keeps", writeGuard, zValidator("json", keepCreate), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const body = c.req.valid("json");

    const li = await prisma.locationItem.findUnique({
      where: { id: body.locationItemId },
      include: { itemVariant: { include: { item: true } } },
    });
    if (!li || li.locationId !== location.id) throw new AppError(404, "Item not found at this location");

    if (body.areaId) {
      const area = await prisma.locationArea.findUnique({ where: { id: body.areaId } });
      if (!area || area.locationId !== location.id) {
        throw new AppError(400, "That storage area does not belong to this location");
      }
    }

    const expiresOn = body.expiresOn ?? (body.expiryDays ? addDays(body.keptDate, body.expiryDays) : null);
    if (!expiresOn) throw new AppError(400, "Set how long the bottle is kept, or an expiry date");
    if (expiresOn < body.keptDate) throw new AppError(400, "The expiry date is before the date kept");

    // Replay of an offline push: the row is already here, answer 200 with it
    // rather than creating a twin.
    const already = await replay(
      body.id,
      (id) => prisma.bottleKeep.findUnique({ where: { id } }),
      (row) => row.locationId === location.id,
    );
    if (already) return c.json(already, 200);

    const keep = await prisma.$transaction(async (tx) => {
      const created = await tx.bottleKeep.create({
        data: {
          id: body.id,
          locationId: location.id,
          areaId: body.areaId ?? null,
          locationItemId: li.id,
          customerName: body.customerName,
          customerContact: body.customerContact ?? null,
          qty: body.qty ?? 1,
          remainingContent: body.remainingContent ?? 0,
          keptDate: body.keptDate,
          expiresOn,
          note: body.note ?? null,
          createdById: user.id,
          createdByName: `${user.firstName} ${user.lastName}`,
        },
      });
      await logActivity(
        {
          user,
          clientId: location.clientId,
          locationId: location.id,
          action: "bottleKeep.create",
          entity: "BottleKeep",
          entityId: created.id,
          summary: `Bottle keep for ${body.customerName}: ${li.itemVariant.item.name} until ${expiresOn}`,
          details: { customerName: body.customerName, expiresOn },
        },
        tx,
      );
      return created;
    });
    return c.json(keep, 201);
  })

  /** The guest came back and drank it. Never touches stock — the sale already did. */
  .post("/bottle-keeps/:id/claim", writeGuard, async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const keep = await prisma.bottleKeep.findUnique({ where: { id: c.req.param("id") } });
    if (!keep || keep.locationId !== location.id) throw new AppError(404, "Bottle keep not found");
    if (keep.status !== "ACTIVE") throw new AppError(409, `This bottle is already ${keep.status.toLowerCase()}`);

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.bottleKeep.update({
        where: { id: keep.id },
        data: { status: "CLAIMED", claimedAt: new Date(), claimedById: user.id },
      });
      await logActivity(
        {
          user,
          clientId: location.clientId,
          locationId: location.id,
          action: "bottleKeep.claim",
          entity: "BottleKeep",
          entityId: row.id,
          summary: `${keep.customerName} claimed their bottle keep`,
        },
        tx,
      );
      return row;
    });
    return c.json(updated);
  })

  /**
   * Recorded in error — void it.
   *
   * VOID, never a hard delete: a bottle keep is a claim against the house, and
   * "there was never a bottle" and "the bottle was cancelled, by this person,
   * for this reason" are different statements. The fraud this register exists to
   * catch would be trivial if a bartender could simply remove the row.
   *
   * Only an ACTIVE keep can be voided. A forfeited one already moved stock, so
   * undoing it would mean reversing the Forfeit too — a different operation with
   * a different audit story, deliberately not hidden behind this one.
   */
  .post("/bottle-keeps/:id/void", writeGuard, zValidator("json", z.object({ reason: z.string().trim().min(3, "A reason is required") })), async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const { reason } = c.req.valid("json");
    const keep = await prisma.bottleKeep.findUnique({ where: { id: c.req.param("id") } });
    if (!keep || keep.locationId !== location.id) throw new AppError(404, "Bottle keep not found");
    if (keep.status === "FORFEITED") {
      throw new AppError(409, "This bottle was already forfeited into stock — void the returned-stock record instead");
    }
    if (keep.status === "VOID") throw new AppError(409, "This bottle keep is already void");

    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.bottleKeep.update({
        where: { id: keep.id },
        data: { status: "VOID", voidReason: reason },
      });
      await logActivity(
        {
          user,
          clientId: location.clientId,
          locationId: location.id,
          action: "bottleKeep.void",
          entity: "BottleKeep",
          entityId: keep.id,
          summary: `Voided bottle keep for ${keep.customerName}: ${reason}`,
        },
        tx,
      );
      return updated;
    });
    return c.json(row);
  })

  /**
   * Expired: the bottle becomes the bar's.
   *
   * This is the client's "transferred to bar stock as purchased at zero cost",
   * and it goes through the existing Forfeit — a quantity-only stock-in with no
   * cost column at all. Deliberately NOT a zero-cost Purchase: under Weighted
   * Average, units added at zero cost grow the denominator and not the
   * numerator, silently dropping the average cost of every remaining bottle and
   * restating valuations across the whole report.
   *
   * One transaction, so a bottle can never be marked forfeited without the
   * stock-in that justifies it.
   */
  .post("/bottle-keeps/:id/forfeit", writeGuard, async (c) => {
    const location = c.get("location");
    const user = c.get("user")!;
    const keep = await prisma.bottleKeep.findUnique({
      where: { id: c.req.param("id") },
      include: { locationItem: { include: { itemVariant: { include: { item: true } } } } },
    });
    if (!keep || keep.locationId !== location.id) throw new AppError(404, "Bottle keep not found");
    if (keep.status !== "ACTIVE") throw new AppError(409, `This bottle is already ${keep.status.toLowerCase()}`);

    const today = new Date().toISOString().slice(0, 10);
    if (keep.expiresOn > today) {
      throw new AppError(409, `This bottle is not due yet — it expires on ${keep.expiresOn}`);
    }

    const result = await prisma.$transaction(async (tx) => {
      const forfeit = await tx.forfeit.create({
        data: {
          locationId: location.id,
          forfeitDate: today,
          locationItemId: keep.locationItemId,
          qty: keep.qty,
          remainingContent: keep.remainingContent,
          note: `Bottle keep forfeited — ${keep.customerName} (kept ${keep.keptDate}, expired ${keep.expiresOn})`,
          createdById: user.id,
          createdByName: `${user.firstName} ${user.lastName}`,
        },
      });
      const row = await tx.bottleKeep.update({
        where: { id: keep.id },
        data: { status: "FORFEITED", forfeitedAt: new Date(), forfeitId: forfeit.id },
      });
      await logActivity(
        {
          user,
          clientId: location.clientId,
          locationId: location.id,
          action: "bottleKeep.forfeit",
          entity: "BottleKeep",
          entityId: row.id,
          summary: `Forfeited ${keep.locationItem.itemVariant.item.name} kept for ${keep.customerName} — returned to stock at zero cost`,
          details: { customerName: keep.customerName, expiresOn: keep.expiresOn, forfeitId: forfeit.id },
        },
        tx,
      );
      return { keep: row, forfeitId: forfeit.id };
    });
    return c.json(result);
  });
