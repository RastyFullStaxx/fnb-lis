import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Coins } from "lucide-react";
import { round2 } from "@fnb/core";
import { useCountDates } from "@/api/ops";
import { useLocationId } from "@/api/location";
import { exportUrl, useCostSnapshotReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import {
  TableSurface,
  TableLoading,
  TableEmpty,
  TableError,
  ToolbarField,
  ToolbarSearch,
} from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
import { ChartBlock } from "@/components/charts/chart-block";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
import { Badge } from "@/components/ui/badge";
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
  const [query, setQuery] = useState("");

  const dates = countDates.data?.dates ?? [];
  const defaultAnchor = side === "begin" ? dates.at(-2) ?? dates.at(-1) : dates.at(-1);
  const anchor = anchorOverride ?? defaultAnchor;
  const report = useCostSnapshotReport(anchor);
  const sideLabel = side === "begin" ? "Beginning" : "Ending";

  const rows = useMemo(() => {
    const all = report.data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all;
  }, [report.data, query]);

  // Where the stock value actually sits — a long count usually hides the fact
  // that a handful of items carry most of it. Ranked off the full payload, so
  // the strip keeps naming the real top items while a search narrows the table.
  const bars = useMemo(() => {
    const all = report.data?.rows ?? [];
    return [...all]
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 8)
      .map((r) => ({ label: r.name, value: round2(r.value) }));
  }, [report.data]);

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

      {/* Policy, not a control — it belongs next to the title rather than in the
          toolbar, where its sentence pushed the actual controls onto a second row. */}
      <p className="-mt-2 mb-3 text-xs text-muted-foreground print:hidden">
        {report.data?.costBasis === "AVERAGE"
          ? "Cost basis: weighted average — (opening stock + purchases) ÷ total units."
          : "Cost basis: purchase price — the cost recorded on the count line."}{" "}
        <Link to={`/l/${locationId}/settings`} className="underline underline-offset-2">
          Change in Settings
        </Link>
      </p>

      <TableSurface
        filters={
          <>
            <ToolbarField label="Show">
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
            </ToolbarField>
            <ToolbarSearch label="Search" value={query} onChange={setQuery} placeholder="Find an item…" />
            <ToolbarField label="Count Date" htmlFor="cs-anchor">
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
            </ToolbarField>
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
          <>
            {bars.length >= 2 && (
              <ChartBlock
                title="Stock Value by Item"
                hint={`Top ${bars.length} of ${report.data.rows.length} items · ${formatMoney(report.data.totals.value)} total`}
              >
                <MagnitudeBars data={bars} name="Stock value" />
              </ChartBlock>
            )}
            {rows.length === 0 ? (
              <TableEmpty
                icon={Coins}
                title="No rows match the search"
                description="Try a different item name."
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
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="max-w-[22rem] font-medium break-words">{row.name}</TableCell>
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
                {/* Totals always reflect the whole count, not the search subset. */}
                {query.trim() === "" && (
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
                )}
              </Table>
            )}
          </>
        )}
      </TableSurface>
    </div>
  );
}
