import { useMemo } from "react";
import { Wrench } from "lucide-react";
import { round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useCountDates } from "@/api/ops";
import { exportUrl, useAssetBreakageReport } from "@/api/reports";
import { formatMoney, formatNumber, formatDate } from "@/lib/utils";
import { useSort } from "@/hooks/use-sort";
import { PageHeader } from "@/components/page-header";
import { TableEmpty, TableFailure, TableLoading, TableSurface, queryFailed } from "@/components/table-surface";
import { DateRangeControl, ExportButtons } from "@/components/report-toolbar";
import { ChartBlock } from "@/components/charts/chart-block";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useReportRange } from "./use-report-range";


/**
 * Asset Breakage report (client req 2026-07-21) — the "usage" of equipment.
 * Assets aren't sold or consumed; they leave the register when they break, go
 * missing, or are retired. Each row is one such event, with the reason and
 * "what happened" note, valued at cost. Only populated on Asset-module
 * locations.
 */
export function AssetBreakageReportPage() {
  const locationId = useLocationId();
  const dates = useCountDates();
  const [from, to, setFrom, setTo] = useReportRange(dates.data?.dates);
  const report = useAssetBreakageReport(from, to);

  const reasonBars = useMemo(
    () =>
      (report.data?.byReason ?? [])
        .filter((g) => g.costValue > 0)
        .map((g) => ({ label: g.reason, value: round2(g.costValue) })),
    [report.data],
  );

  const { sortedRows, sortKey, sortDirection, toggleSort } = useSort(report.data?.rows ?? [], {
    accessors: {
      date: (r) => r.date,
      item: (r) => r.name,
      reason: (r) => r.reason,
      note: (r) => r.note ?? "",
      qty: (r) => r.qty,
      value: (r) => r.costValue,
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Asset Breakage"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "asset-breakage", "xlsx", { from, to })}
            csvUrl={exportUrl(locationId, "asset-breakage", "csv", { from, to })}
            pdfUrl={exportUrl(locationId, "asset-breakage", "pdf", { from, to })}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <TableSurface
        filters={<DateRangeControl from={from} to={to} onFrom={setFrom} onTo={setTo} />}
      >
        {queryFailed(report) ? (
          <TableFailure query={report} />
        ) : report.isPending ? (
          <TableLoading />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty
            icon={Wrench}
            title="No asset breakage in this range"
            description="Broken, missing, or retired equipment appears here, recorded as non-revenue. (Asset-module locations only.)"
          />
        ) : (
          <>
            {reasonBars.length >= 2 && (
              <ChartBlock title="Loss by reason (cost)" hint={`${reasonBars.length} reasons`}>
                <MagnitudeBars data={reasonBars} name="Value lost" />
              </ChartBlock>
            )}
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <SortableTableHead sortKey="date" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                    Date
                  </SortableTableHead>
                  <SortableTableHead sortKey="item" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                    Item
                  </SortableTableHead>
                  <SortableTableHead sortKey="reason" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                    Reason
                  </SortableTableHead>
                  <SortableTableHead sortKey="note" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                    What Happened
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="qty"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={toggleSort}
                    className="text-right"
                  >
                    Qty
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="value"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={toggleSort}
                    className="text-right"
                  >
                    Value
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="tnum">{formatDate(row.date)}</TableCell>
                    <TableCell className="max-w-[16rem] font-medium break-words">
                      {row.name}
                      <span className="text-muted-foreground"> · {row.uom}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.reason}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[22rem] break-words text-muted-foreground">{row.note || "—"}</TableCell>
                    <TableCell className="tnum text-right">{formatNumber(row.qty)}</TableCell>
                    <TableCell className="tnum text-right">{formatMoney(row.costValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="font-medium">
                    Total written off
                  </TableCell>
                  <TableCell className="tnum text-right font-medium">{formatNumber(report.data.totals.qty)}</TableCell>
                  <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.costValue)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </>
        )}
      </TableSurface>
    </div>
  );
}
