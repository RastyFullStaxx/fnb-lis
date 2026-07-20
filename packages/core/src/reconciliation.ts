/**
 * The audit-period reconciliation engine — the system's operational truth,
 * reproducing the legacy Full Audit math exactly (verified against
 * fnb-main beverage_fullaudit.php + clientmodel.php; see docs/architecture.md §6).
 *
 * Pure functions: the server assembles inputs from the database; the web app
 * reuses the same functions for previews so screen math never disagrees with
 * report math.
 *
 * Date semantics (enforced by the CALLER's queries, restated here):
 *   counts are read ON beginDate and ON endDate (committed sessions only);
 *   activity (purchases, sales, forfeits) is summed over the half-open
 *   interval [beginDate, endDate).
 */
import { openEquivalent } from "./weighing";
import { menuDiscountDeduction, menuRevenueShare, resolveCostBasis } from "./pricing";

export interface ReconPeriod {
  beginDate: string; // YYYY-MM-DD
  endDate: string;
}

/** One menu's sales aggregated for ONE ingredient row (this item's serving in it). */
export interface MenuSaleAgg {
  menuName: string;
  qtySold: number;
  discountPct: number;
  menuSrp: number;
  /** This ingredient's serving amount in the snapshotted recipe version. */
  ingredientServing: number;
  /** Σ servings of ALL lines in that version (legacy `mtotal`). */
  menuTotalServing: number;
  /** Number of recipe lines in that version (legacy discount split). */
  ingredientCount: number;
}

export interface ReconItemInput {
  locationItemId: string;
  itemName: string;
  categoryName: string;
  categorySortOrder: number;
  productType: string;
  size: number;
  unitName: string;
  contentTracked: boolean;

  beginFullQty: number;
  beginOpenContent: number;
  endFullQty: number;
  endOpenContent: number;
  beginUnitCost: number | null; // snapshot from beginning count lines
  endUnitCost: number | null; // snapshot from ending count lines
  currentCost: number;
  currentRetail: number;

  purchasedQty: number;
  purchasedCost: number; // Σ qty × unitCost over the window

  /**
   * Inter-location transfers (phase 9). OPTIONAL by design: absent ⇒ 0, so
   * every pre-transfer caller — and the phase-3 golden fixture — produces
   * bit-identical output. In at the destination (received qty), out at the
   * source (dispatched qty).
   */
  transferInQty?: number;
  transferOutQty?: number;

  forfeitContent: number; // weighed content returned to stock
  forfeitCountQty: number; // count-item path

  directSalesQty: number; // SALE item lines (contentOverride null/0 only — Nuance A)
  directRevenue: number; // Σ unitPrice × qty on those lines

  menuSales: MenuSaleAgg[]; // empty until recipes phase

  productionQty: number; // PRODUCTION consumption; zero revenue

  nonRevenueDirectQty: number; // NON_REVENUE item lines without content override
  /** Override/serving path (Nuance B): per-unit content × qty. */
  nonRevenueContentLines: Array<{ contentPerUnit: number; qty: number }>;
}

export interface ReconRow {
  locationItemId: string;
  itemName: string;
  categoryName: string;
  productType: string;
  size: number;
  unitName: string;
  contentTracked: boolean;

  beginFull: number;
  beginOpenEquiv: number;
  beginCost: number;
  purchased: number;
  /** Actual peso total of the period's purchase lines — an INPUT echo for
      report layouts (legacy "Cost of Purchase" column); no math reads it. */
  purchasedCost: number;
  forfeited: number;
  transferIn: number;
  transferOut: number;
  endFull: number;
  endOpenEquiv: number;
  endCost: number;

  usage: number;
  usageCost: number;

  soldDirect: number;
  soldPortion: number; // recipe consumption
  revenue: number;
  nonRevenue: number;
  nonRevenueCost: number;
  production: number;

  variance: number;
  variancePct: number | null;
  varianceCost: number;
  varianceRetail: number;

  costBasis: number;
  flags: { short: boolean; missingPrice: boolean };
}

export function reconcileItem(input: ReconItemInput): ReconRow {
  const { size, contentTracked } = input;

  const beginOpenEquiv = openEquivalent(input.beginOpenContent, size, contentTracked);
  const endOpenEquiv = openEquivalent(input.endOpenContent, size, contentTracked);
  // Forfeits ADD BACK into the pool (returned partial bottles are a stock-in).
  const forfeited = openEquivalent(input.forfeitContent, size, contentTracked) + input.forfeitCountQty;
  // Transfers: received stock joins the pool like purchases; dispatched stock
  // leaves it. Both default to 0 — untouched rows reconcile exactly as before.
  const transferIn = input.transferInQty ?? 0;
  const transferOut = input.transferOutQty ?? 0;

  const usage =
    input.beginFullQty + beginOpenEquiv + input.purchasedQty + forfeited + transferIn - transferOut -
    (input.endFullQty + endOpenEquiv);

  const costBasis = resolveCostBasis(input.endUnitCost, input.beginUnitCost, input.currentCost);
  const beginCost =
    (input.beginFullQty + beginOpenEquiv) *
    (input.beginUnitCost !== null && input.beginUnitCost > 0 ? input.beginUnitCost : input.currentCost);
  const endCost =
    (input.endFullQty + endOpenEquiv) *
    (input.endUnitCost !== null && input.endUnitCost > 0 ? input.endUnitCost : input.currentCost);

  // Menu/recipe expansion (legacy shot logic).
  let soldPortion = 0;
  let menuRevenue = 0;
  for (const m of input.menuSales) {
    soldPortion += contentTracked ? (m.ingredientServing / (size || 1)) * m.qtySold : m.ingredientServing * m.qtySold;
    menuRevenue +=
      menuRevenueShare(m.ingredientServing, m.menuTotalServing, m.menuSrp, m.qtySold) -
      menuDiscountDeduction(m.menuSrp, m.discountPct, m.ingredientCount, m.qtySold);
  }

  // Non-revenue: direct qty path + per-unit content path (Nuances A & B).
  let nonRevenue = input.nonRevenueDirectQty;
  for (const line of input.nonRevenueContentLines) {
    nonRevenue += openEquivalent(line.contentPerUnit, size, contentTracked) * line.qty;
  }

  const revenue = input.directRevenue + menuRevenue;

  const expected = input.directSalesQty + soldPortion + nonRevenue + input.productionQty;
  const variance = expected - usage;
  const variancePct = usage > 0 ? (variance / usage) * 100 : null;

  return {
    locationItemId: input.locationItemId,
    itemName: input.itemName,
    categoryName: input.categoryName,
    productType: input.productType,
    size,
    unitName: input.unitName,
    contentTracked,
    beginFull: input.beginFullQty,
    beginOpenEquiv,
    beginCost,
    purchased: input.purchasedQty,
    purchasedCost: input.purchasedCost,
    forfeited,
    transferIn,
    transferOut,
    endFull: input.endFullQty,
    endOpenEquiv,
    endCost,
    usage,
    usageCost: usage * costBasis,
    soldDirect: input.directSalesQty,
    soldPortion,
    revenue,
    nonRevenue,
    nonRevenueCost: nonRevenue * costBasis,
    production: input.productionQty,
    variance,
    variancePct,
    varianceCost: variance * costBasis,
    varianceRetail: variance * input.currentRetail,
    costBasis,
    flags: {
      short: variance < 0,
      missingPrice: costBasis <= 0 || input.currentRetail <= 0,
    },
  };
}

export interface ReconCategoryGroup {
  categoryName: string;
  productType: string;
  rows: ReconRow[];
  totals: ReconTotals;
}

export interface ReconTotals {
  beginCost: number;
  endCost: number;
  usageCost: number;
  revenue: number;
  nonRevenueCost: number;
  varianceCost: number;
  varianceRetail: number;
}

export interface ReconReport {
  period: ReconPeriod;
  rows: ReconRow[];
  categories: ReconCategoryGroup[];
  totals: ReconTotals;
}

function sumTotals(rows: ReconRow[]): ReconTotals {
  const totals: ReconTotals = {
    beginCost: 0,
    endCost: 0,
    usageCost: 0,
    revenue: 0,
    nonRevenueCost: 0,
    varianceCost: 0,
    varianceRetail: 0,
  };
  for (const row of rows) {
    totals.beginCost += row.beginCost;
    totals.endCost += row.endCost;
    totals.usageCost += row.usageCost;
    totals.revenue += row.revenue;
    totals.nonRevenueCost += row.nonRevenueCost;
    totals.varianceCost += row.varianceCost;
    totals.varianceRetail += row.varianceRetail;
  }
  return totals;
}

export function reconcile(items: ReconItemInput[], period: ReconPeriod): ReconReport {
  const sorted = [...items].sort(
    (a, b) =>
      a.categorySortOrder - b.categorySortOrder ||
      a.categoryName.localeCompare(b.categoryName) ||
      a.itemName.localeCompare(b.itemName) ||
      a.size - b.size,
  );
  const rows = sorted.map(reconcileItem);

  const categories: ReconCategoryGroup[] = [];
  for (const row of rows) {
    let group = categories.find((g) => g.categoryName === row.categoryName);
    if (!group) {
      group = { categoryName: row.categoryName, productType: row.productType, rows: [], totals: sumTotals([]) };
      categories.push(group);
    }
    group.rows.push(row);
  }
  for (const group of categories) group.totals = sumTotals(group.rows);

  return { period, rows, categories, totals: sumTotals(rows) };
}
