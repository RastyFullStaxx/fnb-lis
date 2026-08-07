import { diffReports, type ReconReport, type ReportDiff } from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";

/**
 * Freezing and comparing the Full Audit (client request G, 2026-08-06).
 *
 * The report is computed live from whatever records are currently valid, which
 * is what makes it trustworthy and also what makes an earlier version
 * unrecoverable. Nothing was wrong with the audit trail — every correction
 * keeps its original and logs old→new — but no one could put the two REPORTS
 * side by side, which is what the client actually asked for.
 */

export interface SnapshotParams {
  begin: string;
  end: string;
  productType?: string;
  costBasis: string;
  varianceThresholdPct: number;
}

/** List view — never carries payloads. A dozen frozen audits is megabytes. */
export interface SnapshotSummary {
  id: string;
  slug: string;
  label: string | null;
  note: string | null;
  takenAt: Date;
  takenByName: string;
  params: SnapshotParams;
  supersedesId: string | null;
  totals: ReconReport["totals"];
  rowCount: number;
}

function parsePayload(json: string): ReconReport {
  return JSON.parse(json) as ReconReport;
}

export function snapshotSummary(row: {
  id: string;
  slug: string;
  label: string | null;
  note: string | null;
  takenAt: Date;
  takenByName: string;
  paramsJson: string;
  payloadJson: string;
  supersedesId: string | null;
}): SnapshotSummary {
  const payload = parsePayload(row.payloadJson);
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    note: row.note,
    takenAt: row.takenAt,
    takenByName: row.takenByName,
    params: JSON.parse(row.paramsJson) as SnapshotParams,
    supersedesId: row.supersedesId,
    totals: payload.totals,
    rowCount: payload.rows.length,
  };
}

export async function listSnapshots(locationId: string, slug: string): Promise<SnapshotSummary[]> {
  const rows = await prisma.reportSnapshot.findMany({
    where: { locationId, slug },
    orderBy: { takenAt: "desc" },
  });
  return rows.map(snapshotSummary);
}

/**
 * The comparison, plus the human record of how the numbers got there.
 *
 * The activity entries between the two timestamps are the point. A bare
 * spreadsheet diff says the figure moved; an audit answer says who moved it,
 * when, and why they said they were doing it. Scoped to this location and to
 * the window between the two snapshots, which is exactly the interval the
 * revision happened in.
 */
export interface SnapshotComparison {
  a: SnapshotSummary;
  b: SnapshotSummary;
  diff: ReportDiff;
  activity: Array<{
    id: string;
    ts: Date;
    userName: string | null;
    action: string;
    summary: string;
  }>;
}

export async function compareSnapshots(
  locationId: string,
  aId: string,
  bId: string,
): Promise<SnapshotComparison> {
  const [a, b] = await Promise.all([
    prisma.reportSnapshot.findUnique({ where: { id: aId } }),
    prisma.reportSnapshot.findUnique({ where: { id: bId } }),
  ]);
  // Scope check on BOTH, not just the one in the path: a caller who can name
  // two ids must not be able to read another establishment's audit by pairing
  // one of its own with one of theirs.
  if (!a || a.locationId !== locationId) throw new AppError(404, "Snapshot not found");
  if (!b || b.locationId !== locationId) throw new AppError(404, "Snapshot not found");

  // Always oldest → newest, whichever order they were named in, so "Δ" always
  // reads as "what the revision did" rather than sometimes its inverse.
  const [older, newer] = a.takenAt <= b.takenAt ? [a, b] : [b, a];

  const activity = await prisma.activityLog.findMany({
    where: { locationId, ts: { gt: older.takenAt, lte: newer.takenAt } },
    orderBy: { ts: "asc" },
    take: 200,
    select: { id: true, ts: true, userName: true, action: true, summary: true },
  });

  return {
    a: snapshotSummary(older),
    b: snapshotSummary(newer),
    diff: diffReports(parsePayload(older.payloadJson), parsePayload(newer.payloadJson)),
    // This list answers "what was changed about the numbers". Sign-ins are not
    // that, and neither is `report.snapshot` — the freeze at each end of the
    // window logs itself, so both boundaries would otherwise show up as
    // "changes" that changed nothing. The version list already says who froze
    // what and when.
    activity: activity.filter((row) => !row.action.startsWith("auth.") && row.action !== "report.snapshot"),
  };
}
