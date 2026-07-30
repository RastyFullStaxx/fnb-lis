import { createMiddleware } from "hono/factory";
import type Database from "better-sqlite3";
import { ACTING_USER_HEADER } from "../../../server/src/middleware/auth";
import { isQueueable, recordWrite } from "./outbox";

/**
 * Records every successful local write into the outbox.
 *
 * Applied ONLY to the desktop's embedded server — the hosted server must never
 * carry this. It sits outside the route handlers, which is deliberate: it means
 * no route file has to know the desktop exists, and the desktop cannot drift
 * from the browser by forgetting to instrument one.
 *
 * The known cost of being outside the handler is that this runs after the
 * route's `$transaction` has already committed, so a crash in between writes a
 * record with no outbox entry. That gap is closed by reconciliation
 * (engine.ts), not by pretending it does not exist.
 */

/** Ids the response created, so reconciliation can ask if they ever landed. */
function idsFrom(payload: unknown): string[] {
  if (Array.isArray(payload)) return payload.flatMap(idsFrom);
  if (payload && typeof payload === "object") {
    const id = (payload as { id?: unknown }).id;
    return typeof id === "string" ? [id] : [];
  }
  return [];
}

export function captureWrites(db: Database.Database) {
  return createMiddleware(async (c, next) => {
    const method = c.req.method;
    const isWrite = method === "POST" || method === "PUT" || method === "DELETE";

    // Read the body BEFORE the handler consumes it. Hono caches the parsed
    // body, so this does not starve the route.
    const body = isWrite ? await c.req.json().catch(() => undefined) : undefined;

    await next();

    if (!isWrite) return;
    if (c.res.status < 200 || c.res.status >= 300) return;
    if (!isQueueable(c.req.path)) return;
    // Sync endpoints are the transport, not business writes — queueing them
    // would make the device try to replay its own bookkeeping to the server.
    if (c.req.path.includes("/sync/")) return;
    // Desktop-only routes (unlock, sync-now, conflict dismissal) exist on THIS
    // server and nowhere else. Queuing them means replaying a POST the server
    // has never heard of, which 404s straight into the conflict inbox — so
    // every sign-in would leave a fake "needs attention" for a human to clear.
    if (c.req.path.startsWith("/_desktop/")) return;

    // Clone: reading the response body must not consume it for the renderer.
    let recordIds: string[] = [];
    try {
      recordIds = idsFrom(await c.res.clone().json());
    } catch {
      // Non-JSON or empty response — reconciliation simply has nothing to check
      // for this entry, which is correct rather than a failure.
    }

    recordWrite(db, {
      method,
      path: c.req.path,
      body,
      actingUserId: c.req.header(ACTING_USER_HEADER) ?? null,
      recordIds,
      // Monotonic, so a wrong wall clock cannot poison the timestamp that ends
      // up on the record (see stampOccurredAt).
      capturedAtMono: Math.round(performance.now()),
    });
  });
}
