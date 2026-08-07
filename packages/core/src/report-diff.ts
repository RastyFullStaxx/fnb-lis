import type { ReconReport, ReconRow, ReconTotals } from "./reconciliation";
import { hasVariance } from "./reconciliation";

/**
 * What changed between two Full Audit reports (client request G, 2026-08-06 —
 * "you can back track pa ba or you can see the Original report so you can
 * compare it sa Revised?").
 *
 * Pure, like every other file in this package: it takes two already-computed
 * reports and subtracts them. It reads no database, adds no formula, and could
 * not move a reconciliation number if it tried — every figure here is a
 * difference between two numbers the sacred math already produced.
 *
 * The comparison is by `locationItemId`, never by row position: a revision that
 * adds an item shifts every row after it, and a positional diff would then
 * report the entire report as changed.
 */

/** Which of a row's figures moved, and by how much. */
export interface RowDelta {
  locationItemId: string;
  itemName: string;
  categoryName: string;
  /** Present in both reports, or added/removed by the revision. */
  presence: "both" | "added" | "removed";
  /** `a`/`b` are null on the side where the row does not exist. */
  fields: Array<{ field: DiffField; a: number | null; b: number | null; delta: number }>;
  /** Did the over/short itself move? The column an auditor checks first. */
  varianceMoved: boolean;
}

/**
 * The figures worth diffing, in reading order.
 *
 * Deliberately NOT every field on the row. `costBasis` and `variancePct` are
 * derived from figures already listed here, so including them would report one
 * change three times and bury the movement that caused it. `flags` is a
 * presentation concern. Name, size and unit are identity, not measurement — a
 * renamed item is a catalog edit, not a revised count.
 */
export const DIFF_FIELDS = [
  "beginFull",
  "beginOpenEquiv",
  "beginCost",
  "purchased",
  "purchasedCost",
  "forfeited",
  "transferIn",
  "transferOut",
  "endFull",
  "endOpenEquiv",
  "endCost",
  "usage",
  "usageCost",
  "soldDirect",
  "soldPortion",
  "revenue",
  "nonRevenue",
  "nonRevenueCost",
  "production",
  "variance",
  "varianceCost",
  "varianceRetail",
] as const;

export type DiffField = (typeof DIFF_FIELDS)[number];

export interface TotalsDelta {
  field: keyof ReconTotals;
  a: number;
  b: number;
  delta: number;
}

export interface ReportDiff {
  /** Rows whose figures moved, plus rows only one side has. */
  rows: RowDelta[];
  totals: TotalsDelta[];
  summary: {
    rowsCompared: number;
    rowsChanged: number;
    rowsAdded: number;
    rowsRemoved: number;
    /** Of the changed rows, how many moved their over/short. */
    varianceRowsChanged: number;
    /** True when the two reports are the same report. */
    identical: boolean;
  };
}

/**
 * Two floats are "the same figure" when they differ by less than this.
 *
 * Reuses the reconciliation's own epsilon through `hasVariance`, for the same
 * reason it exists there: a weighed quantity is `full + remaining / size`, and
 * sizes like 700 ml are not representable in binary, so re-computing an
 * unchanged period can land on 1e-16 instead of a clean zero. Without this the
 * compare view would report every weighed row as revised on a period where
 * nothing happened at all.
 */
function moved(a: number, b: number): boolean {
  return hasVariance(b - a);
}

function rowDelta(a: ReconRow | undefined, b: ReconRow | undefined): RowDelta | null {
  const present = (a ?? b)!;
  const fields: RowDelta["fields"] = [];
  for (const field of DIFF_FIELDS) {
    const av = a ? a[field] : null;
    const bv = b ? b[field] : null;
    if (av !== null && bv !== null && !moved(av, bv)) continue;
    // A row that exists on one side only reports every non-zero figure it has,
    // so the reader sees what appeared or vanished rather than a bare label.
    if ((av === null || bv === null) && (av ?? bv) === 0) continue;
    fields.push({ field, a: av, b: bv, delta: (bv ?? 0) - (av ?? 0) });
  }
  if (fields.length === 0) return null;
  return {
    locationItemId: present.locationItemId,
    itemName: present.itemName,
    categoryName: present.categoryName,
    presence: a && b ? "both" : a ? "removed" : "added",
    fields,
    varianceMoved: fields.some((f) => f.field === "variance"),
  };
}

export function diffReports(a: ReconReport, b: ReconReport): ReportDiff {
  const byId = new Map<string, { a?: ReconRow; b?: ReconRow }>();
  for (const row of a.rows) byId.set(row.locationItemId, { a: row });
  for (const row of b.rows) {
    const entry = byId.get(row.locationItemId);
    if (entry) entry.b = row;
    else byId.set(row.locationItemId, { b: row });
  }

  const rows: RowDelta[] = [];
  for (const { a: ar, b: br } of byId.values()) {
    const delta = rowDelta(ar, br);
    if (delta) rows.push(delta);
  }
  // Variance movements first — the column that decides whether a revision
  // mattered — then by size of the move, then by name so ties are stable.
  rows.sort((x, y) => {
    if (x.varianceMoved !== y.varianceMoved) return x.varianceMoved ? -1 : 1;
    const mag = (d: RowDelta) => Math.max(...d.fields.map((f) => Math.abs(f.delta)));
    const diff = mag(y) - mag(x);
    return diff !== 0 ? diff : x.itemName.localeCompare(y.itemName);
  });

  const totals: TotalsDelta[] = [];
  for (const field of Object.keys(a.totals) as Array<keyof ReconTotals>) {
    const av = a.totals[field];
    const bv = b.totals[field];
    if (!moved(av, bv)) continue;
    totals.push({ field, a: av, b: bv, delta: bv - av });
  }

  return {
    rows,
    totals,
    summary: {
      rowsCompared: byId.size,
      rowsChanged: rows.filter((r) => r.presence === "both").length,
      rowsAdded: rows.filter((r) => r.presence === "added").length,
      rowsRemoved: rows.filter((r) => r.presence === "removed").length,
      varianceRowsChanged: rows.filter((r) => r.varianceMoved).length,
      identical: rows.length === 0 && totals.length === 0,
    },
  };
}
