import { useMemo, useState } from "react";
import { GlassWater } from "lucide-react";
import { useCountDates } from "@/api/ops";
import { useLocationId } from "@/api/location";
import { exportUrl, useSalesByItemReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TableSurface, TableLoading, TableEmpty, TableError } from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
import { Label } from "@/components/ui/label";
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

/** Sales Report — Shot & Bottle (client report #7): per-item sales for an
    audit period, split into portion (shot) and full-unit (bottle) sales, with
    the cost of what was sold and the revenue it earned. */
export function SalesByItemReportPage() {
  const locationId = useLocationId();
  const countDates = useCountDates();
  const [begin, setBegin] = useState<string | undefined>(undefined);
  const [end, setEnd] = useState<string | undefined>(undefined);

  const dates = countDates.data?.dates ?? [];
  const effectiveBegin = begin ?? (dates.length >= 2 ? dates[dates.length - 2] : undefined);
  const endOptions = useMemo(() => dates.filter((d) => !effectiveBegin || d > effectiveBegin), [dates, effectiveBegin]);
  const effectiveEnd = end ?? endOptions.at(-1);
  const report = useSalesByItemReport(effectiveBegin, effectiveEnd);

  if (!countDates.isPending && dates.length < 2) {
    return (
      <div>
        <PageHeader title="Sales Report (Shot & Bottle)" />
        <EmptyState
          icon={GlassWater}
          title="Two committed counts unlock this report"
          description="Shot and bottle sales are reported per audit period, alongside the Full Audit."
        />
      </div>
    );
  }

  const exportParams = { begin: effectiveBegin ?? "", end: effectiveEnd ?? "" };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Sales Report (Shot & Bottle)"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "sales-by-item", "xlsx", exportParams)}
            csvUrl={exportUrl(locationId, "sales-by-item", "csv", exportParams)}
            pdfUrl={exportUrl(locationId, "sales-by-item", "pdf", exportParams)}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <TableSurface
        filters={
          <>
            <Label htmlFor="sbi-begin" className="text-xs text-muted-foreground">Beginning</Label>
            <Select value={effectiveBegin} onValueChange={(v) => { setBegin(v); if (effectiveEnd && effectiveEnd <= v) setEnd(undefined); }}>
              <SelectTrigger id="sbi-begin" className="tnum w-40 bg-background">
                <SelectValue placeholder="Pick a date" />
              </SelectTrigger>
              <SelectContent>
                {dates.map((d) => (
                  <SelectItem key={d} value={d} className="tnum">{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label htmlFor="sbi-end" className="text-xs text-muted-foreground">Ending</Label>
            <Select value={effectiveEnd} onValueChange={setEnd}>
              <SelectTrigger id="sbi-end" className="tnum w-40 bg-background">
                <SelectValue placeholder="Pick a date" />
              </SelectTrigger>
              <SelectContent>
                {endOptions.map((d) => (
                  <SelectItem key={d} value={d} className="tnum">{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Shot = recipe portions · Bottle = whole units.</p>
          </>
        }
      >
        {countDates.isPending || (report.isPending && effectiveBegin && effectiveEnd) ? (
          <TableLoading />
        ) : report.isError ? (
          <TableError onRetry={() => void report.refetch()} retrying={report.isRefetching} />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty
            icon={GlassWater}
            title="No sales in this period"
            description="Nothing was sold between these counts, or pick a different pair of dates."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Item</TableHead>
                <TableHead>UOM</TableHead>
                <TableHead className="text-right">Shot</TableHead>
                <TableHead className="text-right">Bottle</TableHead>
                <TableHead className="text-right">Total Qty</TableHead>
                <TableHead className="text-right">Cost of Sold</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.data.rows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">{row.uom}</TableCell>
                  <TableCell className="tnum text-right">{row.shot > 0 ? n2(row.shot) : "—"}</TableCell>
                  <TableCell className="tnum text-right">{row.bottle > 0 ? n2(row.bottle) : "—"}</TableCell>
                  <TableCell className="tnum text-right">{n2(row.qty)}</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(row.cost)}</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(row.retail)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-medium">
                  Grand Total
                </TableCell>
                <TableCell className="tnum text-right font-medium">{n2(report.data.totals.shot)}</TableCell>
                <TableCell className="tnum text-right font-medium">{n2(report.data.totals.bottle)}</TableCell>
                <TableCell className="tnum text-right font-medium">{n2(report.data.totals.qty)}</TableCell>
                <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.cost)}</TableCell>
                <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.retail)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </TableSurface>
    </div>
  );
}
