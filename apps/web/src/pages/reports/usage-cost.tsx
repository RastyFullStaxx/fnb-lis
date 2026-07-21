import { useMemo, useState } from "react";
import { Gauge } from "lucide-react";
import { round2 } from "@fnb/core";
import { useCountDates } from "@/api/ops";
import { useLocationId } from "@/api/location";
import { exportUrl, useUsageCostReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import {
  TableSurface,
  TableLoading,
  TableEmpty,
  TableError,
  ToolbarField,
  ToolbarSearch,
} from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
import { ChartBlock } from "@/components/charts/chart-block";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const n2 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Usage Cost Report (client report #6): what each item's usage cost for an
    audit period — the same usage the Full Audit shows, item by item. */
export function UsageCostReportPage() {
  const locationId = useLocationId();
  const countDates = useCountDates();
  const [begin, setBegin] = useState<string | undefined>(undefined);
  const [end, setEnd] = useState<string | undefined>(undefined);

  const dates = countDates.data?.dates ?? [];
  const effectiveBegin = begin ?? (dates.length >= 2 ? dates[dates.length - 2] : undefined);
  const endOptions = useMemo(() => dates.filter((d) => !effectiveBegin || d > effectiveBegin), [dates, effectiveBegin]);
  const effectiveEnd = end ?? endOptions.at(-1);
  const report = useUsageCostReport(effectiveBegin, effectiveEnd);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const all = report.data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all;
  }, [report.data, query]);

  // Cost, never qty: every row carries its own UOM (bottles, litres, pieces),
  // so quantities are not comparable across items — only pesos are.
  // Ranked by magnitude so a negative usage cost, which is an anomaly worth
  // seeing, surfaces instead of sorting to the bottom.
  const bars = useMemo(
    () =>
      [...(report.data?.rows ?? [])]
        .sort((a, b) => Math.abs(b.cost) - Math.abs(a.cost))
        .slice(0, 8)
        .map((r) => ({ label: r.name, value: round2(r.cost) })),
    [report.data],
  );

  if (!countDates.isPending && dates.length < 2) {
    return (
      <div>
        <PageHeader title="Usage Cost Report" />
        <EmptyState
          icon={Gauge}
          title="Two committed counts unlock this report"
          description="Usage is the stock consumed between a beginning and an ending count."
        />
      </div>
    );
  }

  const exportParams = { begin: effectiveBegin ?? "", end: effectiveEnd ?? "" };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Usage Cost Report"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "usage-cost", "xlsx", exportParams)}
            csvUrl={exportUrl(locationId, "usage-cost", "csv", exportParams)}
            pdfUrl={exportUrl(locationId, "usage-cost", "pdf", exportParams)}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarSearch label="Search" value={query} onChange={setQuery} placeholder="Find an item…" />
            <ToolbarField label="Beginning" htmlFor="uc-begin">
              <Select value={effectiveBegin} onValueChange={(v) => { setBegin(v); if (effectiveEnd && effectiveEnd <= v) setEnd(undefined); }}>
                <SelectTrigger id="uc-begin" className="tnum w-40 bg-background">
                  <SelectValue placeholder="Pick a date" />
                </SelectTrigger>
                <SelectContent>
                  {dates.map((d) => (
                    <SelectItem key={d} value={d} className="tnum">{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ToolbarField>
            <ToolbarField label="Ending" htmlFor="uc-end">
              <Select value={effectiveEnd} onValueChange={setEnd}>
                <SelectTrigger id="uc-end" className="tnum w-40 bg-background">
                  <SelectValue placeholder="Pick a date" />
                </SelectTrigger>
                <SelectContent>
                  {endOptions.map((d) => (
                    <SelectItem key={d} value={d} className="tnum">{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ToolbarField>
          </>
        }
      >
        {countDates.isPending || (report.isPending && effectiveBegin && effectiveEnd) ? (
          <TableLoading />
        ) : report.isError ? (
          <TableError onRetry={() => void report.refetch()} retrying={report.isRefetching} />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty
            icon={Gauge}
            title="No usage in this period"
            description="Nothing was consumed between these counts, or pick a different pair of dates."
          />
        ) : (
          <>
            {bars.length >= 2 && (
              <ChartBlock title="Usage Cost by Item" hint={`Top ${bars.length} of ${report.data.rows.length} items`}>
                <MagnitudeBars data={bars} name="Usage cost" diverging />
              </ChartBlock>
            )}
            {rows.length === 0 ? (
              <TableEmpty icon={Gauge} title="No rows match the search" description="Try a different item name." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead>Item</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">Qty Used</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="max-w-[22rem] font-medium break-words">{row.name}</TableCell>
                      <TableCell className="text-muted-foreground">{row.uom}</TableCell>
                      <TableCell className={cn("tnum text-right", row.qty < 0 && "text-destructive")}>{n2(row.qty)}</TableCell>
                      <TableCell className={cn("tnum text-right", row.cost < 0 && "text-destructive")}>{formatMoney(row.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {/* Totals always reflect the whole period, not the search subset. */}
                {query.trim() === "" && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={2} className="font-medium">
                        Grand Total
                      </TableCell>
                      <TableCell className="tnum text-right font-medium">{n2(report.data.totals.qty)}</TableCell>
                      <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.cost)}</TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            )}
          </>
        )}
      </TableSurface>
    </div>
  );
}
