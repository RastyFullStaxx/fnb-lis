import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { type AppEnv } from "../middleware/auth";

/**
 * The pull half of the offline desktop mirror (docs/sync-and-data-lifecycle.md).
 *
 * This is a WHOLE-LOCATION SNAPSHOT, not an incremental "changes since X" feed,
 * and that is a deliberate choice rather than a missing feature. A single
 * location is a couple of hundred catalog rows and a few thousand transactions
 * — a megabyte or two of JSON. Replacing the local copy outright on reconnect
 * is simpler than a cursor, has no drift failure mode, and needs no updatedAt
 * columns or tombstones to notice a deletion. If a client ever accumulates
 * enough history for that to hurt, `from` bounds it: committed periods are
 * immutable, so the desktop keeps what it already has and asks only for the
 * open tail.
 *
 * Push needs no endpoint of its own. The device replays the ordinary create
 * routes carrying its own record ids, and those are idempotent (see
 * lib/idempotency.ts) — so a retried upload converges instead of duplicating.
 */

const snapshotQuery = z.object({
  /**
   * Business date floor for transactional data, YYYY-MM-DD. Master data is
   * always returned in full — it is small, and a stale catalog is what makes a
   * count unpostable.
   */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const syncRoutes = new Hono<AppEnv>()
  .get("/sync/snapshot", zValidator("query", snapshotQuery), async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const { from } = c.req.valid("query");
    const onOrAfter = from ? { gte: from } : undefined;

    const [
      units,
      categories,
      variants,
      locationItems,
      suppliers,
      menuItems,
      countSessions,
      purchases,
      sales,
      forfeits,
      transfers,
      people,
    ] = await Promise.all([
      prisma.unit.findMany(),
      prisma.category.findMany(),
      // ItemVariant is GLOBAL (LIS-owned master data, no clientId) — the server
      // is the only writer, which is precisely why the down-flow can be a plain
      // overwrite with no merge. Scoped to what this location actually stocks
      // so a desktop does not carry every other establishment's catalog.
      prisma.itemVariant.findMany({
        where: { locationItems: { some: { locationId: location.id } } },
        include: { item: { include: { category: true } }, unit: true },
      }),
      prisma.locationItem.findMany({ where: { locationId: location.id } }),
      prisma.supplier.findMany({ where: { clientId: location.clientId } }),
      prisma.menuItem.findMany({
        where: { locationId: location.id },
        include: { versions: { include: { lines: true } } },
      }),
      prisma.countSession.findMany({
        where: { locationId: location.id, countDate: onOrAfter },
        include: { lines: true },
      }),
      prisma.purchase.findMany({
        where: { locationId: location.id, purchaseDate: onOrAfter },
        include: { lines: true },
      }),
      prisma.saleRecord.findMany({ where: { locationId: location.id, saleDate: onOrAfter } }),
      prisma.forfeit.findMany({ where: { locationId: location.id, forfeitDate: onOrAfter } }),
      // Both directions: this location's books move when it dispatches AND when
      // it receives, so a snapshot holding only transfersOut would reconcile short.
      prisma.transfer.findMany({
        where: {
          businessDate: onOrAfter,
          OR: [{ fromLocationId: location.id }, { toLocationId: location.id }],
        },
        include: { lines: { include: { receipts: true } } },
      }),
      // Display only — "counted by Ana" has to render offline. Deliberately NOT
      // credentials: how the desktop authenticates a user with no network is an
      // open decision (see the doc), and shipping password hashes to a bar PC
      // is not a call to make as a side effect of building a snapshot.
      prisma.user.findMany({
        where: { clientAccess: { some: { clientId: location.clientId } }, status: "ACTIVE" },
        select: { id: true, username: true, firstName: true, lastName: true, role: true },
      }),
    ]);

    return c.json({
      meta: {
        // Server time at generation. The device stores it and sends it back as
        // `from` on the next pull once it trusts its cached history.
        generatedAt: new Date().toISOString(),
        locationId: location.id,
        from: from ?? null,
      },
      client: {
        id: client.id,
        name: client.name,
        costBasis: client.costBasis,
        varianceThresholdPct: client.varianceThresholdPct,
      },
      location: { id: location.id, name: location.name, kind: location.kind },
      master: { units, categories, variants },
      catalog: locationItems,
      suppliers,
      menuItems,
      counts: countSessions,
      purchases,
      sales,
      forfeits,
      transfers,
      people,
    });
  })

  /**
   * "Everything I had queued is now on the server." Separate from the writes
   * themselves so the device reports success once per batch instead of the
   * server guessing from the last create it happened to receive — a push that
   * dies halfway must not look like a completed sync.
   */
  .post("/sync/ack", async (c) => {
    const location = c.get("location");
    const deviceId = c.get("user")!.deviceId;
    if (!deviceId) throw new AppError(400, "Not a registered device session");
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    // Scoping: a device may only ack for the establishment it belongs to.
    if (!device || device.clientId !== location.clientId) throw new AppError(404, "Device not found");
    await prisma.device.update({ where: { id: deviceId }, data: { lastSyncAt: new Date() } });
    return c.json({ ok: true });
  });
