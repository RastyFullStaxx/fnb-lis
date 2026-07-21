import { useMemo, useState } from "react";
import { Undo2 } from "lucide-react";
import { round2 } from "@fnb/core";
import { useCountDates } from "@/api/ops";
import { useLocationId } from "@/api/location";
import { exportUrl, useForfeitsReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, TableError, ToolbarSearch } from "@/components/table-surface";
import { DateRangeControl, ExportButtons } from "@/components/report-toolbar";
import { ChartBlock } from "@/components/charts/chart-block";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useReportRange } from "./use-report-range";

const n2 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Bars stay legible to about this many rows; the rest is a long tail of ones. */
const ITEM_BAR_CAP = 8;

/** Forfeited Bottles Report (client report #5): returned bottles in a range,
    with the open content they carried valued at cost and retail. */
export function ForfeitsReportPage() {
  const locationId = useLocationId();
  const dates = useCountDates();
  const [from, to, setFrom, setTo] = useReportRange(dates.data?.dates);
  const report = useForfeitsReport(from, to);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const all = report.data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all;
  }, [report.data, query]);

  // The report lists one line per return, so the same bottle recurs across
  // dates — rolled up by item it answers the question the table can't: which
  // items are bleeding the most value back out of stock.
  // Ranked off the FULL payload, not the search-filtered `rows`: like every
  // other report's chart, the ranking names the period's real top items while
  // a search only narrows the table beneath it. Ranking the filtered set would
  // quietly redefine "top" to mean "top within my search".
  const itemValue = useMemo(() => {
    const byItem = new Map<string, number>();
    for (const r of report.data?.rows ?? []) byItem.set(r.name, (byItem.get(r.name) ?? 0) + r.costValue);
    const bars = [...byItem]
      .map(([label, value]) => ({ label, value: round2(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, ITEM_BAR_CAP);
    return { bars, itemCount: byItem.size };
  }, [report.data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Forfeited Bottles Report"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "forfeits", "xlsx", { from, to })}
            csvUrl={exportUrl(locationId, "forfeits", "csv", { from, to })}
            pdfUrl={exportUrl(locationId, "forfeits", "pdf", { from, to })}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <TableSurface
        filters={
          <>
            <DateRangeControl from={from} to={to} onFrom={setFrom} onTo={setTo} />
            <ToolbarSearch value={query} onChange={setQuery} placeholder="Find an item…" label="Search" />
          </>
        }
      >
        {report.isPending ? (
          <TableLoading />
        ) : report.isError ? (
          <TableError onRetry={() => void report.refetch()} retrying={report.isRefetching} />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty
            icon={Undo2}
            title="No returned bottles in this range"
            description="Adjust the dates to find recorded returns."
          />
        ) : rows.length === 0 ? (
          <TableEmpty
            icon={Undo2}
            title="No rows match the search"
            description="Try a different item name."
          />
        ) : (
          <>
            {itemValue.bars.length >= 2 && (
              <ChartBlock
                title="Forfeited Value by Item"
                hint={`Top ${itemValue.bars.length} of ${itemValue.itemCount} items`}
              >
                <MagnitudeBars data={itemValue.bars} name="At cost" />
              </ChartBlock>
            )}
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead>Date</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Open Content (Units)</TableHead>
                  <TableHead className="text-right">At Cost</TableHead>
                  <TableHead className="text-right">At Retail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="tnum">{row.date}</TableCell>
                    {/* Wrapped, not truncated — an auditor has to read the whole
                        bottle name, but it must not push the table sideways. */}
                    <TableCell className="max-w-[22rem] font-medium break-words">{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">{row.uom}</TableCell>
                    <TableCell className="tnum text-right">{n2(row.qty)}</TableCell>
                    <TableCell className="tnum text-right">{n2(row.contentEquiv)}</TableCell>
                    <TableCell className="tnum text-right">{formatMoney(row.costValue)}</TableCell>
                    <TableCell className="tnum text-right">{formatMoney(row.retailValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {/* The totals are the payload's, covering the whole range — showing
                  them under a filtered table would read as that subset's total. */}
              {query.trim() === "" && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} className="font-medium">
                      Grand Total
                    </TableCell>
                    <TableCell className="tnum text-right font-medium">{n2(report.data.totals.qty)}</TableCell>
                    <TableCell className="tnum text-right font-medium">{n2(report.data.totals.contentEquiv)}</TableCell>
                    <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.costValue)}</TableCell>
                    <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.retailValue)}</TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </>
        )}
      </TableSurface>
    </div>
  );
}
