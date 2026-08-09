import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useCountDates } from "@/api/ops";
import { exportUrl, useVarianceSummaryReport } from "@/api/reports";
import { formatMoney, cn, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TableEmpty, TableFailure, TableLoading, ToolbarField, queryFailed } from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
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
 * Variance Summary Report (client req, version 2 of the existing Variance
 * Report #10): a category-only view of the Full Audit — no item rows. One
 * row per category: status, the brands carrying the variance, and the
 * Short/Over retail split into two columns. Remarks is carried on every
 * export (XLSX/CSV/PDF) but deliberately NOT shown here — it's typed in by
 * hand after downloading, not something this live report tracks or displays.
 *
 * Own page, own route, own hub card — not a view bolted onto Full Audit.
 */
export function VarianceSummaryPage() {
  const locationId = useLocationId();
  const countDates = useCountDates();
  const [begin, setBegin] = useState<string>();
  const [end, setEnd] = useState<string>();

  const dates = countDates.data?.dates ?? [];
  const effectiveBegin = begin ?? (dates.length >= 2 ? dates[dates.length - 2] : undefined);
  const effectiveEnd = end ?? (dates.length >= 2 ? dates[dates.length - 1] : undefined);
  const endOptions = useMemo(() => dates.filter((d) => !effectiveBegin || d > effectiveBegin), [dates, effectiveBegin]);

  const report = useVarianceSummaryReport(effectiveBegin ?? "", effectiveEnd ?? "");

  const exportParams = { begin: effectiveBegin ?? "", end: effectiveEnd ?? "" };

  // Rows carrying a real variance vs. rows that reconciled clean ("Ok") —
  // used only to pick the right empty-state message when every category is Ok.
  const varianceRows = useMemo(() => (report.data?.rows ?? []).filter((r) => r.status !== "Ok"), [report.data]);

  if (countDates.isPending) {
    return (
      <div>
        <PageHeader title="Variance Summary" />
        <TableLoading rows={10} />
      </div>
    );
  }

  if (dates.length < 2) {
    return (
      <div>
        <PageHeader title="Variance Summary" />
        <EmptyState
          icon={BarChart3}
          title="Two committed counts unlock this report"
          description="This is a category rollup of the reconciliation between a beginning and an ending count. Commit a count, record the period's activity, then count again."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Variance Summary"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "variance-summary", "xlsx", exportParams)}
            csvUrl={exportUrl(locationId, "variance-summary", "csv", exportParams)}
            pdfUrl={exportUrl(locationId, "variance-summary", "pdf", exportParams)}
            onPrint={() => window.print()}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
        <div className="flex shrink-0 flex-wrap items-end gap-x-3 gap-y-2 border-b bg-muted/30 px-3 py-2.5 print:hidden">
          <ToolbarField label="Beginning" htmlFor="vs-begin">
            <Select
              value={effectiveBegin}
              onValueChange={(v) => {
                setBegin(v);
                if (effectiveEnd && effectiveEnd <= v) setEnd(undefined);
              }}
            >
              <SelectTrigger id="vs-begin" className="tnum w-32 bg-background">
                <SelectValue placeholder="Pick a date" />
              </SelectTrigger>
              <SelectContent>
                {dates.map((d) => (
                  <SelectItem key={d} value={d} className="tnum">{formatDate(d)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ToolbarField>
          <ToolbarField label="Ending" htmlFor="vs-end">
            <Select value={effectiveEnd} onValueChange={setEnd}>
              <SelectTrigger id="vs-end" className="tnum w-32 bg-background">
                <SelectValue placeholder="Pick a date" />
              </SelectTrigger>
              <SelectContent>
                {endOptions.map((d) => (
                  <SelectItem key={d} value={d} className="tnum">{formatDate(d)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ToolbarField>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {queryFailed(report) ? (
            <TableFailure query={report} title="Couldn't load the Variance Summary" />
          ) : report.isPending ? (
            <TableLoading rows={10} />
          ) : !report.data || report.data.rows.length === 0 ? (
            <TableEmpty
              icon={BarChart3}
              title="No activity or counts in this period"
              description="Pick different boundary dates, or check that the counts were committed."
            />
          ) : varianceRows.length === 0 ? (
            <TableEmpty
              icon={BarChart3}
              title="No category carries a variance in this period"
              description="Every category reconciled cleanly for this date range."
            />
          ) : (
            <Table className="border-separate border-spacing-0 text-sm [&_td]:border-b [&_td]:px-3 [&_th]:border-b [&_th]:px-3">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead colSpan={3} className="sticky top-0 z-20 bg-muted" aria-label="Category column group" />
                  <TableHead
                    colSpan={2}
                    className="sticky top-0 z-20 border-l bg-muted text-center text-[11px] font-medium text-muted-foreground"
                  >
                    Variance at Retail
                  </TableHead>
                </TableRow>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky top-8 z-20 min-w-[10rem] bg-muted">Category</TableHead>
                  <TableHead className="sticky top-8 z-20 bg-muted">Variances</TableHead>
                  <TableHead className="sticky top-8 z-20 min-w-[16rem] bg-muted">Brands</TableHead>
                  <TableHead className="sticky top-8 z-20 border-l bg-muted text-right">Short</TableHead>
                  <TableHead className="sticky top-8 z-20 bg-muted text-right">Over</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.rows.map((row) => {
                  const isOk = row.status === "Ok";
                  return (
                    <TableRow
                      key={row.categoryName}
                      className={cn(
                        row.short > 0 && "bg-destructive/5",
                        row.over > 0 && "bg-warning/10",
                      )}
                    >
                      <TableCell className="font-medium uppercase">{row.categoryName}</TableCell>
                      <TableCell className={cn(!isOk && (row.short > 0 ? "text-destructive" : "font-medium"))}>
                        {row.status}
                      </TableCell>
                      <TableCell className="max-w-[28rem] break-words text-muted-foreground">
                        {row.brands || "—"}
                      </TableCell>
                      <TableCell className="tnum text-right">
                        {row.short > 0 ? formatMoney(round2(row.short)) : "—"}
                      </TableCell>
                      <TableCell className="tnum text-right">
                        {row.over > 0 ? formatMoney(round2(row.over)) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted font-semibold hover:bg-muted [&_td]:border-t-2">
                  <TableCell colSpan={3}>GRAND TOTAL</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(round2(report.data.totals.short))}</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(round2(report.data.totals.over))}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
