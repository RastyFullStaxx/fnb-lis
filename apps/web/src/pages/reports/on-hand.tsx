import { Boxes } from "lucide-react";
import { round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { exportUrl, useOnHandReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ExportButtons } from "@/components/report-toolbar";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const n2 = (v: number) => round2(v).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function OnHandReportPage() {
  const locationId = useLocationId();
  const report = useOnHandReport();

  return (
    <div>
      <PageHeader
        title="Inventory on Hand"
        description="Computed stock as of the last committed count plus everything recorded since, valued at cost and retail."
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "on-hand", "xlsx")}
            csvUrl={exportUrl(locationId, "on-hand", "csv")}
            disabled={!report.data?.rows.length}
          />
        }
      />

      {report.isPending ? (
        <Skeleton className="h-80 w-full" />
      ) : !report.data || report.data.rows.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No committed count yet"
          description="On-hand stock is derived from the last committed count. Commit a count to populate this report."
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            As of last count <span className="tnum font-medium">{report.data.lastCountDate}</span>
          </p>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Retail</TableHead>
                  <TableHead className="text-right">Cost value</TableHead>
                  <TableHead className="text-right">Retail value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.rows.map((row) => (
                  <TableRow key={row.locationItemId} className={cn(row.belowPar && "bg-warning/5")}>
                    <TableCell className="font-medium">
                      {row.name}
                      {row.belowPar && (
                        <Badge variant="outline" className="ml-2 border-warning text-warning">
                          below par
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.category}</TableCell>
                    <TableCell className={cn("tnum text-right", row.onHand < 0 && "text-destructive")}>
                      {n2(row.onHand)}
                    </TableCell>
                    <TableCell className="tnum text-right">{formatMoney(row.cost)}</TableCell>
                    <TableCell className="tnum text-right">{formatMoney(row.retail)}</TableCell>
                    <TableCell className="tnum text-right">{formatMoney(row.costValue)}</TableCell>
                    <TableCell className="tnum text-right">{formatMoney(row.retailValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5} className="font-medium">
                    Total valuation
                  </TableCell>
                  <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.costValue)}</TableCell>
                  <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.retailValue)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
