import { Wine } from "lucide-react";
import { round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useCountDates } from "@/api/ops";
import { exportUrl, useNonRevenueReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useReportRange } from "./use-report-range";

const n2 = (v: number) => round2(v).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function NonRevenueReportPage() {
  const locationId = useLocationId();
  const dates = useCountDates();
  const [from, to, setFrom, setTo] = useReportRange(dates.data?.dates);
  const report = useNonRevenueReport(from, to);

  return (
    <div>
      <PageHeader
        title="Non-Revenue Report"
        description="Comps, spillage, staff use and other non-sold consumption, grouped by reason. Inclusive date range."
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "non-revenue", "xlsx", { from, to })}
            csvUrl={exportUrl(locationId, "non-revenue", "csv", { from, to })}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <div className="mb-4">
        <DateRangeControl from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {report.isPending ? (
        <Skeleton className="h-80 w-full" />
      ) : !report.data || report.data.rows.length === 0 ? (
        <EmptyState icon={Wine} title="No non-revenue use in this range" description="Adjust the dates to find recorded entries." />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">By reason</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {report.data.byReason.map((g) => (
                  <div key={g.reason} className="rounded-lg border px-3 py-2">
                    <p className="text-sm font-medium">{g.reason}</p>
                    <p className="tnum text-xs text-muted-foreground">
                      {g.count} entr{g.count === 1 ? "y" : "ies"} · qty {n2(g.qty)}
                      {g.cost > 0 && ` · ${formatMoney(g.cost)}`}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead>Date</TableHead>
                  <TableHead>Item / Menu</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Content/unit</TableHead>
                  <TableHead className="text-right">Est. cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.rows.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="tnum">{row.saleDate}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.reason}</Badge>
                    </TableCell>
                    <TableCell className="tnum text-right">{n2(row.qty)}</TableCell>
                    <TableCell className="tnum text-right">{row.contentOverride ?? "—"}</TableCell>
                    <TableCell className="tnum text-right">
                      {row.estimatedCost === null ? "—" : formatMoney(row.estimatedCost)}
                    </TableCell>
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
          </div>
        </div>
      )}
    </div>
  );
}
