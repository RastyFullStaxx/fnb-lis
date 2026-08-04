import type { SessionUser } from "@fnb/core";
import type { Tx } from "../db";
import { prisma } from "../db";
import { AppError } from "./errors";

/**
 * The two-way sync rules (docs/sync-and-data-lifecycle.md §7.2), in one file
 * because they are cross-cutting and each one is easy to half-apply.
 *
 * Context: the browser and the offline desktop both write. That is safe for
 * almost everything, because almost every write here is an append with a
 * globally-unique id — two sources inserting different rows have nothing to
 * merge. Only four surfaces are NOT pure appends, and these helpers close them.
 */

// ─────────────────────────── Rule 1: draft ownership ───────────────────────────

/**
 * While a document is OPEN or DRAFT, only the source that started it may touch
 * it. A count opened on the bar PC stays editable there until committed; the
 * browser sees it read-only.
 *
 * This DELETES the draft-merge problem rather than resolving it, and it matches
 * how the work actually happens — one person is walking round with the scale.
 * Merging two people's simultaneous edits to one in-progress count is a problem
 * worth not having.
 *
 * Committed and voided documents are deliberately NOT covered: at that point the
 * document is immutable and every further change is an append (void +
 * correctionOfId), which cannot conflict.
 *
 * `null` originDeviceId means the browser. Two browser sessions editing the same
 * draft is the pre-existing behaviour and is unchanged — they are talking to one
 * server with one copy of the row, so there is no divergence to reconcile.
 */
export function assertMayEditDraft(
  doc: { originDeviceId: string | null; status: string },
  user: SessionUser,
  what: string,
): void {
  const open = doc.status === "OPEN" || doc.status === "DRAFT";
  if (!open) return;

  const actor = user.deviceId ?? null;
  if (actor === doc.originDeviceId) return;

  throw new AppError(
    409,
    doc.originDeviceId
      ? `This ${what} is being worked on another computer. It will appear here once that computer commits or syncs it.`
      : `This ${what} was started in the web app. Finish it there, or ask an owner to release it.`,
    "DRAFT_OWNED_ELSEWHERE",
  );
}

/** The originDeviceId to stamp on a document this request is creating. */
export function originOf(user: SessionUser): string | null {
  return user.deviceId ?? null;
}

// ──────────────────── Rule 2: replay-safe status transitions ────────────────────

/**
 * Has this exact operation already been applied?
 *
 * Only meaningful for mutations that do NOT create a row. A create carries its
 * own primary key and the key does this job for free; a void or a commit changes
 * an existing row, so without a token a replayed void is indistinguishable from
 * a *different* person having voided the same record in the browser meanwhile —
 * and those two need opposite handling (silent success vs. surface a conflict).
 */
export async function opAlreadyApplied(opId: string | undefined): Promise<boolean> {
  if (!opId) return false;
  return (await prisma.syncOp.findUnique({ where: { opId } })) !== null;
}

/**
 * Record an applied operation. MUST be called inside the same transaction as
 * the mutation — a crash between the two would let the operation apply twice,
 * which is the exact failure this table exists to prevent.
 */
export async function recordOp(
  tx: Tx,
  opId: string | undefined,
  user: SessionUser,
  entity: string,
  entityId: string,
  action: string,
): Promise<void> {
  if (!opId) return;
  await tx.syncOp.create({
    data: { opId, userId: user.id, deviceId: user.deviceId ?? null, entity, entityId, action },
  });
}

/**
 * Compare-and-set on a document's status.
 *
 * When a client says what it believed the status to be and reality disagrees,
 * that is a genuine conflict — someone else moved the record while this device
 * was offline. It must reach a human, so it is a 409 carrying the ACTUAL state
 * rather than a silent overwrite or a bare "already committed", which a device
 * cannot tell apart from its own replay.
 *
 * Omitting `expected` keeps the old behaviour, so the browser is unaffected.
 */
export function assertExpectedStatus(
  current: string,
  expected: string | undefined,
  what: string,
): void {
  if (!expected || expected === current) return;
  throw new AppError(
    409,
    `This ${what} changed elsewhere — it is now ${current.toLowerCase()}, not ${expected.toLowerCase()}. Review the current version before repeating that action.`,
    "STATUS_CONFLICT",
  );
}

/**
 * Assert, *atomically*, that a parent document is still open — and keep it open
 * for the rest of the transaction.
 *
 * `assertExpectedStatus` above compares the client's belief against a status the
 * route read a moment earlier, outside any transaction. That closes the
 * offline-divergence case it was built for, but not a race: between the read and
 * the write, another connection can commit the parent. The line insert then
 * lands on a COMMITTED count — its ending quantity moves after the audit period
 * closed, and the `count.commit` summary's "(N lines)" is already wrong. Nothing
 * downstream can detect it, because the row looks perfectly ordinary.
 *
 * The guard is a CONDITIONAL SELF-WRITE: `UPDATE … SET status = 'OPEN' WHERE
 * id = ? AND status = 'OPEN'`. It writes the value already there, so no data
 * changes and none of these three models carries `@updatedAt` to disturb — but
 * it is a real write, so SQLite takes the row's write lock and holds it until
 * this transaction ends. A concurrent commit either waits (busy_timeout 5s) and
 * then finds its own `WHERE status = 'OPEN'` still true, or it got there first
 * and this matches zero rows.
 *
 * Both orderings are therefore correct rather than merely unlikely:
 *   line-then-commit → the line is inside the count, commit counts it;
 *   commit-then-line → zero rows matched, the insert is refused with a 409.
 *
 * Pass a thunk rather than a model name because Prisma's delegates are
 * separately typed; the call site names the model and the open status it means.
 */
export async function holdParentOpen(
  conditionalTouch: () => Promise<{ count: number }>,
  what: string,
): Promise<void> {
  const { count } = await conditionalTouch();
  if (count === 0) {
    throw new AppError(
      409,
      `This ${what} was committed or voided while you were working on it. Nothing was saved — reload to see the current version.`,
      "STATUS_CONFLICT",
    );
  }
}

/**
 * The commit/void flip itself, as compare-and-set.
 *
 * The flips were unconditional `update({ where: { id } })`, so two commits
 * arriving together both passed the pre-check and both wrote — the second
 * silently overwriting `committedAt`/`committedById`, so the trail credited the
 * wrong person at the wrong time. §7.2 Rule 2 asks for compare-and-set here in
 * so many words; this makes the status transition itself do the deciding.
 */
export async function transitionStatus(
  conditionalUpdate: () => Promise<{ count: number }>,
  what: string,
  to: string,
): Promise<void> {
  const { count } = await conditionalUpdate();
  if (count === 0) {
    throw new AppError(
      409,
      `This ${what} is no longer in a state that can be ${to}. Someone else changed it — reload to see the current version.`,
      "STATUS_CONFLICT",
    );
  }
}

// ───────────────────── Rule 3: catalog stays server-authoritative ─────────────────────

/**
 * Catalog and master data (prices, weights, suppliers, recipes) may not be
 * edited from a queued/offline context.
 *
 * `LocationItem` carries cost and retail — the inputs to every valuation — and
 * last-write-wins on a price is how an establishment's stated inventory value
 * changes without anyone deciding to change it.
 *
 * Note what this does NOT do: a desktop that is ONLINE is just another client,
 * and its edit reaches the one server copy with no divergence, so it is allowed.
 * The rule bites on *queued* edits, and it is enforced structurally — the
 * catalog and master zod schemas do not carry `syncFields`, so a catalog edit
 * has no idempotency key and no `occurredAt` and therefore cannot be replayed
 * from an outbox at all. This function exists to make that guarantee explicit
 * and testable rather than an accident of which schemas got extended.
 */
export async function assertNotQueuedEdit(c: { req: { json: () => Promise<unknown> } }, what: string): Promise<void> {
  // The RAW body, not the zod-validated one. The catalog schemas are not
  // `.strict()`, so zod silently STRIPS `occurredAt`/`opId` — meaning a queued
  // edit would sail through validation looking like a live one and apply
  // last-write-wins. Reading the raw body is the only way to see the marker
  // that says this edit was composed offline.
  const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (raw && (raw.occurredAt !== undefined || raw.opId !== undefined)) {
    throw new AppError(
      400,
      `${what} can't be changed while offline — reconnect and try again.`,
      "ONLINE_ONLY",
    );
  }
}
