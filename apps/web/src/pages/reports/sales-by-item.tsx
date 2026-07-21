import { useMemo, useState } from "react";
import { GlassWater } from "lucide-react";
import { round2 } from "@fnb/core";
import { useCountDates } from "@/api/ops";
import { useLocationId } from "@/api/location";
import { exportUrl, useSalesByItemReport } from "@/api/reports";
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

const n2 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Sales Report — Shot & Bottle (client report #7): per-item sales for an
    audit period, split into portion (shot) and full-unit (bottle) sales, with
    the cost of what was sold and the revenue it earned. */
export function SalesByItemReportPage() {
  const locationId = useLocationId();
  const countDates = useCountDates();
  const [begin, setBegin] = useState<string | undefined>(undefined);
  const [end, setEnd] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");

  const dates = countDates.data?.dates ?? [];
  const effectiveBegin = begin ?? (dates.length >= 2 ? dates[dates.length - 2] : undefined);
  const endOptions = useMemo(() => dates.filter((d) => !effectiveBegin || d > effectiveBegin), [dates, effectiveBegin]);
  const effectiveEnd = end ?? endOptions.at(-1);
  const report = useSalesByItemReport(effectiveBegin, effectiveEnd);

  const visibleRows = useMemo(() => {
    const all = report.data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all;
  }, [report.data, query]);

  // Where the period's revenue actually came from — a ranking the totals row
  // can't show. Built off the full payload, so searching the table below
  // doesn't quietly redefine "top".
  const revenueBars = useMemo(
    () =>
      (report.data?.rows ?? [])
        .filter((r) => r.retail > 0)
        .sort((a, b) => b.retail - a.retail)
        .slice(0, 8)
        .map((r) => ({ label: r.name, value: round2(r.retail) })),
    [report.data],
  );

  if (!countDates.isPending && dates.length < 2) {
    return (
      <div>
        <PageHeader title="Sales Report (Shot & Bottle)" />
        <EmptyState
          icon={GlassWater}
          title="Two committed counts unlock this report"
          description="Shot and bottle sales are reported per audit period, alongside the Full Audit."
        />
      </div>
    );
  }

  const exportParams = { begin: effectiveBegin ?? "", end: effectiveEnd ?? "" };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Sales Report (Shot & Bottle)"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "sales-by-item", "xlsx", exportParams)}
            csvUrl={exportUrl(locationId, "sales-by-item", "csv", exportParams)}
            pdfUrl={exportUrl(locationId, "sales-by-item", "pdf", exportParams)}
            disabled={!report.data?.rows.length}
          />
        }
      />

      {/* Reads once as page copy — it defines two column headings, so it belongs
          with the title, not repeated inside the filter strip. print:hidden
          preserves its prior behaviour (it lived in the print-hidden toolbar)
          and matches the cost-basis note on Cost Snapshot. */}
      <p className="-mt-2 mb-3 text-sm text-muted-foreground print:hidden">
        Shot = recipe portions · Bottle = whole units.
      </p>

      <TableSurface
        filters={
          <>
            <ToolbarSearch value={query} onChange={setQuery} placeholder="Find an item…" label="Search" />
            <ToolbarField label="Beginning" htmlFor="sbi-begin">
              <Select value={effectiveBegin} onValueChange={(v) => { setBegin(v); if (effectiveEnd && effectiveEnd <= v) setEnd(undefined); }}>
                <SelectTrigger id="sbi-begin" className="tnum w-40 bg-background">
                  <SelectValue placeholder="Pick a date" />
                </SelectTrigger>
                <SelectContent>
                  {dates.map((d) => (
                    <SelectItem key={d} value={d} className="tnum">{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ToolbarField>
            <ToolbarField label="Ending" htmlFor="sbi-end">
              <Select value={effectiveEnd} onValueChange={setEnd}>
                <SelectTrigger id="sbi-end" className="tnum w-40 bg-background">
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
            icon={GlassWater}
            title="No sales in this period"
            description="Nothing was sold between these counts, or pick a different pair of dates."
          />
        ) : (
          <>
            {revenueBars.length >= 2 && (
              <ChartBlock title="Revenue by Item" hint={`Top ${revenueBars.length} of ${report.data.rows.length} items`}>
                <MagnitudeBars data={revenueBars} name="Revenue" />
              </ChartBlock>
            )}
            {visibleRows.length === 0 ? (
              <TableEmpty
                icon={GlassWater}
                title="No rows match the search"
                description="Try a different item name."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead>Item</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">Shot</TableHead>
                    <TableHead className="text-right">Bottle</TableHead>
                    <TableHead className="text-right">Total Qty</TableHead>
                    <TableHead className="text-right">Cost of Sold</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row, i) => (
                    <TableRow key={i}>
                      {/* Wrapped, never truncated — an auditor has to read the
                          whole item name to match it against a shelf. */}
                      <TableCell className="max-w-[22rem] font-medium break-words">{row.name}</TableCell>
                      <TableCell className="text-muted-foreground">{row.uom}</TableCell>
                      <TableCell className="tnum text-right">{row.shot > 0 ? n2(row.shot) : "—"}</TableCell>
                      <TableCell className="tnum text-right">{row.bottle > 0 ? n2(row.bottle) : "—"}</TableCell>
                      <TableCell className="tnum text-right">{n2(row.qty)}</TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.cost)}</TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.retail)}</TableCell>
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
                      <TableCell className="tnum text-right font-medium">{n2(report.data.totals.shot)}</TableCell>
                      <TableCell className="tnum text-right font-medium">{n2(report.data.totals.bottle)}</TableCell>
                      <TableCell className="tnum text-right font-medium">{n2(report.data.totals.qty)}</TableCell>
                      <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.cost)}</TableCell>
                      <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.retail)}</TableCell>
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
