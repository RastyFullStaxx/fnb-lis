import { useMemo } from "react";
import { Wrench } from "lucide-react";
import { round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useCountDates } from "@/api/ops";
import { exportUrl, useAssetBreakageReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, TableError } from "@/components/table-surface";
import { DateRangeControl, ExportButtons } from "@/components/report-toolbar";
import { ChartBlock } from "@/components/charts/chart-block";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
import { Badge } from "@/components/ui/badge";
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

  return (
    <div>
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
        className="max-h-[70vh]"
        filters={<DateRangeControl from={from} to={to} onFrom={setFrom} onTo={setTo} />}
      >
        {report.isPending ? (
          <TableLoading />
        ) : report.isError ? (
          <TableError onRetry={() => void report.refetch()} retrying={report.isRefetching} />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty
            icon={Wrench}
            title="No asset breakage in this range"
            description="Equipment that broke, went missing, or was retired appears here — recorded as non-revenue on an asset item. (Only shows on locations that have the Asset module.)"
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
                  <TableHead>Date</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>What Happened</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.rows.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="tnum">{row.date}</TableCell>
                    <TableCell className="max-w-[16rem] font-medium break-words">
                      {row.name}
                      <span className="text-muted-foreground"> · {row.uom}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.reason}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[22rem] break-words text-muted-foreground">{row.note || "—"}</TableCell>
                    <TableCell className="tnum text-right">{n2(row.qty)}</TableCell>
                    <TableCell className="tnum text-right">{formatMoney(row.costValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="font-medium">
                    Total written off
                  </TableCell>
                  <TableCell className="tnum text-right font-medium">{n2(report.data.totals.qty)}</TableCell>
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
