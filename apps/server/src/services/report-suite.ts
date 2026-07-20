import { openEquivalent, round2 } from "@fnb/core";
import { buildFullAudit } from "./report-assembly";
import { prisma } from "../db";

/**
 * The client's report suite (spec: docs/client-report-formats.md, received
 * 2026-07-20). Every dataset here is a PROJECTION — either of buildFullAudit
 * (so the numbers are exactly the Full Audit's) or of committed source records.
 * No new reconciliation math.
 */

const LI_INCLUDE = {
  itemVariant: { include: { unit: true, item: { include: { category: true } } } },
} as const;

type LocationItemWithVariant = {
  cost: number;
  retail: number;
  itemVariant: {
    size: number;
    contentTracked: boolean;
    unit: { name: string };
    item: { name: string; category: { name: string; sortOrder: number } };
  };
};

function uomLabel(li: LocationItemWithVariant): string {
  return `${li.itemVariant.size} ${li.itemVariant.unit.name}`;
}

// ── Legacy-layout audit (client reports #1 Detailed Audit / #2 Inventory) ──
// One 24-column table serves both: they differ only in title and headline
// ratio (cost of SOLD / revenue vs cost of USAGE / revenue) — verified against
// the client's two sample files, whose tables are identical.

export type LegacyAuditVariant = "detailed" | "inventory";

export interface LegacyAuditRow {
  productName: string;
  sizeUom: string;
  beginFull: number;
  beginOpen: number;
  bCost: number;
  purchased: number;
  purchasedCost: number;
  forfeited: number;
  endFull: number;
  endOpen: number;
  eCost: number;
  usage: number;
  costOfUsage: number;
  shot: number; // recipe/portion sales in bottle equivalents (legacy "shots")
  bottle: number; // direct full-unit sales
  costOfSold: number; // (shot + bottle) × cost basis — legacy formula
  revenue: number;
  usedVsSales: number; // variance EXCLUDING non-rev (legacy col R)
  nonRevUsage: number;
  nonRevCost: number;
  overallVariance: number; // = our variance (non-rev folded in)
  variancePct: number | null;
  varianceCost: number;
  varianceRetail: number;
}

export interface LegacyAuditGroup {
  categoryName: string;
  rows: LegacyAuditRow[];
  totals: LegacyAuditTotals;
}

export type LegacyAuditTotals = Omit<LegacyAuditRow, "productName" | "sizeUom" | "variancePct"> & {
  variancePct: null;
};

export interface LegacyAuditReport {
  begin: string;
  end: string;
  groups: LegacyAuditGroup[];
  totals: LegacyAuditTotals;
  /** Headline ratio: detailed = Σ cost of sold / Σ revenue; inventory = Σ cost of usage / Σ revenue. */
  costRatio: number | null;
}

function emptyLegacyTotals(): LegacyAuditTotals {
  return {
    beginFull: 0, beginOpen: 0, bCost: 0, purchased: 0, purchasedCost: 0, forfeited: 0,
    endFull: 0, endOpen: 0, eCost: 0, usage: 0, costOfUsage: 0, shot: 0, bottle: 0,
    costOfSold: 0, revenue: 0, usedVsSales: 0, nonRevUsage: 0, nonRevCost: 0,
    overallVariance: 0, variancePct: null, varianceCost: 0, varianceRetail: 0,
  };
}

function addToTotals(t: LegacyAuditTotals, r: LegacyAuditRow): void {
  t.beginFull += r.beginFull; t.beginOpen += r.beginOpen; t.bCost += r.bCost;
  t.purchased += r.purchased; t.purchasedCost += r.purchasedCost; t.forfeited += r.forfeited;
  t.endFull += r.endFull; t.endOpen += r.endOpen; t.eCost += r.eCost;
  t.usage += r.usage; t.costOfUsage += r.costOfUsage; t.shot += r.shot; t.bottle += r.bottle;
  t.costOfSold += r.costOfSold; t.revenue += r.revenue; t.usedVsSales += r.usedVsSales;
  t.nonRevUsage += r.nonRevUsage; t.nonRevCost += r.nonRevCost;
  t.overallVariance += r.overallVariance; t.varianceCost += r.varianceCost; t.varianceRetail += r.varianceRetail;
}

export async function legacyAuditReport(
  locationId: string,
  begin: string,
  end: string,
  allowedProductTypes?: readonly string[] | null,
  variant: LegacyAuditVariant = "detailed",
): Promise<LegacyAuditReport> {
  const report = await buildFullAudit(locationId, begin, end, undefined, allowedProductTypes);

  const groups: LegacyAuditGroup[] = report.categories.map((cat) => {
    const groupTotals = emptyLegacyTotals();
    const rows = cat.rows.map((r) => {
      const row: LegacyAuditRow = {
        productName: r.itemName,
        sizeUom: `${r.size} ${r.unitName}`,
        beginFull: r.beginFull,
        beginOpen: r.beginOpenEquiv,
        bCost: r.beginCost,
        purchased: r.purchased,
        purchasedCost: r.purchasedCost,
        forfeited: r.forfeited,
        endFull: r.endFull,
        endOpen: r.endOpenEquiv,
        eCost: r.endCost,
        usage: r.usage,
        costOfUsage: r.usageCost,
        shot: r.soldPortion,
        bottle: r.soldDirect,
        // Legacy formula (verified in fnb-main and against both sample files):
        // cost of sold = total sold quantity × the item's unit cost basis.
        costOfSold: (r.soldDirect + r.soldPortion) * r.costBasis,
        revenue: r.revenue,
        // Legacy col R "Variance Used vs Sales" excludes non-rev; their
        // "Overall Variance" adds it back — which is exactly our variance.
        usedVsSales: r.variance - r.nonRevenue,
        nonRevUsage: r.nonRevenue,
        nonRevCost: r.nonRevenueCost,
        overallVariance: r.variance,
        variancePct: r.variancePct,
        varianceCost: r.varianceCost,
        varianceRetail: r.varianceRetail,
      };
      addToTotals(groupTotals, row);
      return row;
    });
    return { categoryName: cat.categoryName, rows, totals: groupTotals };
  });

  const totals = emptyLegacyTotals();
  for (const g of groups) for (const r of g.rows) addToTotals(totals, r);

  const numerator = variant === "detailed" ? totals.costOfSold : totals.costOfUsage;
  const costRatio = totals.revenue > 0 ? numerator / totals.revenue : null;

  return { begin, end, groups, totals, costRatio };
}

// ── Beginning / Ending Cost Report (client reports #3 / #4) ──
// Cost basis per the client's spec: WEIGHTED AVERAGE of all committed purchase
// lines up to the anchor count date; items with no purchase history fall back
// to their catalog cost price (the legacy ACOST behaviour). Reconciliation is
// untouched — this basis exists only in these two reports.

export interface CostSnapshotRow {
  name: string;
  uom: string;
  qty: number; // full + open equivalent, counted ON the anchor date
  cost: number; // per-unit cost on the basis below
  value: number; // qty × cost
  basis: "average" | "price"; // average of purchases vs catalog cost price
}

export interface CostSnapshotReport {
  anchorDate: string;
  rows: CostSnapshotRow[];
  totals: { qty: number; value: number };
}

export async function costSnapshotReport(
  locationId: string,
  anchorDate: string,
  allowedProductTypes?: readonly string[] | null,
): Promise<CostSnapshotReport> {
  const [lines, purchaseAgg] = await Promise.all([
    prisma.countLine.findMany({
      where: {
        status: "ACTIVE",
        countSession: { locationId, countDate: anchorDate, status: "COMMITTED" },
        ...(allowedProductTypes
          ? { locationItem: { itemVariant: { item: { category: { productType: { in: [...allowedProductTypes] } } } } } }
          : {}),
      },
      include: { locationItem: { include: LI_INCLUDE } },
    }),
    prisma.purchaseLine.groupBy({
      by: ["locationItemId"],
      where: {
        status: "ACTIVE",
        purchase: { locationId, status: "COMMITTED", purchaseDate: { lte: anchorDate } },
      },
      _sum: { lineTotal: true, qty: true },
    }),
  ]);

  const avgCost = new Map<string, number>();
  for (const agg of purchaseAgg) {
    const qty = agg._sum.qty ?? 0;
    const total = agg._sum.lineTotal ?? 0;
    if (qty > 0) avgCost.set(agg.locationItemId, total / qty);
  }

  // One row per catalog item: FULL lines add whole units, WEIGH lines add the
  // open-bottle equivalent — the same pool the reconciliation counts.
  const byItem = new Map<string, { li: LocationItemWithVariant; qty: number }>();
  for (const line of lines) {
    const li = line.locationItem as unknown as LocationItemWithVariant;
    const entry = byItem.get(line.locationItemId) ?? { li, qty: 0 };
    entry.qty +=
      line.countType === "FULL"
        ? line.qtyFull
        : openEquivalent(line.remainingContent, li.itemVariant.size, li.itemVariant.contentTracked);
    byItem.set(line.locationItemId, entry);
  }

  const rows: CostSnapshotRow[] = [...byItem.entries()]
    .map(([locationItemId, { li, qty }]) => {
      const avg = avgCost.get(locationItemId);
      const cost = avg ?? li.cost;
      return {
        name: li.itemVariant.item.name,
        uom: uomLabel(li),
        qty: round2(qty),
        cost: round2(cost),
        value: round2(qty * cost),
        basis: (avg !== undefined ? "average" : "price") as CostSnapshotRow["basis"],
        _sort: `${li.itemVariant.item.category.sortOrder}`.padStart(4, "0") + li.itemVariant.item.name,
      };
    })
    .sort((a, b) => a._sort.localeCompare(b._sort))
    .map(({ _sort, ...row }) => row);

  const totals = rows.reduce(
    (acc, r) => ({ qty: acc.qty + r.qty, value: acc.value + r.value }),
    { qty: 0, value: 0 },
  );
  return { anchorDate, rows, totals: { qty: round2(totals.qty), value: round2(totals.value) } };
}

// ── Forfeited Bottles Report (client report #5) ──

export interface ForfeitReportRow {
  date: string;
  name: string;
  uom: string;
  qty: number; // whole returned units
  contentEquiv: number; // open-content in bottle equivalents
  costValue: number;
  retailValue: number;
}

export interface ForfeitsReport {
  from: string;
  to: string;
  rows: ForfeitReportRow[];
  totals: { qty: number; contentEquiv: number; costValue: number; retailValue: number };
}

export async function forfeitsReport(
  locationId: string,
  from: string,
  to: string,
  allowedProductTypes?: readonly string[] | null,
): Promise<ForfeitsReport> {
  const forfeits = await prisma.forfeit.findMany({
    where: {
      locationId,
      status: "ACTIVE",
      forfeitDate: { gte: from, lte: to },
      ...(allowedProductTypes
        ? { locationItem: { itemVariant: { item: { category: { productType: { in: [...allowedProductTypes] } } } } } }
        : {}),
    },
    include: { locationItem: { include: LI_INCLUDE } },
    orderBy: [{ forfeitDate: "asc" }, { createdAt: "asc" }],
  });

  const rows: ForfeitReportRow[] = forfeits.map((f) => {
    const li = f.locationItem as unknown as LocationItemWithVariant;
    const contentEquiv = openEquivalent(f.remainingContent, li.itemVariant.size, li.itemVariant.contentTracked);
    const equivTotal = contentEquiv + f.qty;
    return {
      date: f.forfeitDate,
      name: li.itemVariant.item.name,
      uom: uomLabel(li),
      qty: f.qty,
      contentEquiv: round2(contentEquiv),
      costValue: round2(equivTotal * li.cost),
      retailValue: round2(equivTotal * li.retail),
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      qty: acc.qty + r.qty,
      contentEquiv: acc.contentEquiv + r.contentEquiv,
      costValue: acc.costValue + r.costValue,
      retailValue: acc.retailValue + r.retailValue,
    }),
    { qty: 0, contentEquiv: 0, costValue: 0, retailValue: 0 },
  );
  return { from, to, rows, totals };
}

// ── Usage Cost Report (client report #6) ──

export interface UsageCostRow {
  name: string;
  uom: string;
  qty: number;
  cost: number;
}

export interface UsageCostReport {
  begin: string;
  end: string;
  rows: UsageCostRow[];
  totals: { qty: number; cost: number };
}

export async function usageCostReport(
  locationId: string,
  begin: string,
  end: string,
  allowedProductTypes?: readonly string[] | null,
): Promise<UsageCostReport> {
  const report = await buildFullAudit(locationId, begin, end, undefined, allowedProductTypes);
  const rows: UsageCostRow[] = report.rows
    .filter((r) => r.usage !== 0)
    .map((r) => ({
      name: r.itemName,
      uom: `${r.size} ${r.unitName}`,
      qty: round2(r.usage),
      cost: round2(r.usageCost),
    }));
  const totals = rows.reduce((acc, r) => ({ qty: acc.qty + r.qty, cost: acc.cost + r.cost }), { qty: 0, cost: 0 });
  return { begin, end, rows, totals };
}

// ── Sales by Item — shot & bottle (client report #7) ──

export interface SalesByItemRow {
  name: string;
  uom: string;
  shot: number;
  bottle: number;
  qty: number;
  cost: number; // cost of sold (legacy formula)
  retail: number; // revenue
}

export interface SalesByItemReport {
  begin: string;
  end: string;
  rows: SalesByItemRow[];
  totals: { shot: number; bottle: number; qty: number; cost: number; retail: number };
}

export async function salesByItemReport(
  locationId: string,
  begin: string,
  end: string,
  allowedProductTypes?: readonly string[] | null,
): Promise<SalesByItemReport> {
  const report = await buildFullAudit(locationId, begin, end, undefined, allowedProductTypes);
  const rows: SalesByItemRow[] = report.rows
    .filter((r) => r.soldDirect + r.soldPortion > 0)
    .map((r) => ({
      name: r.itemName,
      uom: `${r.size} ${r.unitName}`,
      shot: round2(r.soldPortion),
      bottle: round2(r.soldDirect),
      qty: round2(r.soldDirect + r.soldPortion),
      cost: round2((r.soldDirect + r.soldPortion) * r.costBasis),
      retail: round2(r.revenue),
    }));
  const totals = rows.reduce(
    (acc, r) => ({
      shot: acc.shot + r.shot,
      bottle: acc.bottle + r.bottle,
      qty: acc.qty + r.qty,
      cost: acc.cost + r.cost,
      retail: acc.retail + r.retail,
    }),
    { shot: 0, bottle: 0, qty: 0, cost: 0, retail: 0 },
  );
  return { begin, end, rows, totals };
}
