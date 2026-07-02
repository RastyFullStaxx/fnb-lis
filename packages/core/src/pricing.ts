/**
 * Price resolution policy (documented in DESIGN/architecture):
 * ending-count snapshot → beginning-count snapshot → current catalog cost.
 * The legacy system silently used current prices everywhere; snapshots keep
 * historical reports stable when prices change.
 */
export function resolveCostBasis(
  endUnitCost: number | null,
  beginUnitCost: number | null,
  currentCost: number,
): number {
  if (endUnitCost !== null && endUnitCost > 0) return endUnitCost;
  if (beginUnitCost !== null && beginUnitCost > 0) return beginUnitCost;
  return currentCost;
}

export function lineTotal(qty: number, unitCost: number): number {
  return qty * unitCost;
}

/** Direct-line revenue. Matches legacy report behavior: price × qty (discount informational). */
export function saleRevenue(qty: number, unitPrice: number): number {
  return unitPrice * qty;
}

/** A menu ingredient's share of the menu's SRP (legacy `serving / mtotal` split). */
export function menuRevenueShare(
  serving: number,
  totalServing: number,
  srp: number,
  qtySold: number,
): number {
  if (totalServing <= 0) return 0;
  return ((serving / totalServing) * srp) * qtySold;
}

/** Legacy discount deduction: the discount amount split evenly across recipe lines. */
export function menuDiscountDeduction(
  srp: number,
  discountPct: number,
  ingredientCount: number,
  qtySold: number,
): number {
  if (ingredientCount <= 0 || discountPct <= 0) return 0;
  return ((srp * (discountPct / 100)) / ingredientCount) * qtySold;
}

/** Estimated recipe cost from ingredient catalog costs (builder preview + costAtPublish). */
export function recipeCost(
  lines: Array<{ servingQty: number; size: number; contentTracked: boolean; ingredientCost: number }>,
): number {
  return lines.reduce((sum, line) => {
    const perServing = line.contentTracked
      ? (line.servingQty / (line.size || 1)) * line.ingredientCost
      : line.servingQty * line.ingredientCost;
    return sum + perServing;
  }, 0);
}
