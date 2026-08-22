import { hasVariance, round2, type ReconCategoryGroup, type ReconReport } from "@fnb/core";

/**
 * Variance Summary Report (client req, version 2 of the existing Variance
 * Report #10): a category-only rollup, no item rows. One row per category —
 * status, the brands that carry the variance, and the same over/short retail
 * total split into two columns.
 *
 * Pure PROJECTION of an existing ReconReport (buildFullAudit() output). No
 * new formula, no recomputation — every field here traces back to an
 * existing ReconRow or ReconTotals field. See variance-summary-report-plan.md.
 */

export interface VarianceSummaryRow {
  categoryName: string;
  /** "Ok" when nothing in the category carries a variance, otherwise
      "Short <amount>" or "Over <amount>" — the unit-amount magnitude, same
      sign convention already used on screen. */
  status: string;
  /** Item name + signed variance, joined for every row where hasVariance()
      is true — same join style as the client's screenshot. Empty when Ok. */
  brands: string;
  /** varianceRetail < 0, as a positive magnitude. Zero when not short. */
  short: number;
  /** varianceRetail > 0, as-is. Zero when not over. */
  over: number;
  /** Free-text guidance for whoever investigates the variance (e.g. "Check
      sales and non rev"). Not derived from any stored field — the client
      types it in, same as every other column here traces to ReconRow/Totals
      except this one, which is presentation-only and always editable.
      Empty string when nothing has been entered yet, never null, so every
      export format (CSV/PDF/XLSX) and the on-screen table can all show the
      SAME column instead of Remarks being an XLSX-only afterthought. */
  remarks: string;
}

export interface VarianceSummaryReport {
  period: ReconReport["period"];
  rows: VarianceSummaryRow[];
  totals: { short: number; over: number };
}

/** One category group in, one summary row out. */
function summarizeCategory(group: ReconCategoryGroup): VarianceSummaryRow {
  const varianceRows = group.rows.filter((r) => hasVariance(r.variance));

  const categoryVariance = round2(group.totals.varianceRetail);
  const status =
    varianceRows.length === 0
      ? "Ok"
      : `${categoryVariance < 0 ? "Short" : "Over"} ${round2(Math.abs(
          // Legacy "Short 4 / Over 6.32" status is a UNIT amount, not a peso
          // amount — sum the rows' own (unit) variance, not varianceRetail.
          varianceRows.reduce((sum, r) => sum + r.variance, 0),
        ))}`;

  const brands = varianceRows
    .map((r) => `${r.itemName} ${r.variance >= 0 ? "+" : ""}${round2(r.variance)}`)
    .join(", ");

  return {
    categoryName: group.categoryName,
    status,
    brands,
    short: categoryVariance < 0 ? round2(-categoryVariance) : 0,
    over: categoryVariance > 0 ? round2(categoryVariance) : 0,
    // Blank at generation time — this is a hand-entered column, not a derived
    // one. Left "" (not undefined/null) so every consumer can print it as-is.
    remarks: "",
  };
}

/** Category group in, summary row out — for every category, plus the grand total. */
export function varianceSummaryReport(report: ReconReport): VarianceSummaryReport {
  const rows = report.categories.map(summarizeCategory);
  const totals = rows.reduce(
    (acc, r) => ({ short: acc.short + r.short, over: acc.over + r.over }),
    { short: 0, over: 0 },
  );
  return {
    period: report.period,
    rows,
    totals: { short: round2(totals.short), over: round2(totals.over) },
  };
}
