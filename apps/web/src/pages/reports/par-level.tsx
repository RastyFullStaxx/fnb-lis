import { useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { exportUrl, useParLevelReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, TableError, ToolbarSearch } from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
import { ChartBlock } from "@/components/charts/chart-block";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

const n2 = (v: number) => round2(v).toLocaleString("en-US", { maximumFractionDigits: 2 });

const REORDER_BAR_CAP = 8;

/**
 * Par Level report (client req 2026-07-21) — a purchasing guide. Shows every
 * item with a reorder point: current stock vs par, how much it moved last
 * period, and a suggested order quantity. Items below par lead the list.
 */
export function ParLevelReportPage() {
  const locationId = useLocationId();
  const report = useParLevelReport();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const all = report.data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return q
      ? all.filter((r) => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
      : all;
  }, [report.data, query]);

  // What to buy: the biggest suggested orders by value.
  const reorderBars = useMemo(() => {
    return (report.data?.rows ?? [])
      .filter((r) => r.suggestedOrder > 0)
      .slice(0, REORDER_BAR_CAP)
      .map((r) => ({ label: r.name, value: round2(r.orderValue) }));
  }, [report.data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Par Level"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "par-level", "xlsx")}
            csvUrl={exportUrl(locationId, "par-level", "csv")}
            pdfUrl={exportUrl(locationId, "par-level", "pdf")}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarSearch value={query} onChange={setQuery} placeholder="Find an item or category…" />
            {report.isPending ? (
              <div className="shrink-0 pb-2">
                <Skeleton className="h-4 w-56" />
              </div>
            ) : report.data && report.data.rows.length > 0 ? (
              <p className="shrink-0 pb-2 text-sm text-muted-foreground">
                Stock as of <span className="tnum font-medium text-foreground">{report.data.lastCountDate}</span>
                {report.data.periodBegin ? (
                  <>
                    {" · movement "}
                    <span className="tnum font-medium text-foreground">
                      {report.data.periodBegin} → {report.data.periodEnd}
                    </span>
                  </>
                ) : null}
              </p>
            ) : null}
          </>
        }
      >
        {report.isPending ? (
          <TableLoading />
        ) : report.isError ? (
          <TableError onRetry={() => void report.refetch()} retrying={report.isRefetching} />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty
            icon={ClipboardList}
            title="No par levels set"
            description="Set a par (reorder point) on your items — this report then shows what to buy, and how much, against recent movement."
          />
        ) : (
          <>
            {reorderBars.length >= 2 && query.trim() === "" && (
              <ChartBlock title="Suggested order by value" hint={`Top ${reorderBars.length} to restock`}>
                <MagnitudeBars data={reorderBars} name="Order value" />
              </ChartBlock>
            )}
            {rows.length === 0 ? (
              <TableEmpty icon={ClipboardList} title="No rows match the search" description="Try a different item or category name." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead>Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">On Hand</TableHead>
                    <TableHead className="text-right">Par</TableHead>
                    <TableHead className="text-right">Used (last period)</TableHead>
                    <TableHead className="text-right">Suggested Order</TableHead>
                    <TableHead className="text-right">Order Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.locationItemId} className={cn(row.belowPar && "bg-warning/5")}>
                      <TableCell className="max-w-[22rem] font-medium break-words">
                        {row.name}
                        {row.belowPar && (
                          <Badge variant="warning" className="ml-2">
                            Below par
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.category}</TableCell>
                      <TableCell className={cn("tnum text-right", row.belowPar && "text-warning-text")}>{n2(row.onHand)}</TableCell>
                      <TableCell className="tnum text-right text-muted-foreground">{n2(row.parLevel)}</TableCell>
                      <TableCell className="tnum text-right text-muted-foreground">{n2(row.usage)}</TableCell>
                      <TableCell className="tnum text-right font-medium">{row.suggestedOrder > 0 ? n2(row.suggestedOrder) : "—"}</TableCell>
                      <TableCell className="tnum text-right">{row.orderValue > 0 ? formatMoney(row.orderValue) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {query.trim() === "" && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={5} className="font-medium">
                        {report.data.totals.belowParCount} below par
                      </TableCell>
                      <TableCell className="text-right font-medium">Total to buy</TableCell>
                      <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.orderValue)}</TableCell>
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
