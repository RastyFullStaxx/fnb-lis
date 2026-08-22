import { openEquivalent, round2, shouldDropHiddenRow, type CostBasis } from "@fnb/core";
import { buildFullAudit } from "./report-assembly";
import { weightedAverageCosts } from "./valuation";
import { loadLocationItemUnits } from "./report-units";
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
    itemId: string;
    size: number;
    contentTracked: boolean;
    unit: { name: string; kind: "VOLUME" | "MASS" | "COUNT"; factorToBase: number };
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
  /** Passed through from the recon row so the over/short highlight can tell a
      1:1 whole-unit item (absolute ±1 rule) from a content-tracked one (%). */
  contentTracked: boolean;
  /** LocationItem.isActive — carried through so the client can badge a
      hidden-but-active row (clutter-in-reports-plan.md Phase 6.1). */
  isActive: boolean;
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

export type LegacyAuditTotals = Omit<
  LegacyAuditRow,
  "productName" | "sizeUom" | "variancePct" | "contentTracked" | "isActive"
> & {
  variancePct: null;
};

export interface LegacyAuditReport {
  begin: string;
  end: string;
  costBasis: CostBasis;
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

/**
 * Folds one category's ALREADY-COMPLETE totals into the report-level grand
 * total. Deliberately separate from `addToTotals` (which reads a single
 * ROW): the grand total must be built from each group's `groupTotals` —
 * computed before the clutter filter ever ran — never by re-summing
 * `group.rows`, which is the filtered, display-only array. Re-summing the
 * filtered rows was the bug this replaces: a hidden-and-idle item can still
 * carry a nonzero begin/end balance (the filter only checks MOVEMENT, per
 * clutter-in-reports-decision.md), so dropping its row from the display list
 * while grand-totalling off that same list silently pulled its beginning/
 * ending cost out of the report's own headline numbers — exactly what "Totals
 * are computed before this filter runs, so they never change based on it."
 * (decision doc) promises will never happen.
 */
function foldGroupTotals(t: LegacyAuditTotals, group: LegacyAuditTotals): void {
  t.beginFull += group.beginFull; t.beginOpen += group.beginOpen; t.bCost += group.bCost;
  t.purchased += group.purchased; t.purchasedCost += group.purchasedCost; t.forfeited += group.forfeited;
  t.endFull += group.endFull; t.endOpen += group.endOpen; t.eCost += group.eCost;
  t.usage += group.usage; t.costOfUsage += group.costOfUsage; t.shot += group.shot; t.bottle += group.bottle;
  t.costOfSold += group.costOfSold; t.revenue += group.revenue; t.usedVsSales += group.usedVsSales;
  t.nonRevUsage += group.nonRevUsage; t.nonRevCost += group.nonRevCost;
  t.overallVariance += group.overallVariance; t.varianceCost += group.varianceCost; t.varianceRetail += group.varianceRetail;
}

export async function legacyAuditReport(
  locationId: string,
  begin: string,
  end: string,
  allowedProductTypes?: readonly string[] | null,
  variant: LegacyAuditVariant = "detailed",
  costBasis: CostBasis = "PRICE",
  // Clutter-in-reports (docs/clutter-in-reports-decision.md): off by default.
  // Group totals below are computed from the COMPLETE row set, same as every
  // other report here — the filter is applied to `groups[].rows` only, after
  // those totals already exist, so it can never move a single figure.
  includeHiddenInReports: boolean = false,
): Promise<LegacyAuditReport> {
  const report = await buildFullAudit(locationId, begin, end, undefined, allowedProductTypes, costBasis);

  const groups: LegacyAuditGroup[] = report.categories.map((cat) => {
    const groupTotals = emptyLegacyTotals();
    // Keep the source ReconRow alongside the reshaped legacy row so the
    // filter below can read isActive + every activity field without a
    // second lookup or a fragile re-match on display fields.
    const allRows = cat.rows.map((r) => {
      const row: LegacyAuditRow = {
        productName: r.itemName,
        sizeUom: `${r.size} ${r.unitName}`,
        contentTracked: r.contentTracked,
        isActive: r.isActive,
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
      // Totals FIRST, from the complete row set — the display filter below
      // must never be able to move them (clutter-in-reports-decision.md).
      addToTotals(groupTotals, row);
      return { row, reconRow: r };
    });
    const rows = allRows
      .filter(({ reconRow }) => !shouldDropHiddenRow(reconRow, includeHiddenInReports))
      .map(({ row }) => row);
    return { categoryName: cat.categoryName, rows, totals: groupTotals };
  });

  // Fold each category's PRE-FILTER totals (see foldGroupTotals) — never
  // re-derive from `g.rows`, which is the post-filter display list.
  const totals = emptyLegacyTotals();
  for (const g of groups) foldGroupTotals(totals, g.totals);

  const numerator = variant === "detailed" ? totals.costOfSold : totals.costOfUsage;
  const costRatio = totals.revenue > 0 ? numerator / totals.revenue : null;

  return { begin, end, costBasis, groups, totals, costRatio };
}

// ── Beginning / Ending Cost Report (client reports #3 / #4) ──
// Valued on the CLIENT'S SAVED COST BASIS (@fnb/core COST_BASES):
//   PRICE   — the cost snapshotted on the count line (falls back to catalog
//             cost). Ties exactly to the Full Audit's B-Cost / E-Cost columns.
//   AVERAGE — periodic weighted average cost from services/valuation.ts:
//             (opening stock value + purchases value) ÷ (opening + purchased
//             qty). Opening stock participates — averaging purchase lines
//             alone is "average purchase price", a different figure.
// Either way this is VALUATION only; variance cost never reads it.

export interface CostSnapshotRow {
  name: string;
  uom: string;
  qty: number; // full + open equivalent, counted ON the anchor date
  cost: number; // per-unit cost on the basis below
  value: number; // qty × cost
  basis: "average" | "price"; // which basis this row actually resolved to
  /**
   * report-uom-plan.md Phase 5: `qty` is a real base-unit quantity — unlike
   * `uom` above, which stays the item's FIXED catalog size label (e.g. "750
   * ml") and never changes. These fields feed a separate "Unit" column/
   * screen resolution, same distinction On Hand's own `unitName` draws
   * against its own report's `productType`-adjacent columns.
   */
  itemId: string;
  unitName: string;
  unitKind: "VOLUME" | "MASS" | "COUNT";
  unitFactorToBase: number;
}

export interface CostSnapshotReport {
  anchorDate: string;
  costBasis: CostBasis;
  rows: CostSnapshotRow[];
  totals: { qty: number; value: number };
}

export async function costSnapshotReport(
  locationId: string,
  anchorDate: string,
  allowedProductTypes?: readonly string[] | null,
  costBasis: CostBasis = "PRICE",
): Promise<CostSnapshotReport> {
  const [lines, wac] = await Promise.all([
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
    weightedAverageCosts(locationId, anchorDate, costBasis),
  ]);

  // One row per catalog item: FULL lines add whole units, WEIGH lines add the
  // open-bottle equivalent — the same pool the reconciliation counts. The
  // count-line snapshot cost is the PRICE basis, matching the Full Audit.
  const byItem = new Map<string, { li: LocationItemWithVariant; qty: number; snapshotCost: number }>();
  for (const line of lines) {
    const li = line.locationItem as unknown as LocationItemWithVariant;
    const entry = byItem.get(line.locationItemId) ?? { li, qty: 0, snapshotCost: 0 };
    entry.qty +=
      line.countType === "FULL"
        ? line.qtyFull
        : openEquivalent(line.remainingContent, li.itemVariant.size, li.itemVariant.contentTracked);
    if (line.unitCost > 0) entry.snapshotCost = line.unitCost;
    byItem.set(line.locationItemId, entry);
  }

  const rows: CostSnapshotRow[] = [...byItem.entries()]
    .map(([locationItemId, { li, qty, snapshotCost }]) => {
      const average = wac.get(locationItemId);
      const cost = average ?? (snapshotCost > 0 ? snapshotCost : li.cost);
      return {
        name: li.itemVariant.item.name,
        uom: uomLabel(li),
        qty: round2(qty),
        cost, // unit price keeps its centavo fractions (client req 2026-07-28)
        value: round2(qty * cost),
        basis: (average !== undefined ? "average" : "price") as CostSnapshotRow["basis"],
        itemId: li.itemVariant.itemId,
        unitName: li.itemVariant.unit.name,
        unitKind: li.itemVariant.unit.kind,
        unitFactorToBase: li.itemVariant.unit.factorToBase,
        _sort: `${li.itemVariant.item.category.sortOrder}`.padStart(4, "0") + li.itemVariant.item.name,
      };
    })
    .sort((a, b) => a._sort.localeCompare(b._sort))
    .map(({ _sort, ...row }) => row);

  const totals = rows.reduce(
    (acc, r) => ({ qty: acc.qty + r.qty, value: acc.value + r.value }),
    { qty: 0, value: 0 },
  );
  return { anchorDate, costBasis, rows, totals: { qty: round2(totals.qty), value: round2(totals.value) } };
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
  return {
    from, to, rows,
    totals: {
      qty: round2(totals.qty),
      contentEquiv: round2(totals.contentEquiv),
      costValue: round2(totals.costValue),
      retailValue: round2(totals.retailValue),
    },
  };
}

// ── Usage Cost Report (client report #6) ──

export interface UsageCostRow {
  name: string;
  uom: string;
  qty: number;
  cost: number;
  /**
   * report-uom-plan.md Phase 5: `qty` is a real base-unit quantity — `uom`
   * above stays the fixed catalog size label, untouched. ReconRow (the
   * source here) carries no itemId/unitKind/unitFactorToBase of its own
   * (reconciliation.ts is formula-only, out of scope for this plan), so
   * these are looked up separately by locationItemId via
   * loadLocationItemUnits() — see report-units.ts.
   */
  itemId: string;
  unitName: string;
  unitKind: "VOLUME" | "MASS" | "COUNT";
  unitFactorToBase: number;
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
  const usageRows = report.rows.filter((r) => r.usage !== 0);
  const unitInfo = await loadLocationItemUnits(usageRows.map((r) => r.locationItemId));
  const rows: UsageCostRow[] = usageRows.map((r) => {
    const info = unitInfo.get(r.locationItemId);
    return {
      name: r.itemName,
      uom: `${r.size} ${r.unitName}`,
      qty: round2(r.usage),
      cost: round2(r.usageCost),
      itemId: info?.itemId ?? "",
      unitName: info?.unitName ?? r.unitName,
      unitKind: info?.unitKind ?? "COUNT",
      unitFactorToBase: info?.unitFactorToBase ?? 1,
    };
  });
  const totals = rows.reduce((acc, r) => ({ qty: acc.qty + r.qty, cost: acc.cost + r.cost }), { qty: 0, cost: 0 });
  return { begin, end, rows, totals: { qty: round2(totals.qty), cost: round2(totals.cost) } };
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
  /** report-uom-plan.md Phase 5 — see UsageCostRow's own comment. `shot`,
      `bottle`, and `qty` all share this one unit (shot/bottle are just
      soldPortion/soldDirect split out of the same base-unit quantity). */
  itemId: string;
  unitName: string;
  unitKind: "VOLUME" | "MASS" | "COUNT";
  unitFactorToBase: number;
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
  const soldRows = report.rows.filter((r) => r.soldDirect + r.soldPortion > 0);
  const unitInfo = await loadLocationItemUnits(soldRows.map((r) => r.locationItemId));
  const rows: SalesByItemRow[] = soldRows.map((r) => {
    const info = unitInfo.get(r.locationItemId);
    return {
      name: r.itemName,
      uom: `${r.size} ${r.unitName}`,
      shot: round2(r.soldPortion),
      bottle: round2(r.soldDirect),
      qty: round2(r.soldDirect + r.soldPortion),
      cost: round2((r.soldDirect + r.soldPortion) * r.costBasis),
      retail: round2(r.revenue),
      itemId: info?.itemId ?? "",
      unitName: info?.unitName ?? r.unitName,
      unitKind: info?.unitKind ?? "COUNT",
      unitFactorToBase: info?.unitFactorToBase ?? 1,
    };
  });
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
  return { begin, end, rows, totals: {
      shot: round2(totals.shot), bottle: round2(totals.bottle), qty: round2(totals.qty),
      cost: round2(totals.cost), retail: round2(totals.retail),
    } };
}
