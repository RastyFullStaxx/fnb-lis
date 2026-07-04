import { prisma } from "../db";
import { buildFullAudit, committedCountDates } from "./report-assembly";

/**
 * Dashboard aggregate for one location: where the audit stands right now,
 * what needs attention, who's been doing what, and (if a period can be closed)
 * the sharpest variance leaders. Pure read — no mutations, no ActivityLog.
 */

export interface DashboardData {
  period: {
    lastCountDate: string | null;
    daysSinceLastCount: number | null;
    countDates: number; // how many committed count dates exist
    canAudit: boolean; // ≥ 2 committed dates → a Full Audit is possible
    latest: { begin: string; end: string } | null; // the most recent closable period
  };
  attention: {
    missingPrices: number; // active location items with no cost or no retail
    unmatchedRows: number; // PENDING rows in batches awaiting review
    draftPurchases: number; // uncommitted purchases
    openCounts: number; // count sessions still open
  };
  varianceLeaders: Array<{
    locationItemId: string;
    itemName: string;
    variancePct: number | null;
    varianceCost: number;
    short: boolean;
  }>;
  recentActivity: Array<{
    id: string;
    ts: string;
    userName: string | null;
    action: string;
    summary: string;
  }>;
}

/** Days between two YYYY-MM-DD dates, computed in UTC to dodge the +8 shift. */
function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.UTC(+fromDate.slice(0, 4), +fromDate.slice(5, 7) - 1, +fromDate.slice(8, 10));
  const b = Date.UTC(+toDate.slice(0, 4), +toDate.slice(5, 7) - 1, +toDate.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

function todayBusinessDate(): string {
  // Server-local calendar day; dashboard freshness is a display concern, not core math.
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function buildDashboard(locationId: string, clientId: string): Promise<DashboardData> {
  const dates = await committedCountDates(locationId);
  const lastCountDate = dates.at(-1) ?? null;
  const canAudit = dates.length >= 2;
  const latest: { begin: string; end: string } | null = canAudit
    ? { begin: dates[dates.length - 2]!, end: dates[dates.length - 1]! }
    : null;

  const [
    priceItems,
    unmatchedRows,
    draftPurchases,
    openCounts,
    recent,
  ] = await Promise.all([
    prisma.locationItem.findMany({
      where: { locationId, isActive: true },
      select: { cost: true, retail: true },
    }),
    prisma.importRow.count({
      where: { status: "PENDING", batch: { locationId, status: "NEEDS_REVIEW" } },
    }),
    prisma.purchase.count({ where: { locationId, status: "DRAFT" } }),
    prisma.countSession.count({ where: { locationId, status: "OPEN" } }),
    prisma.activityLog.findMany({
      where: { OR: [{ locationId }, { clientId, locationId: null }] },
      orderBy: { ts: "desc" },
      take: 8,
      select: { id: true, ts: true, userName: true, action: true, summary: true },
    }),
  ]);

  const missingPrices = priceItems.filter((p) => p.cost <= 0 || p.retail <= 0).length;

  let varianceLeaders: DashboardData["varianceLeaders"] = [];
  if (latest) {
    const report = await buildFullAudit(locationId, latest.begin, latest.end);
    varianceLeaders = report.rows
      .filter((r) => r.varianceCost !== 0)
      .sort((a, b) => Math.abs(b.varianceCost) - Math.abs(a.varianceCost))
      .slice(0, 6)
      .map((r) => ({
        locationItemId: r.locationItemId,
        itemName: r.itemName,
        variancePct: r.variancePct,
        varianceCost: r.varianceCost,
        short: r.variance < 0,
      }));
  }

  return {
    period: {
      lastCountDate,
      daysSinceLastCount: lastCountDate ? daysBetween(lastCountDate, todayBusinessDate()) : null,
      countDates: dates.length,
      canAudit,
      latest,
    },
    attention: { missingPrices, unmatchedRows, draftPurchases, openCounts },
    varianceLeaders,
    recentActivity: recent.map((a) => ({
      id: a.id,
      ts: a.ts.toISOString(),
      userName: a.userName,
      action: a.action,
      summary: a.summary,
    })),
  };
}
