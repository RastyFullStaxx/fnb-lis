import { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { convert, round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useCountDates } from "@/api/ops";
import { exportUrl, useTopSellersReport } from "@/api/reports";
import { useItemDisplayUnit } from "@/lib/preferences";
import { formatMoney } from "@/lib/utils";
import { useSort } from "@/hooks/use-sort";
import { PageHeader } from "@/components/page-header";
import { TableEmpty, TableFailure, TableLoading, TableSurface, ToolbarField, queryFailed } from "@/components/table-surface";
import { DateRangeControl, ExportButtons } from "@/components/report-toolbar";
import { ChartBlock } from "@/components/charts/chart-block";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useReportRange } from "./use-report-range";

const LIMITS = [10, 25, 50] as const;
type Limit = (typeof LIMITS)[number];

// Qty formatted to 6 dp max — whole numbers show clean, fractions show precise.
const n6 = (v: number) => round2(v).toLocaleString("en-US", { maximumFractionDigits: 6 });

export function TopSellersPage() {
  const locationId = useLocationId();
  const dates = useCountDates();
  const [from, to, setFrom, setTo] = useReportRange(dates.data?.dates);
  const [limit, setLimit] = useState<Limit>(10);

  const report = useTopSellersReport(from, to, limit);

  // The table ranks brands by qty; revenue is the other half of "top seller",
  // so the strip re-ranks the same rows by peso value. Its own copy — the
  // table's order is the service's and must not move.
  const brandBars = useMemo(
    () =>
      [...(report.data?.topBrands ?? [])]
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8)
        .map((row) => ({ label: row.name, value: round2(row.revenue) })),
    [report.data],
  );

  const hasData =
    report.data &&
    (report.data.topBrands.length > 0 ||
      report.data.topMenus.length > 0 ||
      report.data.topIngredients.length > 0);

  // Per-item display unit resolver (report-uom-plan.md, "On screen"). Only
  // topBrands and topIngredients carry a base-unit qty — topMenus rows have
  // no itemId (a cocktail has no base unit) and are left unconverted, same
  // scope as the export route's convertRowsForExport() calls.
  const allItemIds = useMemo(
    () =>
      Array.from(
        new Set(
          [...(report.data?.topBrands ?? []), ...(report.data?.topIngredients ?? [])]
            .map((r) => r.itemId)
            .filter((id): id is string => Boolean(id)),
        ),
      ),
    [report.data],
  );
  const { resolve: resolveDisplay } = useItemDisplayUnit(allItemIds);

  // Each table's "#" always shows the row's rank in the server's own
  // qty-descending order, never its position after a client-side re-sort —
  // sorting reorders the rows shown but must not relabel what "#3" means.
  const topBrands = report.data?.topBrands ?? [];
  const topMenus = report.data?.topMenus ?? [];
  const topIngredients = report.data?.topIngredients ?? [];

  const { sortedRows: sortedBrands, sortKey: brandsSortKey, sortDirection: brandsSortDirection, toggleSort: toggleBrandsSort } = useSort(topBrands, {
    accessors: {
      item: (r) => r.name,
      category: (r) => r.category ?? "",
      qty: (r) => r.qty,
      revenue: (r) => r.revenue,
    },
  });
  const { sortedRows: sortedMenus, sortKey: menusSortKey, sortDirection: menusSortDirection, toggleSort: toggleMenusSort } = useSort(topMenus, {
    accessors: {
      item: (r) => r.name,
      qty: (r) => r.qty,
      revenue: (r) => r.revenue,
    },
  });
  const { sortedRows: sortedIngredients, sortKey: ingredientsSortKey, sortDirection: ingredientsSortDirection, toggleSort: toggleIngredientsSort } = useSort(
    topIngredients,
    {
      accessors: {
        item: (r) => r.name,
        category: (r) => r.category ?? "",
        qty: (r) => r.qty,
      },
    },
  );
  const brandRank = new Map(topBrands.map((r, i) => [r.id, i + 1]));
  const menuRank = new Map(topMenus.map((r, i) => [r.id, i + 1]));
  const ingredientRank = new Map(topIngredients.map((r, i) => [r.id, i + 1]));

  return (
    <div>
      <PageHeader
        title="Top Sellers"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "top-sellers", "xlsx", { from, to })}
            csvUrl={exportUrl(locationId, "top-sellers", "csv", { from, to })}
            disabled={!hasData}
          />
        }
      />

      <TableSurface
        filters={
          <>
            <DateRangeControl from={from} to={to} onFrom={setFrom} onTo={setTo} />
            <ToolbarField label="Show">
              <div className="flex items-center gap-1">
                {LIMITS.map((l) => (
                  <Button
                    key={l}
                    variant={limit === l ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLimit(l)}
                  >
                    Top {l}
                  </Button>
                ))}
              </div>
            </ToolbarField>
          </>
        }
      >
        {queryFailed(report) ? (
          <TableFailure query={report} />
        ) : report.isPending ? (
          <TableLoading />
        ) : !hasData ? (
          <TableEmpty
            icon={TrendingUp}
            title="No sales in this range"
            description="Adjust the dates to find recorded sales."
          />
        ) : (
          <>
            {brandBars.length >= 2 && (
              <ChartBlock
                title="Top Brands by Revenue"
                // The pool (topBrands) is ranked by QUANTITY server-side and cut
                // to the 10/25/50 toggle; the bars re-rank that pool by revenue.
                // "of N by revenue" would imply N candidates were weighed on
                // revenue, so the hint names the volume selection it actually is.
                hint={`Top ${brandBars.length} by revenue, within the top ${report.data!.topBrands.length} by volume`}
              >
                <MagnitudeBars data={brandBars} name="Revenue" />
              </ChartBlock>
            )}

            {/* ── Top Brands ── */}
            <p className="border-b px-4 py-2 text-sm font-semibold">Top Brands</p>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="w-10 text-right">#</TableHead>
                  <SortableTableHead sortKey="item" activeKey={brandsSortKey} direction={brandsSortDirection} onSort={toggleBrandsSort}>
                    Item
                  </SortableTableHead>
                  <SortableTableHead sortKey="category" activeKey={brandsSortKey} direction={brandsSortDirection} onSort={toggleBrandsSort}>
                    Category
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="qty"
                    activeKey={brandsSortKey}
                    direction={brandsSortDirection}
                    onSort={toggleBrandsSort}
                    className="text-right"
                  >
                    Qty
                  </SortableTableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <SortableTableHead
                    sortKey="revenue"
                    activeKey={brandsSortKey}
                    direction={brandsSortDirection}
                    onSort={toggleBrandsSort}
                    className="text-right"
                  >
                    Revenue
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedBrands.map((row) => {
                  const itemUnit = row.itemId && row.unitName && row.unitKind && row.unitFactorToBase !== undefined
                    ? { id: row.unitName, name: row.unitName, kind: row.unitKind, factorToBase: row.unitFactorToBase }
                    : null;
                  const displayUnit = itemUnit ? resolveDisplay(row.itemId, itemUnit) ?? itemUnit : null;
                  const shownQty = displayUnit && itemUnit && displayUnit.kind === itemUnit.kind ? convert(row.qty, itemUnit, displayUnit) : row.qty;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="tnum text-right text-muted-foreground">{brandRank.get(row.id)}</TableCell>
                      <TableCell className="max-w-[22rem] font-medium break-words">{row.name}</TableCell>
                      <TableCell className="text-muted-foreground">{row.category ?? "—"}</TableCell>
                      <TableCell className="tnum text-right">{n6(shownQty)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{displayUnit?.name ?? "—"}</TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.revenue)}</TableCell>
                    </TableRow>
                  );
                })}
                {report.data!.topBrands.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No direct item sales in this range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {/* ── Top Menus ── */}
            <p className="border-y px-4 py-2 text-sm font-semibold">Top Menus</p>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="w-10 text-right">#</TableHead>
                  <SortableTableHead sortKey="item" activeKey={menusSortKey} direction={menusSortDirection} onSort={toggleMenusSort}>
                    Menu / Cocktail
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="qty"
                    activeKey={menusSortKey}
                    direction={menusSortDirection}
                    onSort={toggleMenusSort}
                    className="text-right"
                  >
                    Qty
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="revenue"
                    activeKey={menusSortKey}
                    direction={menusSortDirection}
                    onSort={toggleMenusSort}
                    className="text-right"
                  >
                    Revenue
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedMenus.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="tnum text-right text-muted-foreground">{menuRank.get(row.id)}</TableCell>
                    <TableCell className="max-w-[22rem] font-medium break-words">{row.name}</TableCell>
                    <TableCell className="tnum text-right">{n6(row.qty)}</TableCell>
                    <TableCell className="tnum text-right">{formatMoney(row.revenue)}</TableCell>
                  </TableRow>
                ))}
                {report.data!.topMenus.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No menu sales in this range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {/* ── Top Ingredients ── */}
            <p className="border-y px-4 py-2 text-sm font-semibold">Top Ingredients</p>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="w-10 text-right">#</TableHead>
                  <SortableTableHead sortKey="item" activeKey={ingredientsSortKey} direction={ingredientsSortDirection} onSort={toggleIngredientsSort}>
                    Ingredient
                  </SortableTableHead>
                  <SortableTableHead sortKey="category" activeKey={ingredientsSortKey} direction={ingredientsSortDirection} onSort={toggleIngredientsSort}>
                    Category
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="qty"
                    activeKey={ingredientsSortKey}
                    direction={ingredientsSortDirection}
                    onSort={toggleIngredientsSort}
                    className="text-right"
                  >
                    Qty Consumed
                  </SortableTableHead>
                  <TableHead className="text-right">Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedIngredients.map((row) => {
                  const itemUnit = row.itemId && row.unitName && row.unitKind && row.unitFactorToBase !== undefined
                    ? { id: row.unitName, name: row.unitName, kind: row.unitKind, factorToBase: row.unitFactorToBase }
                    : null;
                  const displayUnit = itemUnit ? resolveDisplay(row.itemId, itemUnit) ?? itemUnit : null;
                  const shownQty = displayUnit && itemUnit && displayUnit.kind === itemUnit.kind ? convert(row.qty, itemUnit, displayUnit) : row.qty;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="tnum text-right text-muted-foreground">{ingredientRank.get(row.id)}</TableCell>
                      <TableCell className="max-w-[22rem] font-medium break-words">{row.name}</TableCell>
                      <TableCell className="text-muted-foreground">{row.category ?? "—"}</TableCell>
                      <TableCell className="tnum text-right">{n6(shownQty)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{displayUnit?.name ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
                {report.data!.topIngredients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No menu sales with recipe snapshots in this range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </>
        )}
      </TableSurface>
    </div>
  );
}
