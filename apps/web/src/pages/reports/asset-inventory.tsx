import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { round2 } from "@fnb/core";
import { useCountDates } from "@/api/ops";
import { useLocationId } from "@/api/location";
import { exportUrl, useAssetInventoryReport } from "@/api/reports";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TableSurface, TableLoading, TableEmpty, TableError, ToolbarField } from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
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
import { cn } from "@/lib/utils";

const n2 = (v: number) => round2(v).toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * Asset Inventory (Phase 6.2/6.4) — Beginning/Ending count for Asset rows.
 * Two independent committed-count-date pickers rather than cost-snapshot's
 * single anchor + Beginning/Ending tab, since this report shows both sides
 * at once in one table (qty in, qty out, the change) rather than switching
 * views. Same `useCountDates` source as every other count-anchored report.
 */
export function AssetInventoryReportPage() {
  const locationId = useLocationId();
  const countDates = useCountDates();
  const dates = countDates.data?.dates ?? [];

  const [beginningOverride, setBeginningOverride] = useState<string | undefined>(undefined);
  const [endingOverride, setEndingOverride] = useState<string | undefined>(undefined);

  const beginningDate = beginningOverride ?? dates.at(-2) ?? dates.at(0);
  const endingDate = endingOverride ?? dates.at(-1);

  const report = useAssetInventoryReport(beginningDate, endingDate);
  const exportParams = { beginningDate: beginningDate ?? "", endingDate: endingDate ?? "" };

  if (!countDates.isPending && dates.length === 0) {
    return (
      <div>
        <PageHeader title="Asset Inventory" />
        <EmptyState
          icon={ClipboardList}
          title="A committed count unlocks this report"
          description="Asset Inventory compares two committed count dates. Run a Beginning and an Ending count first."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Asset Inventory"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "asset-inventory", "xlsx", exportParams)}
            csvUrl={exportUrl(locationId, "asset-inventory", "csv", exportParams)}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarField label="Beginning" htmlFor="ai-begin">
              <Select value={beginningDate} onValueChange={setBeginningOverride}>
                <SelectTrigger id="ai-begin" className="tnum w-40 bg-background">
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
            </ToolbarField>
            <ToolbarField label="Ending" htmlFor="ai-end">
              <Select value={endingDate} onValueChange={setEndingOverride}>
                <SelectTrigger id="ai-end" className="tnum w-40 bg-background">
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
            </ToolbarField>
          </>
        }
      >
        {countDates.isPending || report.isPending ? (
          <TableLoading />
        ) : report.isError ? (
          <TableError onRetry={() => void report.refetch()} retrying={report.isRefetching} />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty
            icon={ClipboardList}
            title="No asset counts on these dates"
            description="Pick two committed count dates that include an Asset count."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Asset Code</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>UOM</TableHead>
                <TableHead className="text-right">Beginning</TableHead>
                <TableHead className="text-right">Ending</TableHead>
                <TableHead className="text-right">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.data.rows.map((row) => (
                <TableRow key={row.locationItemId}>
                  <TableCell className="tnum font-medium">{row.assetCode ?? "—"}</TableCell>
                  <TableCell className="max-w-[18rem] break-words">{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">{row.category}</TableCell>
                  <TableCell className="text-muted-foreground">{row.industry ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{row.uom}</TableCell>
                  <TableCell className="tnum text-right">{n2(row.beginningQty)}</TableCell>
                  <TableCell className="tnum text-right">{n2(row.endingQty)}</TableCell>
                  <TableCell className={cn("tnum text-right", row.change < 0 && "text-destructive")}>
                    {row.change > 0 ? "+" : ""}
                    {n2(row.change)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={5} className="font-medium">
                  Total
                </TableCell>
                <TableCell className="tnum text-right font-medium">{n2(report.data.totals.beginningQty)}</TableCell>
                <TableCell className="tnum text-right font-medium">{n2(report.data.totals.endingQty)}</TableCell>
                <TableCell className={cn("tnum text-right font-semibold", report.data.totals.change < 0 && "text-destructive")}>
                  {report.data.totals.change > 0 ? "+" : ""}
                  {n2(report.data.totals.change)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </TableSurface>
    </div>
  );
}
