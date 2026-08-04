import { hasVariance } from "@fnb/core";
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
    /** Weighable bottles missing a tare and/or liquid weight — they cannot be
        counted on a scale until an admin fills them in (client req 2026-07-25). */
    missingWeights: number;
    /** Bottles a client has reported as having a WRONG weight, awaiting the
        LIS admin (client req 2026-07-25 — the "or need update" half). */
    weightReviews: number;
    unmatchedRows: number; // PENDING rows in batches awaiting review
    draftPurchases: number; // uncommitted purchases
    openCounts: number; // count sessions still open
    /** Bottles a guest left on keep whose promised date has passed (client req
        2026-08-04). Real outstanding work: forfeiting returns the bottle to
        stock at zero cost, and nothing moves until a person agrees to it. */
    bottleKeepsDue: number;
    /** Uncommitted stock transfers this location started. The sibling of
        draftPurchases, which had a bell entry from the start while this one
        silently didn't — a half-entered transfer holds stock in limbo at BOTH
        ends until it is committed. */
    draftTransfers: number;
    /** locationItem.priceChange rows (cost actually changed, see 46.1's
        guard) at this location since `since` was passed to buildDashboard —
        this user's own activityViewedAt preference, not a global count
        (client req 2026-07-31, Phase 46.4). 0 when `since` is not supplied. */
    recentPriceChanges: number;
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
  /**
   * Whether this caller may see the activity trail. `/api/activity` is gated on
   * `activity.view` (ADMIN/OWNER/MANAGER) and correctly 403s — but the dashboard
   * was handing the same records, with usernames and summaries, to every role
   * that could load it. One gate, honoured in both places.
   */
  canSeeActivity = true,
  /**
   * This signed-in user's `prefs.activityViewedAt` (Phase 46.4.2) — count
   * price changes at this location since then. `undefined` when the caller
   * has never opened Activity, in which case `recentPriceChanges` is just 0
   * rather than "everything ever," since there is no natural start point.
   */
  recentPriceChangesSince?: Date,
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
    priceChangeRows,
    bottleKeepsDue,
    draftTransfers,
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
      select: {
        cost: true,
        retail: true,
        // Weighable bottles need a tare (empty-container) weight and a liquid
        // weight (density) before they can be counted on a scale — the weigh
        // calculator refuses to compute without them (client req 2026-07-25).
        itemVariant: {
          select: {
            contentTracked: true,
            weighMode: true,
            tareWeight: true,
            densityFactor: true,
            weightReviewNote: true,
            item: { select: { category: { select: { defaultDensityFactor: true, productType: true } } } },
          },
        },
      },
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
      /**
       * Over-fetch so the dashboard can collapse repeats and still fill its list.
       *
       * The panel shows five rows. At `take: 5` a single repeating event — four
       * failed PIN attempts from one terminal — consumed four of them and
       * pushed real events off the bottom; folding the run client-side would
       * then have left a two-row panel. Reading 25 and folding down to five
       * gives the summariser something to promote. Indexed on `ts` and capped,
       * so the extra rows cost nothing worth measuring.
       *
       * Stocky slices its own 5 off the front of this list, so its view is
       * unchanged.
       */
      take: 25,
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
    // Guard applied in JS below (old.cost !== new.cost, both defined) rather
    // than in the query, same reasoning as 46.1: `detailsJson` is opaque JSON
    // text to Prisma/SQLite, there is no column to filter on. Skipped
    // entirely (empty array, no query sent) when the caller has no
    // recentPriceChangesSince — matches recentPriceChanges defaulting to 0
    // for a user who has never opened Activity.
    recentPriceChangesSince
      ? prisma.activityLog.findMany({
          where: {
            locationId,
            action: "locationItem.priceChange",
            ts: { gt: recentPriceChangesSince },
          },
          select: { detailsJson: true },
        })
      : Promise.resolve([]),
    // `lt` on a TEXT YYYY-MM-DD is a lexicographic compare, which for that
    // format is the same ordering as a date compare — the whole reason business
    // dates are stored this way. Strictly less than today: a bottle promised
    // until the 4th is still the guest's for all of the 4th.
    prisma.bottleKeep.count({
      where: { locationId, status: "ACTIVE", expiresOn: { lt: todayBusinessDate() } },
    }),
    // `fromLocationId`, not either end: while a transfer is DRAFT the source
    // owns it and is the only side that can edit or commit it (§7.2). Counting
    // it at the destination would badge someone who cannot act on it.
    prisma.transfer.count({ where: { fromLocationId: locationId, status: "DRAFT" } }),
  ]);

  const lastCountDate = dates.at(-1) ?? null;
  const canAudit = dates.length >= 2;
  const latest: { begin: string; end: string } | null = canAudit
    ? { begin: dates[dates.length - 2]!, end: dates[dates.length - 1]! }
    : null;

  // An Asset is never sold, so it has no retail price to be missing — a fire
  // extinguisher sat in "needs attention" forever, and the only way to clear the
  // badge was to invent a selling price for 70 pieces of equipment. Cost still
  // matters: the register and every asset valuation are priced from it.
  const missingPrices = priceItems.filter((p) =>
    p.itemVariant.item.category.productType === "Asset" ? p.cost <= 0 : p.cost <= 0 || p.retail <= 0,
  ).length;

  // Bottles that can't be weighed yet: a weighable variant with no tare weight,
  // or a density-weighed one with no liquid weight on the variant OR its
  // category. This is the "new bottle / tare weight needs update" signal the
  // client asked to be notified about — surfaced as work, not as a popup.
  const missingWeights = priceItems.filter((p) => {
    const v = p.itemVariant;
    const weighable = v.contentTracked || v.weighMode === "NET" || v.weighMode === "DENSITY";
    if (!weighable) return false;
    if (v.tareWeight == null || v.tareWeight <= 0) return true;
    // NET mode needs no density; DENSITY (incl. the legacy contentTracked
    // inference) falls back to the category default before it counts as missing.
    if (v.weighMode === "NET") return false;
    const density = v.densityFactor ?? v.item.category.defaultDensityFactor;
    return density == null || density <= 0;
  }).length;

  const weightReviews = priceItems.filter((p) => p.itemVariant.weightReviewNote !== null).length;

  // Same guard as 46.1 (`activity.tsx`) and 46.2 (`price-edit.tsx`):
  // `locationItem.priceChange` is a fallback tag that also covers
  // retail/parLevel/isActive-only edits, where `new.cost` is undefined
  // because `new` is the raw PUT body, not a full record. Only count rows
  // where cost is present on both sides and actually differs.
  const recentPriceChanges = priceChangeRows.filter((r) => {
    if (!r.detailsJson) return false;
    try {
      const parsed = JSON.parse(r.detailsJson) as { old?: { cost?: number }; new?: { cost?: number } };
      const oldCost = parsed.old?.cost;
      const newCost = parsed.new?.cost;
      return oldCost !== undefined && newCost !== undefined && oldCost !== newCost;
    } catch {
      return false;
    }
  }).length;

  let varianceLeaders: DashboardData["varianceLeaders"] = [];
  if (latest) {
    const report = await buildFullAudit(locationId, latest.begin, latest.end, undefined, allowedProductTypes);
    varianceLeaders = report.rows
      // hasVariance, not `!== 0` — reconciliation sums land on values like
      // -5.5e-13, so exact-zero let three no-variance items onto the board
      // labelled "Shortage ₱0.00" (architecture.md deviation #24).
      .filter((r) => hasVariance(r.variance))
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
    attention: {
      missingPrices,
      missingWeights,
      weightReviews,
      unmatchedRows,
      draftPurchases,
      openCounts,
      bottleKeepsDue,
      draftTransfers,
      recentPriceChanges,
    },
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
    recentActivity: canSeeActivity ? recent.map((a) => ({
      id: a.id,
      ts: a.ts.toISOString(),
      userName: a.userName,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      summary: a.summary,
    })) : [],
  };
}
