import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Coins } from "lucide-react";
import { useCountDates } from "@/api/ops";
import { useLocationId } from "@/api/location";
import { exportUrl, useCostSnapshotReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TableSurface, TableLoading, TableEmpty, TableError } from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const n2 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * Beginning / Ending Cost Reports (client reports #3 / #4): the counted stock
 * on one audit anchor date, valued at the weighted average of purchases to
 * date (cost price where an item has no purchase history). The two reports
 * are the same table anchored to different count dates — the tab picks the
 * side and seeds its natural anchor.
 */
export function CostSnapshotPage() {
  const locationId = useLocationId();
  const countDates = useCountDates();
  const [params] = useSearchParams();
  const [side, setSide] = useState<"begin" | "end">(params.get("side") === "end" ? "end" : "begin");
  const [anchorOverride, setAnchorOverride] = useState<string | undefined>(undefined);

  const dates = countDates.data?.dates ?? [];
  const defaultAnchor = side === "begin" ? dates.at(-2) ?? dates.at(-1) : dates.at(-1);
  const anchor = anchorOverride ?? defaultAnchor;
  const report = useCostSnapshotReport(anchor);
  const sideLabel = side === "begin" ? "Beginning" : "Ending";

  if (!countDates.isPending && dates.length === 0) {
    return (
      <div>
        <PageHeader title="Beginning / Ending Cost" />
        <EmptyState
          icon={Coins}
          title="A committed count unlocks this report"
          description="Cost snapshots value the stock counted on an audit date. Commit a count first."
        />
      </div>
    );
  }

  const exportParams = { anchor: anchor ?? "", side: side === "begin" ? "beginning" : "ending" };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={`${sideLabel} Cost Report`}
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "cost-snapshot", "xlsx", exportParams)}
            csvUrl={exportUrl(locationId, "cost-snapshot", "csv", exportParams)}
            pdfUrl={exportUrl(locationId, "cost-snapshot", "pdf", exportParams)}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <TableSurface
        filters={
          <>
            <Tabs
              value={side}
              onValueChange={(v) => {
                setSide(v as "begin" | "end");
                setAnchorOverride(undefined); // re-seed the natural anchor
              }}
            >
              <TabsList>
                <TabsTrigger value="begin">Beginning</TabsTrigger>
                <TabsTrigger value="end">Ending</TabsTrigger>
              </TabsList>
            </Tabs>
            <Label htmlFor="cs-anchor" className="text-xs text-muted-foreground">Count Date</Label>
            <Select value={anchor} onValueChange={setAnchorOverride}>
              <SelectTrigger id="cs-anchor" className="tnum w-40 bg-background">
                <SelectValue placeholder="Pick a date" />
              </SelectTrigger>
              <SelectContent>
                {dates.map((d) => (
                  <SelectItem key={d} value={d} className="tnum">
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {report.data?.costBasis === "AVERAGE"
                ? "Cost basis: weighted average — (opening stock + purchases) ÷ total units."
                : "Cost basis: purchase price — the cost recorded on the count line."}{" "}
              <Link to={`/l/${locationId}/settings`} className="underline underline-offset-2">
                Change in Settings
              </Link>
            </p>
          </>
        }
      >
        {countDates.isPending || (report.isPending && anchor) ? (
          <TableLoading />
        ) : report.isError ? (
          <TableError onRetry={() => void report.refetch()} retrying={report.isRefetching} />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty
            icon={Coins}
            title="No counted stock on this date"
            description="Pick a different committed count date."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Item</TableHead>
                <TableHead>UOM</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Cost Price</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Cost Basis</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.data.rows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">{row.uom}</TableCell>
                  <TableCell className="tnum text-right">{n2(row.qty)}</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(row.cost)}</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(row.value)}</TableCell>
                  <TableCell>
                    <Badge variant={row.basis === "average" ? "secondary" : "outline"}>
                      {row.basis === "average" ? "Avg Purchase" : "Cost Price"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-medium">
                  Grand Total
                </TableCell>
                <TableCell className="tnum text-right font-medium">{n2(report.data.totals.qty)}</TableCell>
                <TableCell />
                <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.value)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </TableSurface>
    </div>
  );
}
