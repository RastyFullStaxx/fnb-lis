import { useMemo, useState } from "react";
import { Info, PieChart } from "lucide-react";
import { canViewVariance, round2 } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useCountDates } from "@/api/ops";
import { useLocationId } from "@/api/location";
import { exportUrl, useCostAnalysisReport } from "@/api/reports";
import { cn, formatMoney, formatDate } from "@/lib/utils";
import { useSort } from "@/hooks/use-sort";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TableFailure, TableLoading, TableSurface, ToolbarField, queryFailed } from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
import { ChartBlock } from "@/components/charts/chart-block";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
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
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { Skeleton } from "@/components/ui/skeleton";

const pct = (v: number | null) => (v === null ? "—" : `${round2(v).toFixed(2)}%`);
const pctShort = (v: number) => `${round2(v).toFixed(1)}%`;

type CostAnalysisRow = ReturnType<typeof useCostAnalysisReport>["data"] extends { sections: (infer S)[] } | undefined
  ? S extends { rows: (infer R)[] }
    ? R
    : never
  : never;

/** One section's category table — its own component so each product-type
    section (Beverage, Food, …) gets an independent useSort instance; the
    parent maps over an unknown number of sections, and useSort can't be
    called inside that loop. */
function CostAnalysisSectionTable({ rows }: { rows: CostAnalysisRow[] }) {
  const { sortedRows, sortKey, sortDirection, toggleSort } = useSort(rows, {
    accessors: {
      category: (r) => r.category,
      beginning: (r) => r.beginningCost,
      purchases: (r) => r.purchasesCost,
      transfers: (r) => r.transfersCost,
      ending: (r) => r.endingCost,
      cost: (r) => r.cost,
      costNet: (r) => r.costNet,
      costPct: (r) => r.grossPct ?? -Infinity,
    },
  });

  return (
    <>
      <TableHeader>
        <TableRow className="bg-muted hover:bg-muted">
          <SortableTableHead sortKey="category" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
            Category
          </SortableTableHead>
          <SortableTableHead
            sortKey="beginning"
            activeKey={sortKey}
            direction={sortDirection}
            onSort={toggleSort}
            className="text-right"
          >
            Beginning
          </SortableTableHead>
          <SortableTableHead
            sortKey="purchases"
            activeKey={sortKey}
            direction={sortDirection}
            onSort={toggleSort}
            className="text-right"
          >
            Purchases
          </SortableTableHead>
          <SortableTableHead
            sortKey="transfers"
            activeKey={sortKey}
            direction={sortDirection}
            onSort={toggleSort}
            className="text-right"
          >
            Transfers
          </SortableTableHead>
          <SortableTableHead
            sortKey="ending"
            activeKey={sortKey}
            direction={sortDirection}
            onSort={toggleSort}
            className="text-right"
          >
            Ending
          </SortableTableHead>
          <SortableTableHead
            sortKey="cost"
            activeKey={sortKey}
            direction={sortDirection}
            onSort={toggleSort}
            className="text-right font-semibold"
          >
            Cost
          </SortableTableHead>
          <SortableTableHead
            sortKey="costNet"
            activeKey={sortKey}
            direction={sortDirection}
            onSort={toggleSort}
            className="text-right"
          >
            Cost Net
          </SortableTableHead>
          {/* One column, not two. netPct is costNet/netSales and grossPct is
              cost/grossSales — both sides divided by the same 1.12, so the two
              were identical in every row by construction. A cost RATIO is
              VAT-neutral; showing it twice invited the reader to hunt for a
              difference that cannot exist. The peso Gross/Net Profit figures
              elsewhere do differ, and both are still shown. */}
          <SortableTableHead
            sortKey="costPct"
            activeKey={sortKey}
            direction={sortDirection}
            onSort={toggleSort}
            className="text-right"
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-help items-center gap-1">
                    Cost % <Info className="size-3.5 text-muted-foreground" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Cost of goods as a share of sales. Same figure whether measured
                  VAT-inclusive or net of VAT.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </SortableTableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedRows.map((row) => (
          <TableRow key={row.category}>
            <TableCell className="max-w-[22rem] font-medium break-words">{row.category}</TableCell>
            <TableCell className="tnum text-right">{formatMoney(round2(row.beginningCost))}</TableCell>
            <TableCell className="tnum text-right">{formatMoney(round2(row.purchasesCost))}</TableCell>
            <TableCell className="tnum text-right">
              {row.transfersCost === 0 ? "—" : formatMoney(round2(row.transfersCost))}
            </TableCell>
            <TableCell className="tnum text-right">{formatMoney(round2(row.endingCost))}</TableCell>
            <TableCell className="tnum text-right font-medium">{formatMoney(round2(row.cost))}</TableCell>
            <TableCell className="tnum text-right">{formatMoney(round2(row.costNet))}</TableCell>
            <TableCell className="tnum text-right">{pct(row.grossPct)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </>
  );
}

// Past eight bars the ranking stops being scannable and the table below is the
// better instrument — the cut is disclosed in the chart's hint.
const TOP_CATEGORIES = 8;

export function CostAnalysisPage() {
  const locationId = useLocationId();
  const countDates = useCountDates();
  const me = useMe();
  // Cost Analysis stays visible to every STAFF account (hide-variance-from-
  // staff-plan.md: no variance column, no Usage/Sold column, so it can't be
  // used to back-solve a fake count) — only its one tooltip that NAMES
  // variance gets reworded for a blocked STAFF viewer (Phase 2.3/4.3).
  const varianceBlocked = me.data ? me.data.user.role === "STAFF" && !canViewVariance(me.data.user) : false;
  const [begin, setBegin] = useState<string | undefined>(undefined);
  const [end, setEnd] = useState<string | undefined>(undefined);

  const dates = countDates.data?.dates ?? [];
  const effectiveBegin = begin ?? (dates.length >= 2 ? dates[dates.length - 2] : undefined);
  const endOptions = useMemo(() => dates.filter((d) => !effectiveBegin || d > effectiveBegin), [dates, effectiveBegin]);
  // Fall back to the latest count date AFTER the beginning — picking the
  // newest date as "Beginning" must not silently fire a begin==end request.
  const effectiveEnd = end ?? endOptions.at(-1);

  const report = useCostAnalysisReport(effectiveBegin, effectiveEnd);

  // Chart data is derived from the same payload the tables render — nothing is
  // fetched for it. Bars rank descending because a magnitude chart is read as a
  // ranking; the table keeps the report's own row order.
  const sections = useMemo(
    () =>
      (report.data?.sections ?? []).map((section) => {
        const ranked = section.rows
          .filter((row) => row.netPct !== null && row.netPct > 0)
          .map((row) => ({ label: row.category, value: round2(row.netPct!) }))
          .sort((a, b) => b.value - a.value);
        return { section, bars: ranked.slice(0, TOP_CATEGORIES), rankedCount: ranked.length };
      }),
    [report.data],
  );

  const { sortedRows: sortedSalesByType, sortKey: salesSortKey, sortDirection: salesSortDirection, toggleSort: toggleSalesSort } = useSort(
    report.data?.sales.byType ?? [],
    {
      accessors: {
        sales: (t) => t.productType,
        gross: (t) => t.gross,
        net: (t) => t.net,
      },
    },
  );

  if (countDates.isPending) {
    return (
      <div>
        <PageHeader title="Cost Analysis" />
        <div className="overflow-hidden rounded-lg border">
          {/* Mirrors the real toolbar's stacked caption + control, so the surface
              doesn't jump taller the moment the dates land. */}
          <div className="flex flex-wrap items-end gap-x-3 gap-y-2 border-b bg-muted/30 px-3 py-2.5">
            {[0, 1].map((i) => (
              <div key={i} className="flex flex-col gap-1">
                <Skeleton className="h-[11px] w-16" />
                <Skeleton className="h-9 w-40" />
              </div>
            ))}
          </div>
          <TableLoading rows={6} />
        </div>
      </div>
    );
  }

  if (dates.length < 2) {
    return (
      <div>
        <PageHeader title="Cost Analysis" />
        <EmptyState
          icon={PieChart}
          title="Two committed counts unlock this report"
          description="Cost Analysis reads beginning and ending inventory cost from committed counts, plus the purchases between them."
        />
      </div>
    );
  }

  const periodPicker = (
    <>
      <ToolbarField label="Beginning" htmlFor="ca-begin">
        <Select value={effectiveBegin} onValueChange={(v) => { setBegin(v); if (effectiveEnd && effectiveEnd <= v) setEnd(undefined); }}>
          <SelectTrigger id="ca-begin" className="tnum w-40 bg-background">
            <SelectValue placeholder="Pick a date" />
          </SelectTrigger>
          <SelectContent>
            {dates.map((d) => (
              <SelectItem key={d} value={d} className="tnum">{formatDate(d)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ToolbarField>
      <ToolbarField label="Ending" htmlFor="ca-end">
        <Select value={effectiveEnd} onValueChange={setEnd}>
          <SelectTrigger id="ca-end" className="tnum w-40 bg-background">
            <SelectValue placeholder="Pick a date" />
          </SelectTrigger>
          <SelectContent>
            {endOptions.map((d) => (
              <SelectItem key={d} value={d} className="tnum">{formatDate(d)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ToolbarField>
    </>
  );

  return (
    <div>
      <PageHeader
        title="Cost Analysis"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "cost-analysis", "xlsx", { begin: effectiveBegin ?? "", end: effectiveEnd ?? "" })}
            csvUrl={exportUrl(locationId, "cost-analysis", "csv", { begin: effectiveBegin ?? "", end: effectiveEnd ?? "" })}
            disabled={!report.data?.sections.length}
          />
        }
      />

      {/* One surface: the period picker is fused to the sales summary, never a
          strip floating in the gap (DESIGN.md page skeleton). */}
      <TableSurface filters={periodPicker}>
        {!effectiveBegin || !effectiveEnd ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            Pick a beginning count and a later ending count to run the analysis.
          </p>
        ) : queryFailed(report) ? (
          <TableFailure query={report} />
        ) : report.isPending ? (
          <TableLoading rows={5} />
        ) : !report.data ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            Couldn't build the report for this period; pick different count dates.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <SortableTableHead sortKey="sales" activeKey={salesSortKey} direction={salesSortDirection} onSort={toggleSalesSort}>
                  Sales
                </SortableTableHead>
                <SortableTableHead
                  sortKey="gross"
                  activeKey={salesSortKey}
                  direction={salesSortDirection}
                  onSort={toggleSalesSort}
                  className="text-right"
                >
                  Gross
                </SortableTableHead>
                <SortableTableHead
                  sortKey="net"
                  activeKey={salesSortKey}
                  direction={salesSortDirection}
                  onSort={toggleSalesSort}
                  className="text-right"
                >
                  Net (÷1.12)
                </SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedSalesByType.map((t) => (
                <TableRow key={t.productType}>
                  <TableCell>{t.productType} gross sales</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(round2(t.gross))}</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(round2(t.net))}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="text-muted-foreground">VAT amount (gross − net)</TableCell>
                <TableCell className="tnum text-right text-muted-foreground">
                  {formatMoney(round2(report.data.sales.vatAmount))}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">Total Sales</TableCell>
                <TableCell className="tnum text-right font-semibold">
                  {formatMoney(round2(report.data.sales.totalGross))}
                </TableCell>
                <TableCell className="tnum text-right font-semibold">
                  {formatMoney(round2(report.data.sales.totalNet))}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </TableSurface>

      {/* One flat section per product type — beverage & food (req #3): a small
          heading + bare table, never a second bordered card. */}
      {report.data && effectiveBegin && effectiveEnd
        ? sections.map(({ section, bars, rankedCount }) => {
            const hint = [
              bars.length < rankedCount ? `Top ${bars.length} of ${rankedCount} categories` : null,
              section.totals.netPct !== null ? `section total ${pctShort(section.totals.netPct)}` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <div key={section.productType} className="mt-8">
                <h3 className="mb-2 text-sm font-semibold">
                  {section.productType.charAt(0) + section.productType.slice(1).toLowerCase()} cost analysis
                </h3>
                {/* Profit (client req 2026-07-25: "gross − cost = net"). The
                    subtraction the cost table never showed — sales minus cost of
                    goods, gross and VAT-exclusive. */}
                <div className="mb-3 flex flex-wrap items-start gap-x-8 gap-y-3 rounded-lg border bg-muted/20 px-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Gross Sales</p>
                    <p className="tnum text-sm font-medium">{formatMoney(round2(section.grossSales))}</p>
                  </div>
                  <div>
                    {/* This figure is BALANCE-derived (begin + purchases +
                        transfers − ending). The Full Audit and Usage Cost report
                        a usage-derived cost (qty × unit cost) for the same
                        period, and the two differ by whatever hasn't reconciled.
                        Both are correct; saying which is which stops it reading
                        as a discrepancy. A blocked STAFF viewer gets the same
                        two-methods framing with the word "variance" and the gap
                        it names left out (hide-variance-from-staff Phase 2.3/
                        4.3) — this report has no Usage/Sold column to back-solve
                        a fake count with, so it stays visible, but this one line
                        would otherwise name the concept this feature exists to
                        hide. */}
                    <p className="text-xs font-medium text-muted-foreground">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex cursor-help items-center gap-1">
                              Cost of Goods <Info className="size-3 text-muted-foreground" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            {varianceBlocked ? (
                              <>
                                Beginning stock + purchases + transfers − ending stock. This is
                                the balance method. The Full Audit measures cost a different way,
                                from what was actually sold and used, so the two figures are
                                expected to read differently.
                              </>
                            ) : (
                              <>
                                Beginning stock + purchases + transfers − ending stock. This is the
                                balance method, so it includes anything unaccounted for. The Full
                                Audit's usage figure counts what was actually sold and used, so the
                                two differ by the period's variance.
                              </>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </p>
                    <p className="tnum text-sm font-medium">−{formatMoney(round2(section.totals.cost))}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Gross Profit</p>
                    <p className={cn("tnum text-lg font-semibold", section.grossProfit < 0 && "text-destructive")}>
                      {formatMoney(section.grossProfit)}
                    </p>
                  </div>
                  <div className="sm:ml-auto sm:text-right">
                    <p className="text-xs font-medium text-muted-foreground">Net Profit (excl. VAT)</p>
                    <p className={cn("tnum text-lg font-semibold", section.netProfit < 0 && "text-destructive")}>
                      {formatMoney(section.netProfit)}
                    </p>
                  </div>
                </div>
                {/* Sits directly on the table it describes; a single bar would
                    rank nothing, so the block only earns its height from two. */}
                {bars.length >= 2 && (
                  <ChartBlock title="Net cost as a share of net sales" hint={hint || undefined}>
                    <MagnitudeBars
                      data={bars}
                      name="Net cost %"
                      formatter={(v) => pct(v)}
                      endLabelFormatter={pctShort}
                    />
                  </ChartBlock>
                )}
                <Table>
                  <CostAnalysisSectionTable rows={section.rows} />
                  {/* Total row is a fixed footer derived from section.totals, not
                      part of the sorted array — same treatment as every other
                      page's totals row (see variance-summary's Grand Total, and
                      this file's own VAT-amount row on the Sales table above), so
                      it stays outside CostAnalysisSectionTable and keeps its own
                      independent JSX here. */}
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-medium">Total</TableCell>
                      <TableCell className="tnum text-right font-medium">{formatMoney(round2(section.totals.beginningCost))}</TableCell>
                      <TableCell className="tnum text-right font-medium">{formatMoney(round2(section.totals.purchasesCost))}</TableCell>
                      <TableCell className="tnum text-right font-medium">
                        {section.totals.transfersCost === 0 ? "—" : formatMoney(round2(section.totals.transfersCost))}
                      </TableCell>
                      <TableCell className="tnum text-right font-medium">{formatMoney(round2(section.totals.endingCost))}</TableCell>
                      <TableCell className="tnum text-right font-semibold">{formatMoney(round2(section.totals.cost))}</TableCell>
                      <TableCell className="tnum text-right font-medium">{formatMoney(round2(section.totals.costNet))}</TableCell>
                      <TableCell className="tnum text-right font-semibold">{pct(section.totals.grossPct)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            );
          })
        : null}
    </div>
  );
}
