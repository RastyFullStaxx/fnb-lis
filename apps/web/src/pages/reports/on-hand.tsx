import { useMemo, useState } from "react";
import { Boxes } from "lucide-react";
import { round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { exportUrl, useOnHandReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, TableError, ToolbarSearch } from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

const CATEGORY_BAR_CAP = 6;

export function OnHandReportPage() {
  const locationId = useLocationId();
  const report = useOnHandReport();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const all = report.data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return q
      ? all.filter((r) => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
      : all;
  }, [report.data, query]);

  // Where the money sits: cost valuation by category, long tail folded.
  const categoryBars = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const row of report.data?.rows ?? []) {
      byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.costValue);
    }
    const sorted = [...byCategory.entries()]
      .map(([label, value]) => ({ label, value: round2(value) }))
      .sort((a, b) => b.value - a.value);
    const head = sorted.slice(0, CATEGORY_BAR_CAP);
    const tail = sorted.slice(CATEGORY_BAR_CAP);
    if (tail.length > 0) {
      head.push({ label: `Other (${tail.length})`, value: round2(tail.reduce((n, c) => n + c.value, 0)) });
    }
    return head;
  }, [report.data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Inventory on Hand"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "on-hand", "xlsx")}
            csvUrl={exportUrl(locationId, "on-hand", "csv")}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarSearch value={query} onChange={setQuery} placeholder="Find an item or category…" className="w-56" />
            {report.isPending ? (
              <Skeleton className="h-4 w-44" />
            ) : report.data && report.data.rows.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                As of last count <span className="tnum font-medium text-foreground">{report.data.lastCountDate}</span>
              </p>
            ) : null}
          </>
        }
      >
        {report.isPending ? (
          <TableLoading />
        ) : report.isError ? (
          <TableError onRetry={() => void report.refetch()} retrying={report.isRefetching} />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty
            icon={Boxes}
            title="No committed count yet"
            description="On-hand stock is derived from the last committed count. Commit a count to populate this report."
          />
        ) : (
          <>
            {categoryBars.length >= 2 && query.trim() === "" && (
              <div className="border-b bg-muted/20 px-4 py-3 print:hidden">
                <p className="text-xs font-medium text-muted-foreground">Stock value by category (cost)</p>
                <div className="mt-2">
                  <MagnitudeBars data={categoryBars} name="Cost value" />
                </div>
              </div>
            )}
            {rows.length === 0 ? (
              <TableEmpty icon={Boxes} title="No rows match the search" description="Try a different item or category name." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead>Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">On Hand</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Retail</TableHead>
                    <TableHead className="text-right">Cost Value</TableHead>
                    <TableHead className="text-right">Retail Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.locationItemId} className={cn(row.belowPar && "bg-warning/5")}>
                      <TableCell className="font-medium">
                        {row.name}
                        {row.belowPar && (
                          <Badge variant="outline" className="ml-2 border-warning-text/40 text-warning-text">
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
                {query.trim() === "" && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={5} className="font-medium">
                        Total valuation
                      </TableCell>
                      <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.costValue)}</TableCell>
                      <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.retailValue)}</TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            )}
          </>
        )}
      </TableSurface>
    </div>
  );
}
