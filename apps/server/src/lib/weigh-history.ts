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

export async function getTrailingAverage(locationItemId: string): Promise<number | null> {
  const recent = await prisma.countLine.findMany({
    where: { locationItemId, countType: "WEIGH", status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    take: TRAILING_HISTORY_SAMPLE_SIZE,
    select: { remainingContent: true },
  });
  if (recent.length === 0) return null;
  const sum = recent.reduce((total, row) => total + row.remainingContent, 0);
  return sum / recent.length;
}
