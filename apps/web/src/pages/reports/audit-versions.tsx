import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, History } from "lucide-react";
import { varianceRuleText } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useSnapshotCompare, useSnapshots, type SnapshotSummary } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TableEmpty,
  TableFailure,
  TableLoading,
  TableSurface,
  ToolbarField,
  queryFailed,
} from "@/components/table-surface";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Original vs Revised (client request G, 2026-08-06 — "you can back track pa
 * ba or you can see the Original report so you can compare it sa Revised?").
 *
 * The audit trail could always answer "what was changed, by whom, from what to
 * what". What it could not do was put the two REPORTS side by side, because the
 * Full Audit is recomputed live and the earlier version existed only in
 * whatever file someone had exported.
 *
 * Two halves, deliberately together on one screen: the figures that moved, and
 * the human actions that moved them. Either alone is half an answer — a
 * spreadsheet diff with no accountability, or a list of edits with no
 * consequence attached.
 */

const FIELD_LABELS: Record<string, string> = {
  beginFull: "Beginning (full)",
  beginOpenEquiv: "Beginning (open)",
  beginCost: "Beginning value",
  purchased: "Purchased",
  purchasedCost: "Cost of purchase",
  forfeited: "Returned bottles",
  transferIn: "Transferred in",
  transferOut: "Transferred out",
  endFull: "Ending (full)",
  endOpenEquiv: "Ending (open)",
  endCost: "Ending value",
  usage: "Usage",
  usageCost: "Cost of usage",
  soldDirect: "Sold",
  soldPortion: "Used in recipes",
  revenue: "Revenue",
  nonRevenue: "Non-revenue",
  nonRevenueCost: "Non-revenue cost",
  production: "Production",
  variance: "Over/short",
  varianceCost: "Over/short at cost",
  varianceRetail: "Over/short at retail",
};

const TOTAL_LABELS: Record<string, string> = {
  beginCost: "Beginning value",
  endCost: "Ending value",
  usageCost: "Cost of usage",
  revenue: "Revenue",
  nonRevenueCost: "Non-revenue cost",
  varianceCost: "Over/short at cost",
  varianceRetail: "Over/short at retail",
};

/** Money fields print as pesos; quantities print as quantities. */
const MONEY = new Set([
  "beginCost", "endCost", "usageCost", "revenue", "nonRevenueCost",
  "varianceCost", "varianceRetail", "purchasedCost",
]);

function num(field: string, value: number | null): string {
  if (value === null) return "—";
  return MONEY.has(field) ? formatMoney(value) : String(Math.round(value * 10000) / 10000);
}

function versionLabel(s: SnapshotSummary): string {
  const when = new Date(s.takenAt).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  return s.label ? `${s.label} · ${when}` : when;
}

export function AuditVersionsPage() {
  const locationId = useLocationId();
  const snapshots = useSnapshots();
  const list = snapshots.data?.snapshots ?? [];

  /**
   * Default to the two most recent, oldest of the pair on the left. That is
   * the question people actually arrive with — "what changed in the last
   * revision?" — so the answer is on screen before anyone touches a picker.
   */
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);
  const pair = useMemo(() => {
    if (aId && bId) return { a: aId, b: bId };
    if (list.length >= 2) return { a: list[1]!.id, b: list[0]!.id };
    return { a: null, b: null };
  }, [aId, bId, list]);

  const compare = useSnapshotCompare(pair.a, pair.b);
  const diff = compare.data?.diff;

  return (
    <div className="flex min-h-0 flex-1 flex-col print:block">
      <PageHeader
        title="Full Audit — Versions"
        actions={
          <Button asChild variant="outline" size="sm" className="print:hidden">
            <Link to={`/l/${locationId}/reports/full-audit`}>
              <ArrowLeft className="size-4" /> Back to the report
            </Link>
          </Button>
        }
      />

      <TableSurface
        className="flex-none"
        bodyClassName="p-4"
        filters={
          <>
            <ToolbarField label="Original" htmlFor="ver-a">
              <Select value={pair.a ?? ""} onValueChange={setAId}>
                <SelectTrigger id="ver-a" className="w-72 bg-background">
                  <SelectValue placeholder="Pick a version…" />
                </SelectTrigger>
                <SelectContent>
                  {list.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{versionLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ToolbarField>
            <ToolbarField label="Revised" htmlFor="ver-b">
              <Select value={pair.b ?? ""} onValueChange={setBId}>
                <SelectTrigger id="ver-b" className="w-72 bg-background">
                  <SelectValue placeholder="Pick a version…" />
                </SelectTrigger>
                <SelectContent>
                  {list.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{versionLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ToolbarField>
          </>
        }
      >
        {queryFailed(snapshots) ? (
          <TableFailure query={snapshots} title="Couldn't load the saved versions" />
        ) : snapshots.isPending ? (
          <TableLoading rows={3} />
        ) : list.length < 2 ? (
          <TableEmpty
            icon={History}
            title={list.length === 0 ? "No versions saved yet" : "Only one version saved"}
            description={
              list.length === 0
                ? "Open the Full Audit and choose Save as Final to keep a copy of what it says today. Comparing needs two."
                : "Save the report again after a revision and the two versions can be compared here."
            }
          />
        ) : compare.isPending ? (
          <TableLoading rows={3} />
        ) : (
          <div className="space-y-1 text-sm">
            <p>
              <span className="font-medium">{versionLabel(compare.data!.a)}</span>
              {" → "}
              <span className="font-medium">{versionLabel(compare.data!.b)}</span>
            </p>
            <p className="text-muted-foreground">
              Period {compare.data!.a.params.begin} → {compare.data!.a.params.end} · saved by{" "}
              {compare.data!.a.takenByName} and {compare.data!.b.takenByName}
              {compare.data!.a.params.varianceThresholdPct !== compare.data!.b.params.varianceThresholdPct && (
                // Worth saying out loud: a moved threshold can repaint the
                // whole report without a single figure changing.
                <span className="text-destructive">
                  {" "}· the over/short threshold changed between these two versions (
                  {compare.data!.a.params.varianceThresholdPct}% → {compare.data!.b.params.varianceThresholdPct}%)
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">{varianceRuleText(compare.data!.b.params.varianceThresholdPct)}</p>
          </div>
        )}
      </TableSurface>

      {diff && (
        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {diff.summary.identical ? (
            <div className="rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm">
              <span className="font-medium">These two versions are identical.</span> Every figure matches — the
              revision did not move the report.
            </div>
          ) : (
            <div className="rounded-lg border px-4 py-3 text-sm">
              <span className="font-medium">
                {diff.summary.rowsChanged} of {diff.summary.rowsCompared} items changed
              </span>
              {diff.summary.varianceRowsChanged > 0 && (
                <span className="text-destructive">
                  {" "}· {diff.summary.varianceRowsChanged} moved its over/short
                </span>
              )}
              {diff.summary.rowsAdded > 0 && <span> · {diff.summary.rowsAdded} appeared</span>}
              {diff.summary.rowsRemoved > 0 && <span> · {diff.summary.rowsRemoved} disappeared</span>}
            </div>
          )}

          {diff.totals.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Report totals</h2>
              <TableSurface>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted hover:bg-muted">
                      <TableHead>Figure</TableHead>
                      <TableHead className="text-right">Original</TableHead>
                      <TableHead className="text-right">Revised</TableHead>
                      <TableHead className="text-right">Δ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {diff.totals.map((t) => (
                      <TableRow key={t.field}>
                        <TableCell className="font-medium">{TOTAL_LABELS[t.field] ?? t.field}</TableCell>
                        <TableCell className="tnum text-right">{formatMoney(t.a)}</TableCell>
                        <TableCell className="tnum text-right">{formatMoney(t.b)}</TableCell>
                        <TableCell className={t.delta < 0 ? "tnum text-right font-medium text-destructive" : "tnum text-right font-medium"}>
                          {t.delta > 0 ? "+" : ""}{formatMoney(t.delta)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableSurface>
            </section>
          )}

          {diff.rows.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">What moved, item by item</h2>
              <TableSurface>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted hover:bg-muted">
                      <TableHead>Item</TableHead>
                      <TableHead>Figure</TableHead>
                      <TableHead className="text-right">Original</TableHead>
                      <TableHead className="text-right">Revised</TableHead>
                      <TableHead className="text-right">Δ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {diff.rows.map((row) =>
                      row.fields.map((f, i) => (
                        <TableRow key={`${row.locationItemId}-${f.field}`}>
                          {/* The item name once per group, not once per figure —
                              five repeats of the same name is noise, and the
                              eye needs the grouping to read the block. */}
                          <TableCell className={i === 0 ? "font-medium" : "text-muted-foreground/0"}>
                            {i === 0 ? (
                              <>
                                {row.itemName}
                                {row.presence !== "both" && (
                                  <Badge variant={row.presence === "added" ? "success" : "secondary"} className="ml-2">
                                    {row.presence === "added" ? "New" : "Gone"}
                                  </Badge>
                                )}
                                <span className="ml-2 text-xs font-normal text-muted-foreground">{row.categoryName}</span>
                              </>
                            ) : null}
                          </TableCell>
                          <TableCell className={f.field === "variance" ? "font-medium" : undefined}>
                            {FIELD_LABELS[f.field] ?? f.field}
                          </TableCell>
                          <TableCell className="tnum text-right">{num(f.field, f.a)}</TableCell>
                          <TableCell className="tnum text-right">{num(f.field, f.b)}</TableCell>
                          <TableCell className={f.delta < 0 ? "tnum text-right font-medium text-destructive" : "tnum text-right font-medium"}>
                            {f.delta > 0 ? "+" : ""}{num(f.field, f.delta)}
                          </TableCell>
                        </TableRow>
                      )),
                    )}
                  </TableBody>
                </Table>
              </TableSurface>
            </section>
          )}

          <section className="pb-6">
            <h2 className="mb-2 text-sm font-semibold">What was done in between</h2>
            <p className="mb-2 text-sm text-muted-foreground">
              Every recorded action at this location between the two versions. This is the half a spreadsheet
              comparison cannot give you: not just that a figure moved, but who moved it and what they said
              they were doing.
            </p>
            <TableSurface>
              {compare.data!.activity.length === 0 ? (
                <TableEmpty
                  title="Nothing was recorded between these versions"
                  description="If figures still differ, the cause is outside this location's activity — a catalog price, a cost-basis change, or a different reporting period."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted hover:bg-muted">
                      <TableHead className="w-48">When</TableHead>
                      <TableHead className="w-40">Who</TableHead>
                      <TableHead>What</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {compare.data!.activity.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="tnum text-muted-foreground">
                          {new Date(a.ts).toLocaleString(undefined, {
                            month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell>{a.userName ?? "—"}</TableCell>
                        <TableCell>{a.summary}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TableSurface>
          </section>
        </div>
      )}
    </div>
  );
}
