import { Undo2 } from "lucide-react";
import { useCountDates } from "@/api/ops";
import { useLocationId } from "@/api/location";
import { exportUrl, useForfeitsReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, TableError } from "@/components/table-surface";
import { DateRangeControl, ExportButtons } from "@/components/report-toolbar";
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

/** Forfeited Bottles Report (client report #5): returned bottles in a range,
    with the open content they carried valued at cost and retail. */
export function ForfeitsReportPage() {
  const locationId = useLocationId();
  const dates = useCountDates();
  const [from, to, setFrom, setTo] = useReportRange(dates.data?.dates);
  const report = useForfeitsReport(from, to);

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

      <TableSurface filters={<DateRangeControl from={from} to={to} onFrom={setFrom} onTo={setTo} />}>
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
        ) : (
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
              {report.data.rows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="tnum">{row.date}</TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">{row.uom}</TableCell>
                  <TableCell className="tnum text-right">{n2(row.qty)}</TableCell>
                  <TableCell className="tnum text-right">{n2(row.contentEquiv)}</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(row.costValue)}</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(row.retailValue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
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
          </Table>
        )}
      </TableSurface>
    </div>
  );
}
