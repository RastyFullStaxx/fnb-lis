import { ShoppingCart } from "lucide-react";
import { round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useCountDates } from "@/api/ops";
import { exportUrl, usePurchaseReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty } from "@/components/table-surface";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useReportRange } from "./use-report-range";

const n2 = (v: number) => round2(v).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function PurchaseReportPage() {
  const locationId = useLocationId();
  const dates = useCountDates();
  const [from, to, setFrom, setTo] = useReportRange(dates.data?.dates);
  const report = usePurchaseReport(from, to);

  return (
    <div>
      <PageHeader title="Purchase Report" />

      <TableSurface
        filters={<DateRangeControl from={from} to={to} onFrom={setFrom} onTo={setTo} />}
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "purchases", "xlsx", { from, to })}
            csvUrl={exportUrl(locationId, "purchases", "csv", { from, to })}
            disabled={!report.data?.rows.length}
          />
        }
      >
        {report.isPending ? (
          <TableLoading />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty icon={ShoppingCart} title="No purchases in this range" description="Adjust the dates to find committed deliveries." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                <TableHead className="text-right">Line total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.data.rows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="tnum">{row.purchaseDate}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.supplier}
                    {row.refNo && <span className="ml-1.5 text-xs">({row.refNo})</span>}
                  </TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="tnum text-right">{n2(row.qty)}</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(row.unitCost)}</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(row.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-medium">
                  Total
                </TableCell>
                <TableCell className="tnum text-right font-medium">{n2(report.data.totals.qty)}</TableCell>
                <TableCell />
                <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.cost)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </TableSurface>

      {report.data && report.data.rows.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">By supplier</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.bySupplier.map((s) => (
                  <TableRow key={s.supplier}>
                    <TableCell className="font-medium">{s.supplier}</TableCell>
                    <TableCell className="tnum text-right">{n2(s.qty)}</TableCell>
                    <TableCell className="tnum text-right">{formatMoney(s.cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
