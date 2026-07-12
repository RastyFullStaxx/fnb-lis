import { useState } from "react";
import { Receipt } from "lucide-react";
import { round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useCountDates } from "@/api/ops";
import { exportUrl, useSalesReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty } from "@/components/table-surface";
import { DateRangeControl, ExportButtons } from "@/components/report-toolbar";
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

export function SalesReportPage() {
  const locationId = useLocationId();
  const dates = useCountDates();
  const [from, to, setFrom, setTo] = useReportRange(dates.data?.dates);
  const report = useSalesReport(from, to);

  return (
    <div>
      <PageHeader title="Sales Report" />

      <TableSurface
        filters={<DateRangeControl from={from} to={to} onFrom={setFrom} onTo={setTo} />}
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "sales", "xlsx", { from, to })}
            csvUrl={exportUrl(locationId, "sales", "csv", { from, to })}
            disabled={!report.data?.rows.length}
          />
        }
      >
        {report.isPending ? (
          <TableLoading />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty icon={Receipt} title="No sales in this range" description="Adjust the dates to find recorded sales." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Date</TableHead>
                <TableHead>Item / Menu</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Disc.</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.data.rows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="tnum">{row.saleDate}</TableCell>
                  <TableCell className="font-medium">
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
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-medium">
                  Total
                </TableCell>
                <TableCell className="tnum text-right font-medium">{n2(report.data.totals.qty)}</TableCell>
                <TableCell colSpan={2} />
                <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.gross)}</TableCell>
                <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.net)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </TableSurface>
    </div>
  );
}
