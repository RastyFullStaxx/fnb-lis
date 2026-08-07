import { prisma } from "../db";
import { AppError } from "./errors";

/**
 * Closed periods (Phase 2 of the snapshots/what-if build, 2026-08-06).
 *
 * Until this existed, "Final" was a word rather than a state. Anyone with the
 * rights could revise a finished period at any time — which is precisely how a
 * Final Report comes to be revised, the thing the client asked about. A lock
 * makes the close real: the figures behind a signed-off report stop moving
 * until somebody deliberately reopens them, on the record.
 *
 * Enforced HERE, server-side, and not in the browser: a desktop replaying its
 * outbox never renders a screen, and its writes are exactly as capable of
 * moving a closed period as anyone's (sync doc §7).
 *
 * Business dates are TEXT `YYYY-MM-DD`, so `begin <= date <= end` is a plain
 * string comparison — that format sorts lexicographically in date order, which
 * is the whole reason it is stored this way (architecture.md §2).
 */

export interface ActiveLock {
  id: string;
  begin: string;
  end: string;
  lockedByName: string;
  reason: string | null;
}

/** The lock covering this date, if any. */
export async function findLock(locationId: string, businessDate: string): Promise<ActiveLock | null> {
  return prisma.periodLock.findFirst({
    where: {
      locationId,
      status: "LOCKED",
      begin: { lte: businessDate },
      end: { gte: businessDate },
    },
    select: { id: true, begin: true, end: true, lockedByName: true, reason: true },
  });
}

/**
 * Refuse to touch a closed period.
 *
 * The message names the period and the way out, because "this period is
 * locked" with no further help is a dead end for the person who most needs to
 * act on it. Reopening is a real, permitted operation — it is just one that
 * leaves a record.
 */
export async function assertPeriodOpen(
  locationId: string,
  businessDate: string,
  what = "record",
): Promise<void> {
  const lock = await findLock(locationId, businessDate);
  if (!lock) return;
  throw new AppError(
    409,
    `${lock.begin} to ${lock.end} is closed${lock.reason ? ` (${lock.reason})` : ""}, so this ${what} cannot be changed. ` +
      `An owner or manager can reopen the period in Settings — reopening is recorded, with a reason.`,
    "PERIOD_LOCKED",
  );
}

/**
 * Does this lock overlap one that already exists?
 *
 * Two locks covering the same day are not wrong so much as unanswerable: the
 * refusal message would have to name one of them arbitrarily, and releasing
 * that one would appear to do nothing. One lock per stretch of time keeps
 * "is this date closed" a question with a single answer.
 */
export async function findOverlap(
  locationId: string,
  begin: string,
  end: string,
): Promise<ActiveLock | null> {
  return prisma.periodLock.findFirst({
    where: {
      locationId,
      status: "LOCKED",
      // Overlap, not containment: any two ranges intersect unless one ends
      // before the other starts.
      begin: { lte: end },
      end: { gte: begin },
    },
    select: { id: true, begin: true, end: true, lockedByName: true, reason: true },
  });
}
