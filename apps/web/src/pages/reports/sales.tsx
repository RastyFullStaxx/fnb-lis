import { useMemo, useState } from "react";
import { Receipt } from "lucide-react";
import { round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useCountDates } from "@/api/ops";
import { exportUrl, useSalesReport, type SalesReportView } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, TableError, ToolbarField, ToolbarSearch } from "@/components/table-surface";
import { DateRangeControl, ExportButtons } from "@/components/report-toolbar";
import { ChartBlock } from "@/components/charts/chart-block";
import { PeriodColumns } from "@/components/charts/period-columns";
import { shortDate } from "@/components/charts/chart-kit";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const n2 = (v: number) => round2(v).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Kind-specific copy so each view names itself honestly. */
const VIEW_COPY: Record<SalesReportView, { empty: string; hint: string }> = {
  sales: { empty: "No sales in this range", hint: "Adjust the dates to find recorded sales." },
  discounted: { empty: "No discounted sales in this range", hint: "Only sales carrying a discount appear here." },
  production: { empty: "No production use in this range", hint: "Recipe batches recorded as Production appear here." },
};

export function SalesReportPage() {
  const locationId = useLocationId();
  const dates = useCountDates();
  const [from, to, setFrom, setTo] = useReportRange(dates.data?.dates);
  // Client req (2026-07-20): Production and Discounted generate their own
  // reports, but live under Sales — a view tab, not a separate page.
  const [view, setView] = useState<SalesReportView>("sales");
  const report = useSalesReport(from, to, view);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const all = report.data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all;
  }, [report.data, query]);

  // Net revenue per business day — the trend the totals row can't show.
  const byDay = useMemo(() => {
    const days = new Map<string, number>();
    for (const row of report.data?.rows ?? []) {
      days.set(row.saleDate, (days.get(row.saleDate) ?? 0) + row.net);
    }
    return [...days.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, net]) => ({ label: shortDate(date), value: round2(net), tooltipLabel: date }));
  }, [report.data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Sales Report"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "sales", "xlsx", { from, to, view })}
            csvUrl={exportUrl(locationId, "sales", "csv", { from, to, view })}
            pdfUrl={exportUrl(locationId, "sales", "pdf", { from, to, view })}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarField label="View">
              <Tabs value={view} onValueChange={(v) => setView(v as SalesReportView)}>
                <TabsList>
                  <TabsTrigger value="sales">Sales</TabsTrigger>
                  <TabsTrigger value="discounted">Discounted</TabsTrigger>
                  <TabsTrigger value="production">Production</TabsTrigger>
                </TabsList>
              </Tabs>
            </ToolbarField>
            <ToolbarSearch value={query} onChange={setQuery} placeholder="Find an item or menu…" label="Search" />
            <DateRangeControl from={from} to={to} onFrom={setFrom} onTo={setTo} />
          </>
        }
      >
        {report.isPending ? (
          <TableLoading />
        ) : report.isError ? (
          <TableError onRetry={() => void report.refetch()} retrying={report.isRefetching} />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty icon={Receipt} title={VIEW_COPY[view].empty} description={VIEW_COPY[view].hint} />
        ) : (
          <>
            {/* Production carries no revenue — the trend strip only makes
                sense where net is real. */}
            {view !== "production" && byDay.length >= 2 && (
              <ChartBlock title="Net Revenue by Day">
                <PeriodColumns data={byDay} name="Net revenue" height={160} />
              </ChartBlock>
            )}
            {rows.length === 0 ? (
              <TableEmpty icon={Receipt} title="No rows match the search" description="Try a different item or menu name." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead>Date</TableHead>
                    <TableHead>Item / Menu</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Disc.</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="tnum">{row.saleDate}</TableCell>
                      <TableCell className="max-w-[22rem] break-words font-medium">
                        {row.name}
                        {row.kind === "menu" && (
                          <Badge variant="secondary" className="ml-2">
                            Menu
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.category ?? "—"}</TableCell>
                      <TableCell className="tnum text-right">{n2(row.qty)}</TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.unitPrice)}</TableCell>
                      <TableCell className="tnum text-right">{row.discountPct ? `${row.discountPct}%` : "—"}</TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.gross)}</TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.net)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {/* Totals always reflect the full range, not the search subset. */}
                {query.trim() === "" && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3} className="font-medium">
                        Total
                      </TableCell>
                      <TableCell className="tnum text-right font-medium">{n2(report.data.totals.qty)}</TableCell>
                      <TableCell />
                      <TableCell className="tnum text-right font-medium">
                        {report.data.totals.discount > 0 ? `−${formatMoney(report.data.totals.discount)}` : "—"}
                      </TableCell>
                      <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.gross)}</TableCell>
                      <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.net)}</TableCell>
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
