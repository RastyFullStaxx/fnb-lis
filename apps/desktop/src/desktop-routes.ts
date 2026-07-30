import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { z } from "zod";
import type Database from "better-sqlite3";
import { conflicts, pending } from "./sync/outbox";

/**
 * Routes that exist ONLY on the embedded desktop server.
 *
 * Mounted by host.ts, never by `createApp()` — the hosted server must not carry
 * any of this. Everything here is desktop chrome (unlock, sync state), not
 * business API, so nothing in apps/server needs to know it exists.
 *
 * All of it is under `/_desktop/` so it can never collide with an SPA route.
 */

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 60 * 60 * 1000;

/** Device-local PIN attempt state — see DevicePin in the server schema. */
export const LOCKOUT_DDL = `
CREATE TABLE IF NOT EXISTS "_pinAttempts" (
  "userId"      TEXT PRIMARY KEY,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "failedAt"    INTEGER,
  -- Kept until the next successful sync, then reported via /sync/ack so an
  -- administrator can see a burst of attempts. A lockout nobody can see is
  -- half a control.
  "reported"    INTEGER NOT NULL DEFAULT 0
);
`;

interface UnlockDeps {
  db: Database.Database;
  /** From config.json — the device this machine registered as. */
  deviceId: string;
  deviceName: string;
  clientId: string;
  locationId: string;
  verifyPassword: (plain: string, stored: string) => Promise<boolean>;
  createSession: (
    userId: string,
    role: string,
    ip?: string,
    userAgent?: string,
    deviceId?: string,
  ) => Promise<{ token: string; expiresAt: Date }>;
  sessionCookieName: string;
  onSync: () => Promise<unknown>;
}

const unlockBody = z.object({ userId: z.string().min(1), pin: z.string().min(1) });

export function desktopRoutes(deps: UnlockDeps) {
  const { db } = deps;

  /**
   * The local Device row.
   *
   * `sessionMiddleware` resolves AuthSession→Device and rejects the session if
   * the device is not ACTIVE, so a device-bound LOCAL session needs a local
   * Device row to point at. The snapshot does not carry one — a device does not
   * mirror itself — so the machine writes its own from config.
   */
  const ensureLocalDevice = () => {
    db.prepare(
      `INSERT OR IGNORE INTO "Device" (id, clientId, locationId, name, fingerprint, status, registeredAt)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)`,
    ).run(deps.deviceId, deps.clientId, deps.locationId, deps.deviceName, `local:${deps.deviceId}`);
  };

  const lockoutState = (userId: string) => {
    const row = db.prepare(`SELECT failedCount, failedAt FROM "_pinAttempts" WHERE userId = ?`).get(userId) as
      | { failedCount: number; failedAt: number | null }
      | undefined;
    if (!row?.failedAt) return { locked: false, remainingMs: 0, failedCount: row?.failedCount ?? 0 };
    const elapsed = Date.now() - row.failedAt;
    const locked = row.failedCount >= LOCKOUT_THRESHOLD && elapsed < LOCKOUT_MS;
    return { locked, remainingMs: locked ? LOCKOUT_MS - elapsed : 0, failedCount: row.failedCount };
  };

  return new Hono()
    /** Who can sign in on this machine, and whether they have a PIN set. */
    .get("/_desktop/people", (c) => {
      const rows = db
        .prepare(
          `SELECT u.id, u.username, u.firstName, u.lastName, u.role, u.status,
                  CASE WHEN p.userId IS NULL THEN 0 ELSE 1 END AS hasPin
             FROM "User" u LEFT JOIN "DevicePin" p ON p.userId = u.id
            ORDER BY u.firstName`,
        )
        .all() as Array<Record<string, unknown>>;
      return c.json({ people: rows, deviceName: deps.deviceName });
    })

    .post("/_desktop/unlock", async (c) => {
      const parsed = unlockBody.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) return c.json({ error: "Pick a name and enter your PIN" }, 400);
      const { userId, pin } = parsed.data;

      // Local lockout. The server's counter is unreachable offline, which is
      // exactly when this matters: a 4-digit PIN is 10,000 guesses, and without
      // throttling a coworker has all night.
      const state = lockoutState(userId);
      if (state.locked) {
        const mins = Math.ceil(state.remainingMs / 60000);
        return c.json({ error: `Too many wrong PINs. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` }, 423);
      }

      const user = db
        .prepare(`SELECT id, role, status, firstName, lastName FROM "User" WHERE id = ?`)
        .get(userId) as { id: string; role: string; status: string; firstName: string; lastName: string } | undefined;
      if (!user) return c.json({ error: "Unknown user" }, 404);
      if (user.status !== "ACTIVE") return c.json({ error: "That account has been disabled." }, 403);

      const stored = db.prepare(`SELECT pinHash FROM "DevicePin" WHERE userId = ?`).get(userId) as
        | { pinHash: string }
        | undefined;
      if (!stored) {
        return c.json(
          { error: "No PIN set for this account. Set one from the web app while you have internet." },
          400,
        );
      }

      if (!(await deps.verifyPassword(pin, stored.pinHash))) {
        db.prepare(
          `INSERT INTO "_pinAttempts" (userId, failedCount, failedAt, reported)
           VALUES (?, 1, ?, 0)
           ON CONFLICT(userId) DO UPDATE SET failedCount = failedCount + 1, failedAt = excluded.failedAt, reported = 0`,
        ).run(userId, Date.now());
        const after = lockoutState(userId);
        return c.json(
          {
            error: after.locked
              ? "Too many wrong PINs. Locked for an hour."
              : `Wrong PIN. ${LOCKOUT_THRESHOLD - after.failedCount} attempt${LOCKOUT_THRESHOLD - after.failedCount === 1 ? "" : "s"} left.`,
          },
          401,
        );
      }

      db.prepare(`DELETE FROM "_pinAttempts" WHERE userId = ?`).run(userId);
      ensureLocalDevice();

      // A LOCAL, device-bound session. Nothing about it reaches the server —
      // the machine's own device session (config.json) is what talks upstream.
      const { token, expiresAt } = await deps.createSession(user.id, user.role, "127.0.0.1", "LIS Desktop", deps.deviceId);
      setCookie(c, deps.sessionCookieName, token, {
        httpOnly: true,
        sameSite: "Lax",
        secure: false, // http://127.0.0.1 — a Secure cookie would never be stored
        path: "/",
        expires: expiresAt,
      });
      return c.json({
        ok: true,
        user: { id: user.id, firstName: user.firstName, lastName: user.lastName },
        /**
         * Where to go after unlocking: straight to work.
         *
         * The landing page is the app's FRONT DOOR — the desktop opens there and
         * "Open the System" leads here. Returning to it after a successful PIN
         * would loop someone back to the door they just came through.
         */
        landing: `/l/${deps.locationId}/dashboard`,
      });
    })

    /** Everything the status banner shows. */
    .get("/_desktop/sync", (c) => {
      const queued = pending(db, 5000).length;
      const stuck = conflicts(db).length;
      const lastPush = db.prepare(`SELECT MAX(pushedAt) AS t FROM "_outbox"`).get() as { t: number | null };
      return c.json({
        queued,
        conflicts: stuck,
        lastPushAt: lastPush?.t ?? null,
        deviceName: deps.deviceName,
      });
    })

    .get("/_desktop/conflicts", (c) => c.json({ conflicts: conflicts(db) }))

    .post("/_desktop/sync-now", async (c) => {
      try {
        return c.json({ ok: true, result: await deps.onSync() });
      } catch (err) {
        return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
      }
    })

    /**
     * Discard a conflicted entry after a human has dealt with it. Never
     * automatic: the whole point of the inbox is that a person decides.
     */
    .post("/_desktop/conflicts/:seq/dismiss", (c) => {
      db.prepare(`DELETE FROM "_outbox" WHERE seq = ? AND conflictAt IS NOT NULL`).run(Number(c.req.param("seq")));
      return c.json({ ok: true });
    });
}

/** Unreported PIN failures, drained into the next /sync/ack. */
export function drainPinEvents(db: Database.Database): Array<{ kind: string; summary: string; occurredAt: string }> {
  const rows = db
    .prepare(
      `SELECT a.userId, a.failedCount, a.failedAt, u.username
         FROM "_pinAttempts" a LEFT JOIN "User" u ON u.id = a.userId
        WHERE a.reported = 0 AND a.failedAt IS NOT NULL`,
    )
    .all() as Array<{ userId: string; failedCount: number; failedAt: number; username: string | null }>;
  if (rows.length === 0) return [];
  db.prepare(`UPDATE "_pinAttempts" SET reported = 1 WHERE reported = 0`).run();
  return rows.map((r) => ({
    kind: r.failedCount >= LOCKOUT_THRESHOLD ? "pinLockout" : "pinFailed",
    summary: `${r.failedCount} failed PIN attempt${r.failedCount === 1 ? "" : "s"} for ${r.username ?? r.userId}`,
    occurredAt: new Date(r.failedAt).toISOString(),
  }));
}
