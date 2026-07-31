import { Hono } from "hono";
import { zValidator } from "../lib/validate";
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

/**
 * Ids the device believes it has pushed, so the server can say which it has
 * never seen. Capped because this is a "did anything fall on the floor?" probe,
 * not a bulk transfer — the device asks about its open period, not its history.
 */
const reconcileBody = z.object({
  ids: z.array(z.string().min(1)).min(1).max(2000),
});

/**
 * Events the device recorded while offline. Deliberately a closed enum rather
 * than free-form log lines: this is a channel into the audit trail, and an
 * open one would let a machine write whatever it liked into it.
 */
const ackBody = z.object({
  events: z
    .array(
      z.object({
        kind: z.enum(["pinFailed", "pinLockout", "pinRecovered"]),
        summary: z.string().trim().min(1).max(200),
        occurredAt: z.coerce.date(),
      }),
    )
    .max(200)
    .optional(),
});

const snapshotQuery = z.object({
  /**
   * Business date floor for transactional data, YYYY-MM-DD. Master data is
   * always returned in full — it is small, and a stale catalog is what makes a
   * count unpostable.
   */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /**
   * Server RECEIPT time of the device's last successful pull (the previous
   * response's `meta.generatedAt`).
   *
   * `from` alone is not enough, and the original reasoning for it was wrong.
   * It bounds by BUSINESS date on the premise that committed periods are
   * immutable — but they are not: voiding a committed count line, or
   * correcting one, mutates a record whose countDate stays in the old period.
   * A June line voided in July would never be re-sent to a device pulling with
   * `from=2026-07-01`, so its June Full Audit would keep counting a line the
   * server has dropped, permanently and with no drift signal.
   *
   * With `since`, anything whose server-side state changed after that instant
   * comes back regardless of how old its business date is.
   */
  since: z.string().datetime().optional(),
});

export const syncRoutes = new Hono<AppEnv>()
  .get("/sync/snapshot", zValidator("query", snapshotQuery), async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const me = c.get("user")!;

    // DEVICE SESSIONS ONLY. This payload carries every colleague's device-PIN
    // hash and recovery-answer hash, so without this gate any authenticated
    // user of the establishment — a STAFF member, or a third-party
    // AUDIT_VIEWER whose whole role is "read the reconciliation" — could pull
    // the offline credentials of everyone including the owner, then brute-force
    // a 4-digit PIN offline at their leisure.
    //
    // A browser has no use for a snapshot: it is talking to the authoritative
    // database already. Restricting to the one caller that needs it closes the
    // hole completely rather than narrowing it by role.
    if (!me.deviceId) {
      throw new AppError(403, "Only a registered offline computer can download a snapshot");
    }
    const device = await prisma.device.findUnique({ where: { id: me.deviceId } });
    // And only for ITS OWN establishment — a device registered to one client
    // must not be able to mirror another's books by changing the URL.
    if (!device || device.clientId !== location.clientId) {
      throw new AppError(404, "Location not found");
    }

    const { from, since } = c.req.valid("query");
    const changedSince = since ? new Date(since) : undefined;

    /**
     * "In the requested business window, OR changed since the device last
     * pulled." The second arm is what carries a void or a correction applied to
     * an old period back to a mirror that has already scrolled past it.
     */
    const scoped = (dateField: string, linesRelation?: "lines") => {
      if (!from) return {};
      const arms: Record<string, unknown>[] = [{ [dateField]: { gte: from } }];
      if (changedSince) {
        arms.push({ createdAt: { gte: changedSince } }, { voidedAt: { gte: changedSince } });
        // A voided or corrected LINE does not touch its parent's voidedAt, so a
        // header-only test would leave the mirror holding a line the server has
        // dropped. Reach into the children explicitly.
        if (linesRelation) {
          arms.push({
            [linesRelation]: {
              some: { OR: [{ createdAt: { gte: changedSince } }, { voidedAt: { gte: changedSince } }] },
            },
          });
        }
      }
      return { OR: arms };
    };

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
      fullLocation,
      fullClient,
      subscription,
      locationModules,
      clientAccess,
      userModules,
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
        where: { locationId: location.id, ...scoped("countDate", "lines") },
        include: { lines: true },
      }),
      prisma.purchase.findMany({
        where: { locationId: location.id, ...scoped("purchaseDate", "lines") },
        include: { lines: true },
      }),
      prisma.saleRecord.findMany({ where: { locationId: location.id, ...scoped("saleDate") } }),
      prisma.forfeit.findMany({ where: { locationId: location.id, ...scoped("forfeitDate") } }),
      // Both directions: this location's books move when it dispatches AND when
      // it receives, so a snapshot holding only transfersOut would reconcile short.
      prisma.transfer.findMany({
        // AND, because both halves are OR-shaped: "this location is either end"
        // and "in the window, or changed since the last pull". Flattening them
        // into one object would silently drop the location scoping.
        where: {
          AND: [
            { OR: [{ fromLocationId: location.id }, { toLocationId: location.id }] },
            scoped("businessDate", "lines"),
          ],
        },
        include: { lines: { include: { receipts: true } } },
      }),
      // ── Identity: the rows the SERVER'S OWN middleware needs to answer a
      // request. Without these the mirror boots and then 404s every call:
      // requireLocationAccess re-reads Location.status, Client.status and a
      // UserClientAccess row for any non-ADMIN, and none of them were in the
      // original payload. "Zero routing changes to the SPA" is only true if the
      // snapshot can actually boot the app it serves.
      prisma.location.findUnique({ where: { id: location.id } }),
      prisma.client.findUnique({ where: { id: location.clientId } }),
      prisma.subscription.findUnique({ where: { clientId: location.clientId } }),
      // The module ceiling. Every report route filters on this, and a MISSING
      // set means "unrestricted" rather than "none" — so omitting it does not
      // throw, it silently widens the offline Full Audit to include stock the
      // online one excludes. Two different totals on the one report the client
      // trusts absolutely, with nothing to signal the divergence.
      prisma.locationModule.findMany({ where: { locationId: location.id } }),
      prisma.userClientAccess.findMany({ where: { clientId: location.clientId } }),
      prisma.userModule.findMany({
        where: { user: { clientAccess: { some: { clientId: location.clientId } } } },
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
          email: true,
          role: true,
          // The mirror re-runs the server's own middleware, and these columns
          // are NOT NULL in the schema it shares. Sending the real values beats
          // fabricating them on the device — a user's actual creation date is
          // audit data, and `status` is what tells an offline machine that
          // someone has been disabled.
          status: true,
          createdAt: true,
          updatedAt: true,
          failedLoginCount: true,
          modules: { select: { module: true } },
          // createdAt/updatedAt included for the same reason as the User ones
          // above: the mirror shares this schema, and both are NOT NULL there.
          devicePin: {
            select: {
              pinHash: true,
              recoveryQuestion: true,
              recoveryAnswerHash: true,
              createdAt: true,
              updatedAt: true,
            },
          },
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
        // Echoed so the device can store it and send it back as `since` on the
        // next pull. That round-trip is what makes a bounded snapshot safe.
        since: since ?? null,
      },
      // Full rows, not a display subset: the mirror re-runs the same middleware
      // the server does, and that middleware reads status flags and the
      // subscription. Trimming these to "what a screen shows" is what made the
      // first version unbootable offline.
      client: fullClient,
      location: fullLocation,
      identity: {
        subscription,
        locationModules,
        clientAccess,
        userModules,
      },
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
   * "Which of these did you never receive?"
   *
   * The answer to a failure the outbox structurally cannot prevent. Capture
   * happens at the HTTP layer, which runs AFTER the route's `$transaction` has
   * committed — so a force-quit, a power cut or a full disk in that window
   * leaves a record written locally with no outbox entry to push it. Nothing
   * would ever notice: the device would report a clean sync while a night's
   * counts sat locally forever.
   *
   * This lets the device audit itself. It sends the ids it holds for the open
   * period; anything the server has never seen gets re-queued. It also catches
   * every OTHER cause of the same symptom, which a transaction-scoped outbox
   * would not — that is why this is the fix rather than restructuring the write
   * path of nineteen routes.
   *
   * The device must not let `/sync/ack` advance `lastSyncAt` while this returns
   * anything, or the admin dashboard reports "synced" over missing work.
   */
  .post("/sync/reconcile", zValidator("json", reconcileBody), async (c) => {
    const location = c.get("location");
    const me = c.get("user")!;
    if (!me.deviceId) throw new AppError(400, "Not a registered device session");
    const { ids } = c.req.valid("json");

    // Every table a device can originate. Scoped to this location so the probe
    // cannot be used to test for the existence of another establishment's ids.
    const [counts, countLines, purchases, purchaseLines, sales, forfeits, transfers, transferLines] =
      await Promise.all([
        prisma.countSession.findMany({ where: { id: { in: ids }, locationId: location.id }, select: { id: true } }),
        prisma.countLine.findMany({
          where: { id: { in: ids }, countSession: { locationId: location.id } },
          select: { id: true },
        }),
        prisma.purchase.findMany({ where: { id: { in: ids }, locationId: location.id }, select: { id: true } }),
        prisma.purchaseLine.findMany({
          where: { id: { in: ids }, purchase: { locationId: location.id } },
          select: { id: true },
        }),
        prisma.saleRecord.findMany({ where: { id: { in: ids }, locationId: location.id }, select: { id: true } }),
        prisma.forfeit.findMany({ where: { id: { in: ids }, locationId: location.id }, select: { id: true } }),
        prisma.transfer.findMany({ where: { id: { in: ids }, fromLocationId: location.id }, select: { id: true } }),
        prisma.transferLine.findMany({
          where: { id: { in: ids }, transfer: { fromLocationId: location.id } },
          select: { id: true },
        }),
      ]);

    const present = new Set(
      [counts, countLines, purchases, purchaseLines, sales, forfeits, transfers, transferLines]
        .flat()
        .map((r) => r.id),
    );
    const missing = ids.filter((id) => !present.has(id));
    return c.json({ missing, checked: ids.length });
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
    const me = c.get("user")!;
    const deviceId = me.deviceId;
    if (!deviceId) throw new AppError(400, "Not a registered device session");

    // Lenient: an ack with nothing to report sends no body at all.
    const parsed = ackBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new AppError(400, "Invalid ack payload");
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    // Scoping: a device may only ack for the establishment it belongs to.
    if (!device || device.clientId !== location.clientId) throw new AppError(404, "Device not found");
    await prisma.device.update({ where: { id: deviceId }, data: { lastSyncAt: new Date() } });

    // Things that happened on the machine with no network to record them —
    // principally failed PIN attempts and offline lockouts. A lockout nobody
    // can see is half a control, and this is the only channel a device has to
    // report an event that produced no record. Bounded and typed, so it cannot
    // become an open write into the audit trail.
    for (const e of parsed.data.events ?? []) {
      await logActivity({
        user: me,
        clientId: location.clientId,
        locationId: location.id,
        action: `device.${e.kind}`,
        entity: "Device",
        entityId: deviceId,
        summary: `${device.name}: ${e.summary}`,
        details: { occurredAt: e.occurredAt, offline: true },
      });
    }

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
