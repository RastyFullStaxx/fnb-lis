import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { logActivity } from "../services/activity";
import { suspectedDuplicates } from "../services/duplicates";
import { requirePermission, type AppEnv } from "../middleware/auth";

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

/**
 * How long an applied operation stays recognisable as a replay. Comfortably
 * longer than the longest plausible offline stretch — an operation is never
 * replayed once its device has synced past it. See docs §7.6.
 */
const SYNC_OP_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

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
      // Who may sign in on this machine, and the ONLY credential that travels:
      // the device PIN hash and the recovery-answer hash.
      //
      // `passwordHash` is deliberately absent and must stay absent. Shipping it
      // would mean a stolen bar PC yields the web credential — one theft
      // becoming remote access to the establishment's books. The PIN is a
      // device-only secret the server never accepts as a login, so cracking it
      // buys access to a machine the thief already holds. That asymmetry is the
      // whole reason a separate credential exists (docs §5).
      prisma.user.findMany({
        where: { clientAccess: { some: { clientId: location.clientId } }, status: "ACTIVE" },
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          role: true,
          modules: { select: { module: true } },
          devicePin: { select: { pinHash: true, recoveryQuestion: true, recoveryAnswerHash: true } },
        },
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
   * Suspected double-entry (§7.4). Never auto-resolves — see the service.
   */
  .get("/sync/duplicates", zValidator("query", snapshotQuery), async (c) => {
    const location = c.get("location");
    const { from } = c.req.valid("query");
    return c.json({ groups: await suspectedDuplicates(location.id, from) });
  })

  /**
   * How current is everyone's copy?
   *
   * Deliberately a standalone endpoint rather than a field threaded through
   * `buildFullAudit`: that function is reconciliation code, and the project rule
   * is not to touch it without re-verifying the golden fixtures. This computes
   * nothing about the numbers — it reports which machines are holding work the
   * server has not seen.
   *
   * Useful in BOTH directions, which is why it is not desktop-only. If the bar
   * PC has a night of unsynced counts, then the *browser's* Full Audit is the
   * incomplete one, and the person reading it on a laptop is the one who needs
   * telling.
   */
  .get("/sync/status", async (c) => {
    const location = c.get("location");
    const devices = await prisma.device.findMany({
      where: { clientId: location.clientId, status: "ACTIVE" },
      select: { id: true, name: true, lastSyncAt: true, lastSeenAt: true, locationId: true },
      orderBy: { name: "asc" },
    });
    const now = Date.now();
    // Six hours is a shift. A machine that has not pushed within one has either
    // gone home for the night or gone wrong, and either way a report built right
    // now may be missing its work.
    const STALE_MS = 6 * 60 * 60 * 1000;
    const rows = devices.map((d) => ({
      ...d,
      stale: !d.lastSyncAt || now - d.lastSyncAt.getTime() > STALE_MS,
    }));
    return c.json({
      devices: rows,
      // The single boolean a banner needs. False when there are no devices at
      // all, which is the ordinary browser-only establishment.
      anyStale: rows.some((d) => d.stale),
      checkedAt: new Date().toISOString(),
    });
  })

  /**
   * Release a draft stranded on a dead machine (§7.2, Rule 1 escape hatch).
   *
   * Without this, a bar PC that dies mid-count freezes that count open forever:
   * only its origin may edit it, and its origin is a machine that is never
   * coming back. Clearing `originDeviceId` hands it to the browser.
   *
   * Gated on `devices.manage` (ADMIN/OWNER) because it is a statement about a
   * machine, and logged because it silently changes who may edit a document.
   */
  .post(
    "/drafts/:entity/:id/release",
    requirePermission("devices.manage"),
    zValidator("json", z.object({ reason: z.string().trim().min(3) })),
    async (c) => {
      const location = c.get("location");
      const actor = c.get("user")!;
      const { reason } = c.req.valid("json");
      const entity = c.req.param("entity");
      const id = c.req.param("id");

      const open = { CountSession: "OPEN", Purchase: "DRAFT", Transfer: "DRAFT" } as const;
      if (!(entity in open)) throw new AppError(404, "Not a releasable document");
      const kind = entity as keyof typeof open;

      // Written as an explicit switch rather than a dynamic `prisma[model]`
      // lookup: the three tables have different location columns (a Transfer is
      // scoped by fromLocationId), and a generic accessor would quietly skip
      // that check.
      const doc =
        kind === "CountSession"
          ? await prisma.countSession.findFirst({ where: { id, locationId: location.id } })
          : kind === "Purchase"
            ? await prisma.purchase.findFirst({ where: { id, locationId: location.id } })
            : await prisma.transfer.findFirst({ where: { id, fromLocationId: location.id } });
      if (!doc) throw new AppError(404, "Document not found");
      if (doc.status !== open[kind]) throw new AppError(409, "Only open drafts can be released");
      if (doc.originDeviceId === null) throw new AppError(409, "This draft is already editable here");

      await prisma.$transaction(async (tx) => {
        if (kind === "CountSession") await tx.countSession.update({ where: { id }, data: { originDeviceId: null } });
        else if (kind === "Purchase") await tx.purchase.update({ where: { id }, data: { originDeviceId: null } });
        else await tx.transfer.update({ where: { id }, data: { originDeviceId: null } });
        await logActivity(
          {
            user: actor,
            clientId: location.clientId,
            locationId: location.id,
            action: "draft.release",
            entity,
            entityId: id,
            summary: `Released a ${entity} draft from its originating computer: ${reason}`,
            details: { previousOriginDeviceId: doc.originDeviceId },
          },
          tx,
        );
      });
      return c.json({ ok: true });
    },
  )

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

    // Housekeeping for the one table in this schema that is NOT kept forever
    // (docs §7.6). A completed sync is the natural moment: it happens roughly
    // once per batch rather than per write, the delete is a single indexed range
    // scan, and it needs no cron — this project has no scheduler, and a
    // retention policy that exists only in a document is not a retention policy.
    await prisma.syncOp
      .deleteMany({ where: { appliedAt: { lt: new Date(Date.now() - SYNC_OP_RETENTION_MS) } } })
      .catch(() => {}); // never fail an ack over housekeeping

    return c.json({ ok: true });
  });
