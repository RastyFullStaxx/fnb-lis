import { prisma } from "../db";

/**
 * Trailing average for the history-based outlier check
 * (docs/2026-08-01-weight-outlier-warning-plan.md §3, §6 step 5; phases doc
 * Phase 2). The average of this item's last few ACTIVE CountLine
 * remainingContent values at this location — `locationItemId` is already
 * indexed (schema `@@index([locationItemId])`), so no new migration.
 *
 * Shared by routes/counts.ts (save-time enforcement, Phase 5) and
 * routes/location-items.ts (the live-preview endpoint, Phase 3/4) — one
 * query, so the number a counter sees while typing can never disagree with
 * the number the server checks against at save.
 *
 * Returns null when there's no history yet, so checkContentVsHistory (a pure
 * function, no I/O, in @fnb/core) stays silent rather than guessing — same
 * "derived, not configured" fallback resolveDensityFactor already uses
 * (plan §3, §8).
 */
const TRAILING_HISTORY_SAMPLE_SIZE = 5;

/**
 * `excludeLineId` is what makes the SAVE-TIME check able to fire at all.
 *
 * The server runs its check AFTER the line is written, so without this the new
 * value sits in its own baseline -- and the arithmetic then caps the ratio at
 * the sample size. With N = 5 and one value V against four normal ones summing
 * to s, the ratio is 5V/(V+s), which approaches 5 from below and never reaches
 * it however absurd V gets: 100,000 bottles against a history of ~13 scores
 * 4.99. Since the high threshold IS 5, the save-time high-side check could
 * never fire on any input. Measured, not reasoned about after the fact -- a
 * 1300-bottle probe against a 13-bottle history logged nothing.
 *
 * The live preview was always correct: it runs before the row exists, so its
 * baseline is clean. Only the server copy -- the one that covers device pushes
 * and direct API calls, the paths with no preview at all -- was affected.
 */


/**
 * The same average for FULL (whole-unit) count lines -- what `qtyFull` usually
 * is for this item here. Separate query rather than a parameter on the one
 * above because the two read different columns and must never be mixed: a
 * bottle count and a millilitre reading share no scale.
 */
export async function getTrailingFullQty(
  locationItemId: string,
  excludeLineId?: string,
): Promise<number | null> {
  const recent = await prisma.countLine.findMany({
    where: {
      locationItemId,
      countType: "FULL",
      status: "ACTIVE",
      // A line whose SESSION was voided is not history. The line keeps
      // status ACTIVE when a whole session is voided -- only the session flips
      // -- so without this a count thrown away as a mistake goes on shaping
      // every future warning for that item. Found the honest way: probe rows
      // from a voided session moved this item's baseline from 13 to 5,717.
      countSession: { status: { not: "VOID" } },
      ...(excludeLineId ? { id: { not: excludeLineId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: TRAILING_HISTORY_SAMPLE_SIZE,
    select: { qtyFull: true },
  });
  if (recent.length === 0) return null;
  return recent.reduce((total, row) => total + row.qtyFull, 0) / recent.length;
}

export async function getTrailingAverage(
  locationItemId: string,
  excludeLineId?: string,
): Promise<number | null> {
  const recent = await prisma.countLine.findMany({
    where: {
      locationItemId,
      countType: "WEIGH",
      status: "ACTIVE",
      // A line whose SESSION was voided is not history. The line keeps
      // status ACTIVE when a whole session is voided -- only the session flips
      // -- so without this a count thrown away as a mistake goes on shaping
      // every future warning for that item. Found the honest way: probe rows
      // from a voided session moved this item's baseline from 13 to 5,717.
      countSession: { status: { not: "VOID" } },
      ...(excludeLineId ? { id: { not: excludeLineId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: TRAILING_HISTORY_SAMPLE_SIZE,
    select: { remainingContent: true },
  });
  if (recent.length === 0) return null;
  const sum = recent.reduce((total, row) => total + row.remainingContent, 0);
  return sum / recent.length;
}
