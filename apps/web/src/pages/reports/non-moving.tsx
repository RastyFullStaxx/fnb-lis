import { useMemo, useState } from "react";
import { PackageX } from "lucide-react";
import { round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { exportUrl, useNonMovingReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, TableError, ToolbarSearch } from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
import { ChartBlock } from "@/components/charts/chart-block";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
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

const n2 = (v: number) => round2(v).toLocaleString("en-US", { maximumFractionDigits: 2 });

const DEAD_BAR_CAP = 8;

/**
 * Non-Moving items report (client req 2026-07-21) — dead stock. Items still on
 * hand that saw no movement over the last closed period: cash tied up in stock
 * that isn't selling. Ranked by the value sitting idle.
 */
export function NonMovingReportPage() {
  const locationId = useLocationId();
  const report = useNonMovingReport();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const all = report.data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return q
      ? all.filter((r) => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
      : all;
  }, [report.data, query]);

  // Where the idle cash sits: the biggest dead-stock lines by cost value.
  const deadBars = useMemo(() => {
    return (report.data?.rows ?? [])
      .slice(0, DEAD_BAR_CAP)
      .map((r) => ({ label: r.name, value: round2(r.costValue) }));
  }, [report.data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Non-Moving Items"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "non-moving", "xlsx")}
            csvUrl={exportUrl(locationId, "non-moving", "csv")}
            pdfUrl={exportUrl(locationId, "non-moving", "pdf")}
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
            ) : report.data && report.data.periodBegin ? (
              <p className="shrink-0 pb-2 text-sm text-muted-foreground">
                No movement{" "}
                <span className="tnum font-medium text-foreground">
                  {report.data.periodBegin} → {report.data.periodEnd}
                </span>
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
            icon={PackageX}
            title="Nothing sitting idle"
            description="Every item on hand moved during the last closed period — no dead stock to flag. (Needs at least one closed audit period to judge movement.)"
          />
        ) : (
          <>
            {deadBars.length >= 2 && query.trim() === "" && (
              <ChartBlock title="Idle stock value (cost)" hint={`Top ${deadBars.length} by value`}>
                <MagnitudeBars data={deadBars} name="Cost value" />
              </ChartBlock>
            )}
            {rows.length === 0 ? (
              <TableEmpty icon={PackageX} title="No rows match the search" description="Try a different item or category name." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead>Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">On Hand</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Cost Value</TableHead>
                    <TableHead className="text-right">Retail Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.locationItemId}>
                      <TableCell className="max-w-[22rem] font-medium break-words">{row.name}</TableCell>
                      <TableCell className="text-muted-foreground">{row.category}</TableCell>
                      <TableCell className="tnum text-right">{n2(row.onHand)}</TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.cost)}</TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.costValue)}</TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.retailValue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {query.trim() === "" && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={4} className="font-medium">
                        {report.data.totals.count} item{report.data.totals.count === 1 ? "" : "s"} not moving
                      </TableCell>
                      <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.costValue)}</TableCell>
                      <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.retailValue)}</TableCell>
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
