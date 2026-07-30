import type Database from "better-sqlite3";

/**
 * The queue of local writes waiting to reach the server.
 *
 * Captured at the HTTP layer, not the database layer, because the replay target
 * is the remote REST API: replaying row mutations against it is meaningless,
 * whereas replaying the original request is exact. It also means the desktop
 * cannot drift from the browser on validation, permissions or activity logging
 * — there is one write path and both use it.
 *
 * Lives in its own table in the mirror, outside anything the Prisma schema
 * knows about, so it never appears in a snapshot merge.
 */

export const OUTBOX_DDL = `
CREATE TABLE IF NOT EXISTS "_outbox" (
  "seq"           INTEGER PRIMARY KEY AUTOINCREMENT,
  "method"        TEXT NOT NULL,
  "path"          TEXT NOT NULL,
  "body"          TEXT,
  -- WHO did it. Attribution is carried in a header, not the body, so without
  -- storing it here every replayed record would be credited to whoever
  -- registered the machine — the exact "confident lie" the acting-user work
  -- exists to prevent, and invisible afterwards because the rows look fine.
  "actingUserId"  TEXT,
  -- The ids this request creates, so the reconciler can ask the server whether
  -- they ever landed (see engine.ts).
  "recordIds"     TEXT,
  -- Monotonic ms since process start, NOT wall clock. See stampOccurredAt.
  "capturedAtMono" INTEGER NOT NULL,
  "capturedAtWall" INTEGER NOT NULL,
  -- Set once the server accepts it; the row is kept briefly for reconciliation.
  "pushedAt"      INTEGER,
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "lastError"     TEXT,
  -- Non-null once a human must look at it (see the conflict inbox).
  "conflictAt"    INTEGER,
  "conflictBody"  TEXT
);
CREATE INDEX IF NOT EXISTS "_outbox_pending" ON "_outbox" ("pushedAt", "seq");
`;

export interface OutboxEntry {
  seq: number;
  method: string;
  path: string;
  body: string | null;
  actingUserId: string | null;
  recordIds: string | null;
  capturedAtWall: number;
  attempts: number;
}

/** Paths that must NEVER be queued — see `collapse` and Rule 3. */
const NEVER_QUEUE = [/\/location-items\//, /\/suppliers\//, /\/menus\//, /\/master\//];

/**
 * Rule 3, enforced where it actually bites.
 *
 * The server-side guard (`assertNotQueuedEdit`) only rejects an edit that
 * CARRIES offline markers — and a replayed catalog PUT carries none, because the
 * catalog schemas deliberately never had sync fields. So the server backstop
 * would happily accept a stale 2am price as a live edit. The enforcement point
 * has to be here: the outbox refuses to enqueue catalog and master paths at all,
 * and the desktop disables those screens while offline.
 */
export function isQueueable(path: string): boolean {
  return !NEVER_QUEUE.some((re) => re.test(path));
}

export function recordWrite(
  db: Database.Database,
  entry: {
    method: string;
    path: string;
    body: unknown;
    actingUserId: string | null;
    recordIds: string[];
    capturedAtMono: number;
  },
): void {
  if (!isQueueable(entry.path)) return;
  db.prepare(
    `INSERT INTO "_outbox" (method, path, body, actingUserId, recordIds, capturedAtMono, capturedAtWall)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.method,
    entry.path,
    entry.body === undefined ? null : JSON.stringify(entry.body),
    entry.actingUserId,
    JSON.stringify(entry.recordIds),
    entry.capturedAtMono,
    Date.now(),
  );
}

export function pending(db: Database.Database, limit = 500): OutboxEntry[] {
  return db
    .prepare(
      `SELECT seq, method, path, body, actingUserId, recordIds, capturedAtWall, attempts
         FROM "_outbox" WHERE pushedAt IS NULL AND conflictAt IS NULL ORDER BY seq ASC LIMIT ?`,
    )
    .all(limit) as OutboxEntry[];
}

/**
 * Drop work that no longer needs pushing.
 *
 * A record created and then deleted before either reached the server is a pair
 * of requests the server should never see: replaying them means a create the
 * remote accepts followed by a DELETE, which is more round trips and more ways
 * to fail for a net effect of nothing. Collapsing also removes the commonest
 * source of a stalled chain — a DELETE whose target the server never had.
 */
export function collapse(db: Database.Database): number {
  const rows = db
    .prepare(`SELECT seq, method, path, recordIds FROM "_outbox" WHERE pushedAt IS NULL AND conflictAt IS NULL`)
    .all() as Array<{ seq: number; method: string; path: string; recordIds: string | null }>;

  const createdSeqById = new Map<string, number>();
  const drop = new Set<number>();
  for (const r of rows) {
    const ids: string[] = r.recordIds ? JSON.parse(r.recordIds) : [];
    if (r.method === "POST") {
      for (const id of ids) createdSeqById.set(id, r.seq);
    } else if (r.method === "DELETE") {
      // The deleted id is the last path segment.
      const target = r.path.split("/").pop() ?? "";
      const createSeq = createdSeqById.get(target);
      if (createSeq !== undefined) {
        drop.add(createSeq);
        drop.add(r.seq);
        createdSeqById.delete(target);
      }
    }
  }
  if (drop.size === 0) return 0;
  const stmt = db.prepare(`DELETE FROM "_outbox" WHERE seq = ?`);
  const tx = db.transaction(() => drop.forEach((seq) => stmt.run(seq)));
  tx();
  return drop.size;
}

/**
 * Rewrite `occurredAt` at PUSH time, from a monotonic capture plus the measured
 * server clock offset.
 *
 * A bar PC's CMOS battery dies and its clock jumps three days forward. The
 * server rejects any `occurredAt` more than a day ahead — a 400, not a conflict
 * — and because the body was frozen at capture time, no retry can ever succeed.
 * The night becomes unrecoverable without hand-editing SQLite. The reverse case
 * is worse for being silent: a clock that resets backwards passes validation and
 * quietly lies about when everything happened.
 *
 * So the wall clock is never trusted for this. Capture stores a monotonic
 * reading; push converts it using the offset derived from the server's own
 * `Date` header.
 */
export function stampOccurredAt(
  body: unknown,
  capturedAtMono: number,
  nowMono: number,
  serverNowMs: number,
): unknown {
  if (body === null || typeof body !== "object") return body;
  const ageMs = nowMono - capturedAtMono;
  return { ...(body as Record<string, unknown>), occurredAt: new Date(serverNowMs - ageMs).toISOString() };
}

export function markPushed(db: Database.Database, seq: number): void {
  db.prepare(`UPDATE "_outbox" SET pushedAt = ? WHERE seq = ?`).run(Date.now(), seq);
}

export function markConflict(db: Database.Database, seq: number, status: number, body: string): void {
  db.prepare(`UPDATE "_outbox" SET conflictAt = ?, lastError = ?, conflictBody = ? WHERE seq = ?`).run(
    Date.now(),
    `HTTP ${status}`,
    body,
    seq,
  );
}

export function markAttempt(db: Database.Database, seq: number, error: string): void {
  db.prepare(`UPDATE "_outbox" SET attempts = attempts + 1, lastError = ? WHERE seq = ?`).run(error, seq);
}

/** Ids this device believes it pushed — the input to server-side reconciliation. */
export function pushedRecordIds(db: Database.Database, limit = 2000): string[] {
  const rows = db
    .prepare(`SELECT recordIds FROM "_outbox" WHERE pushedAt IS NOT NULL ORDER BY seq DESC LIMIT ?`)
    .all(limit) as Array<{ recordIds: string | null }>;
  return rows.flatMap((r) => (r.recordIds ? (JSON.parse(r.recordIds) as string[]) : []));
}

export function conflicts(db: Database.Database): OutboxEntry[] {
  return db
    .prepare(
      `SELECT seq, method, path, body, actingUserId, recordIds, capturedAtWall, attempts
         FROM "_outbox" WHERE conflictAt IS NOT NULL ORDER BY seq ASC`,
    )
    .all() as OutboxEntry[];
}
