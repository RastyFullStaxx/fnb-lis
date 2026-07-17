import { prisma } from "../db";
import { buildFullAudit, committedCountDates } from "./report-assembly";

/**
 * Dashboard aggregate for one location: where the audit stands right now,
 * what needs attention, who's been doing what, and (if a period can be closed)
 * the sharpest variance leaders. Pure read — no mutations, no ActivityLog.
 */

export interface DashboardData {
  generatedAt: string;
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
  readiness: {
    activeItems: number;
  };
  openWork: {
    latestCount: { id: string; date: string; lineCount: number } | null;
    latestPurchase: { id: string; invoiceRef: string | null; supplierName: string | null; updatedAt: string } | null;
  };
  varianceLeaders: Array<{
    locationItemId: string;
    itemName: string;
    variancePct: number | null;
    varianceCost: number;
    varianceRetail: number;
    short: boolean;
  }>;
  recentActivity: Array<{
    id: string;
    ts: string;
    userName: string | null;
    action: string;
    entity: string;
    entityId: string | null;
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

export async function buildDashboard(
  locationId: string,
  _clientId: string,
  allowedProductTypes?: readonly string[] | null,
): Promise<DashboardData> {
  const [
    dates,
    priceItems,
    unmatchedRows,
    draftPurchases,
    openCounts,
    latestCount,
    latestPurchase,
    recent,
  ] = await Promise.all([
    committedCountDates(locationId),
    prisma.locationItem.findMany({
      where: {
        locationId,
        isActive: true,
        ...(allowedProductTypes
          ? { itemVariant: { item: { category: { productType: { in: [...allowedProductTypes] } } } } }
          : {}),
      },
      select: { cost: true, retail: true },
    }),
    prisma.importRow.count({
      where: { status: "PENDING", batch: { locationId, status: "NEEDS_REVIEW" } },
    }),
    prisma.purchase.count({ where: { locationId, status: "DRAFT" } }),
    prisma.countSession.count({ where: { locationId, status: "OPEN" } }),
    prisma.countSession.findFirst({
      where: { locationId, status: "OPEN" },
      orderBy: [{ countDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        countDate: true,
        _count: { select: { lines: { where: { status: "ACTIVE" } } } },
      },
    }),
    prisma.purchase.findFirst({
      where: { locationId, status: "DRAFT" },
      orderBy: [{ purchaseDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        refNo: true,
        createdAt: true,
        supplier: { select: { name: true } },
        lines: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      },
    }),
    prisma.activityLog.findMany({
      where: { locationId },
      orderBy: { ts: "desc" },
      take: 5,
      select: {
        id: true,
        ts: true,
        userName: true,
        action: true,
        entity: true,
        entityId: true,
        summary: true,
      },
    }),
  ]);

  const lastCountDate = dates.at(-1) ?? null;
  const canAudit = dates.length >= 2;
  const latest: { begin: string; end: string } | null = canAudit
    ? { begin: dates[dates.length - 2]!, end: dates[dates.length - 1]! }
    : null;

  const missingPrices = priceItems.filter((p) => p.cost <= 0 || p.retail <= 0).length;

  let varianceLeaders: DashboardData["varianceLeaders"] = [];
  if (latest) {
    const report = await buildFullAudit(locationId, latest.begin, latest.end, undefined, allowedProductTypes);
    varianceLeaders = report.rows
      .filter((r) => r.varianceCost !== 0)
      .sort((a, b) => Math.abs(b.varianceCost) - Math.abs(a.varianceCost))
      .slice(0, 6)
      .map((r) => ({
        locationItemId: r.locationItemId,
        itemName: r.itemName,
        variancePct: r.variancePct,
        varianceCost: r.varianceCost,
        varianceRetail: r.varianceRetail,
        short: r.variance < 0,
      }));
  }

  return {
    generatedAt: new Date().toISOString(),
    period: {
      lastCountDate,
      daysSinceLastCount: lastCountDate ? daysBetween(lastCountDate, todayBusinessDate()) : null,
      countDates: dates.length,
      canAudit,
      latest,
    },
    attention: { missingPrices, unmatchedRows, draftPurchases, openCounts },
    readiness: { activeItems: priceItems.length },
    openWork: {
      latestCount: latestCount
        ? { id: latestCount.id, date: latestCount.countDate, lineCount: latestCount._count.lines }
        : null,
      latestPurchase: latestPurchase
        ? {
            id: latestPurchase.id,
            invoiceRef: latestPurchase.refNo,
            supplierName: latestPurchase.supplier?.name ?? null,
            updatedAt: (latestPurchase.lines[0]?.createdAt ?? latestPurchase.createdAt).toISOString(),
          }
        : null,
    },
    varianceLeaders,
    recentActivity: recent.map((a) => ({
      id: a.id,
      ts: a.ts.toISOString(),
      userName: a.userName,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      summary: a.summary,
    })),
  };
}
