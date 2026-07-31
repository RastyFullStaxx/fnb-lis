import type Database from "better-sqlite3";
import { applySnapshot } from "./apply-snapshot";
import {
  collapse,
  getState,
  markAttempt,
  markConflict,
  markPushed,
  pending,
  pendingRecordIds,
  pushedRecordIds,
  requeue,
  setState,
  stampOccurredAt,
} from "./outbox";

/** Cursor key in `_sync_state`: the `generatedAt` of the last applied snapshot. */
const LAST_PULL_KEY = "lastPullAt";

/**
 * Push, reconcile, pull. Runs in the utility process alongside the local server.
 *
 * Everything here assumes the local server is authoritative for the user's
 * experience and the remote is authoritative for the truth. The engine never
 * silently resolves a disagreement between them — anything the remote refuses
 * goes to a conflict inbox a human reads.
 */

export interface RemoteConfig {
  baseUrl: string;
  locationId: string;
  /** Session cookie for the device-bound session. */
  cookie: string;
}

/** Server time minus local time, measured from the response `Date` header. */
let clockOffsetMs = 0;

function noteServerClock(res: Response): void {
  const header = res.headers.get("date");
  if (!header) return;
  const serverMs = Date.parse(header);
  if (Number.isFinite(serverMs)) clockOffsetMs = serverMs - Date.now();
}

export function serverNow(): number {
  return Date.now() + clockOffsetMs;
}

export function clockSkewMs(): number {
  return clockOffsetMs;
}

/**
 * Is this response a CONVERGENT outcome rather than a conflict?
 *
 * A DELETE whose target is already gone, and a void that was already applied,
 * both mean "the world is in the state this request wanted". Treating them as
 * failures is what turns one lost response into a stalled causal chain: the
 * DELETE retries forever, the commit queued behind it never pushes, and a whole
 * count session never reaches the server while the browser's Full Audit quietly
 * omits it.
 */
function isConvergent(method: string, status: number): boolean {
  if (method === "DELETE" && status === 404) return true;
  // Idempotent replays already answer 200 by design (lib/idempotency.ts), so
  // they never reach here — this is only for the delete case.
  return false;
}

interface PushOutcome {
  pushed: number;
  conflicts: number;
  stalled: boolean;
}

/**
 * Replay the queue in sequence order.
 *
 * Order is causal, not merely chronological: a line cannot precede its session,
 * and a void cannot precede the record it voids. So a hard failure stops the
 * run rather than skipping ahead — pushing a void whose target never arrived
 * would fail anyway, and pushing later independent work first would reorder the
 * audit trail.
 */
export async function push(db: Database.Database, remote: RemoteConfig): Promise<PushOutcome> {
  collapse(db);
  const queue = pending(db);
  let pushed = 0;
  let conflicts = 0;

  for (const entry of queue) {
    const body = entry.body === null ? undefined : JSON.parse(entry.body);
    // Rewritten now, from a monotonic capture — never the wall clock at capture
    // time, which may have been wrong (see stampOccurredAt).
    const corrected =
      body === undefined
        ? undefined
        : stampOccurredAt(body, entry.capturedAtWall, Date.now(), serverNow());

    let res: Response;
    try {
      res = await fetch(`${remote.baseUrl}${entry.path}`, {
        method: entry.method,
        headers: {
          "content-type": "application/json",
          cookie: remote.cookie,
          // Attribution follows the person who did the work, not the account
          // that registered the machine.
          ...(entry.actingUserId ? { "x-acting-user": entry.actingUserId } : {}),
        },
        body: corrected === undefined ? undefined : JSON.stringify(corrected),
      });
    } catch (err) {
      // Network failure is not a conflict — leave it queued and stop; the next
      // run picks up where this one left off.
      markAttempt(db, entry.seq, err instanceof Error ? err.message : "network error");
      return { pushed, conflicts, stalled: true };
    }

    noteServerClock(res);

    if (res.ok || isConvergent(entry.method, res.status)) {
      markPushed(db, entry.seq);
      pushed++;
      continue;
    }

    // 5xx is the server having a bad day: retry later, do not burn the entry.
    if (res.status >= 500) {
      markAttempt(db, entry.seq, `HTTP ${res.status}`);
      return { pushed, conflicts, stalled: true };
    }

    // 4xx is a decision: a permission change, a status conflict, a validation
    // failure. A human has to see it, and the chain stops here so nothing
    // downstream lands out of order.
    markConflict(db, entry.seq, res.status, await res.text().catch(() => ""));
    conflicts++;
    return { pushed, conflicts, stalled: true };
  }

  return { pushed, conflicts, stalled: false };
}

/**
 * Ask the server which records it never received, and re-queue them.
 *
 * Capture happens after the route's transaction commits, so a force-quit or a
 * full disk in that window writes a record locally with no outbox entry. Nothing
 * else would ever notice. This closes it, and closes every other cause of the
 * same symptom too — which is why it is the fix rather than restructuring the
 * write path of nineteen routes.
 */
export async function reconcile(
  db: Database.Database,
  remote: RemoteConfig,
): Promise<{ missing: string[] }> {
  const ids = pushedRecordIds(db);
  if (ids.length === 0) return { missing: [] };

  const res = await fetch(`${remote.baseUrl}/api/locations/${remote.locationId}/sync/reconcile`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: remote.cookie },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) return { missing: [] };
  noteServerClock(res);
  const { missing } = (await res.json()) as { missing: string[] };
  return { missing };
}

/**
 * Pull a snapshot and merge it.
 *
 * MERGE, not replace. The original design replaced the local copy wholesale,
 * which would destroy any work still sitting in the outbox — the very records
 * the device is trying to protect. Rows referenced by unpushed outbox entries
 * are left alone; everything else is overwritten from the server, which is
 * authoritative.
 *
 * `since` carries the previous response's `generatedAt`, so voids and
 * corrections applied to periods older than `from` still come back. Without it,
 * a June line voided in July would never reach a mirror bounded to July, and
 * that mirror's June Full Audit would be permanently wrong.
 */
export async function pull(
  db: Database.Database,
  remote: RemoteConfig,
  cursor: { from?: string; since?: string },
): Promise<{ generatedAt: string; payload: unknown } | null> {
  const params = new URLSearchParams();
  if (cursor.from) params.set("from", cursor.from);
  if (cursor.since) params.set("since", cursor.since);

  const res = await fetch(
    `${remote.baseUrl}/api/locations/${remote.locationId}/sync/snapshot?${params}`,
    { headers: { cookie: remote.cookie } },
  );
  if (!res.ok) return null;
  noteServerClock(res);
  const payload = (await res.json()) as { meta: { generatedAt: string } };
  return { generatedAt: payload.meta.generatedAt, payload };
}

/**
 * One full cycle: push → reconcile (and re-queue) → ack → pull and MERGE.
 *
 * Push before pull, always: pulling first would overwrite local rows with a
 * server view that does not yet contain them.
 *
 * `/sync/ack` is only called when the queue drained AND reconciliation found
 * nothing missing — otherwise `Device.lastSyncAt` would advance while work sat
 * locally, and the admin's device list would report "synced" over a night of
 * stranded counts.
 *
 * The merge still runs on a stalled cycle. Inbound truth does not depend on
 * outbound success, and a device that cannot push is precisely the one whose
 * operator most needs to see what the office changed.
 */
export async function cycle(
  db: Database.Database,
  remote: RemoteConfig,
  cursor: { from?: string },
  events: Array<{ kind: string; summary: string; occurredAt: string }> = [],
): Promise<{
  pushed: number;
  conflicts: number;
  missing: number;
  requeued: number;
  applied: number;
  keptLocal: number;
  synced: boolean;
}> {
  const outcome = await push(db, remote);

  const { missing } = await reconcile(db, remote);
  // Act on the answer, don't just count it. Reconciliation used to detect
  // records the server never received and then do nothing about them: the
  // device stayed permanently un-synced with no route back, because the entries
  // were already marked pushed and `pending()` would never look at them again.
  const requeued = requeue(db, missing);

  const clean = !outcome.stalled && outcome.conflicts === 0 && missing.length === 0;
  if (clean) {
    await fetch(`${remote.baseUrl}/api/locations/${remote.locationId}/sync/ack`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: remote.cookie },
      body: JSON.stringify({ events }),
    }).catch(() => {});
  }

  /**
   * Apply what we pulled.
   *
   * `pull` fetched a snapshot and the result was discarded, so after first-run
   * provisioning the mirror never received another byte from the server: a void
   * entered in the browser, a corrected line, a new price — none of it reached
   * the bar PC, while the desktop's own Full Audit went on reporting the numbers
   * it was provisioned with. That is the half of two-way sync this app exists
   * for, and it was never wired up.
   *
   * The cursor advances only after a merge actually succeeds, and is stored in
   * the mirror rather than config.json — see `_sync_state`.
   */
  let applied = 0;
  let keptLocal = 0;
  const pulled = await pull(db, remote, { from: cursor.from, since: getState(db, LAST_PULL_KEY) });
  if (pulled) {
    const result = applySnapshot(db, pulled.payload as Record<string, unknown>, pendingRecordIds(db));
    applied = result.total;
    keptLocal = result.skipped;
    setState(db, LAST_PULL_KEY, pulled.generatedAt);
  }

  return {
    pushed: outcome.pushed,
    conflicts: outcome.conflicts,
    missing: missing.length,
    requeued,
    applied,
    keptLocal,
    synced: clean,
  };
}
