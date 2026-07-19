import { buildFullAudit, committedCountDates } from "./report-assembly";

/**
 * Per-audit-period rollups for trend visualizations (dashboard + reports).
 * Pure read — assembles consecutive committed-count-date pairs and reuses
 * buildFullAudit for each window, so every number is the same one the Full
 * Audit report shows for that period. No new math, no rounding of its own:
 * sums of already-rounded row values, exactly like ReconTotals.
 */

export interface TrendPeriod {
  begin: string;
  end: string;
  /** Direct + menu-share revenue for the period (ReconTotals.revenue). */
  revenue: number;
  /** Usage valued at cost (ReconTotals.usageCost). */
  usageCost: number;
  /** Net variance at cost / retail (ReconTotals.varianceCost/Retail). */
  varianceCost: number;
  varianceRetail: number;
  /** Magnitude split: |Σ varianceCost| over rows with variance < 0 / > 0. */
  shortageCost: number;
  surplusCost: number;
  /** How many items missed vs. beat expectation. */
  itemsShort: number;
  itemsOver: number;
}

export interface TrendsData {
  periods: TrendPeriod[]; // oldest → newest
  totalPeriods: number; // how many closed periods exist overall
}

const MAX_PERIODS = 12;

export async function buildTrends(
  locationId: string,
  allowedProductTypes?: readonly string[] | null,
  maxPeriods = 8,
): Promise<TrendsData> {
  const cap = Math.min(Math.max(1, maxPeriods), MAX_PERIODS);
  const dates = await committedCountDates(locationId);
  const totalPeriods = Math.max(0, dates.length - 1);
  const window = dates.slice(-(cap + 1)); // last N periods need N+1 anchors

  const periods: TrendPeriod[] = [];
  // Sequential on purpose: each buildFullAudit fans out 7 queries of its own;
  // running periods serially keeps SQLite happy and is fast enough at N ≤ 12.
  for (let i = 0; i + 1 < window.length; i++) {
    const begin = window[i]!;
    const end = window[i + 1]!;
    const report = await buildFullAudit(locationId, begin, end, undefined, allowedProductTypes);

    let shortageCost = 0;
    let surplusCost = 0;
    let itemsShort = 0;
    let itemsOver = 0;
    for (const row of report.rows) {
      if (row.variance < 0) {
        shortageCost += Math.abs(row.varianceCost);
        itemsShort += 1;
      } else if (row.variance > 0) {
        surplusCost += Math.abs(row.varianceCost);
        itemsOver += 1;
      }
    }

    periods.push({
      begin,
      end,
      revenue: report.totals.revenue,
      usageCost: report.totals.usageCost,
      varianceCost: report.totals.varianceCost,
      varianceRetail: report.totals.varianceRetail,
      shortageCost,
      surplusCost,
      itemsShort,
      itemsOver,
    });
  }

  return { periods, totalPeriods };
}
