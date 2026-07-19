/**
 * Cost Analysis math (client req #3) — the legacy `food_downloadCA` /
 * `beverage_downloadCA` Excel formulas (fnb-main reports.php:3083-3259),
 * reproduced as pure functions:
 *
 *   Cost      = Beginning inventory cost + Purchases cost − Ending inventory cost
 *   Cost Net  = Cost ÷ (1 + VAT)                       (legacy: =E/1.12)
 *   GROSS %   = Cost ÷ that module's gross sales       (legacy: =E/B8)
 *   NET %     = Cost Net ÷ that module's net sales     (legacy: =F/B9)
 *   Net sales = Gross ÷ (1 + VAT)                      (legacy: =B8/1.12)
 *
 * Deviations from the legacy sheet (logged in architecture.md §8):
 *  - 1.12 is used consistently; the legacy divided some (always-zero) rows by
 *    1.22 instead — dead cells, not a formula to preserve.
 *  - The "VAT" line shows the VAT AMOUNT (gross − net); the legacy put
 *    `=B5/1.12` there, which is net sales mislabeled as VAT.
 */

/** Philippine VAT. ponytail: per-client override only if a client ever asks. */
export const VAT_RATE = 0.12;

export function netOfVat(gross: number): number {
  return gross / (1 + VAT_RATE);
}

export interface CostAnalysisLine {
  cost: number;
  costNet: number;
}

export function costLine(beginningCost: number, purchasesCost: number, endingCost: number): CostAnalysisLine {
  const cost = beginningCost + purchasesCost - endingCost;
  return { cost, costNet: netOfVat(cost) };
}

/** Percentage of `value` over `base` (e.g. cost ÷ gross sales), null when the base is zero. */
export function pctOf(value: number, base: number): number | null {
  return base > 0 ? (value / base) * 100 : null;
}
