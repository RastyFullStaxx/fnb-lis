import { useMemo, useState } from "react";
import { Boxes } from "lucide-react";
import { convert, formatQty, round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useMe } from "@/api/auth";
import { exportUrl, useOnHandReport } from "@/api/reports";
import { useIncludeHiddenInReports } from "@/api/settings";
import { useItemDisplayUnit } from "@/lib/preferences";
import { formatMoney, formatDate, formatUnitPrice } from "@/lib/utils";
import { useSort } from "@/hooks/use-sort";
import { PageHeader } from "@/components/page-header";
import { TableEmpty, TableFailure, TableLoading, TableSurface, ToolbarSearch, queryFailed } from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
import { ChartBlock } from "@/components/charts/chart-block";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { cn } from "@/lib/utils";


const CATEGORY_BAR_CAP = 6;

export function OnHandReportPage() {
  const locationId = useLocationId();
  const me = useMe();
  const report = useOnHandReport();
  const [query, setQuery] = useState("");

  // Whether a hidden-but-active row's badge is meaningful here: with the
  // setting on, a row can be !isActive because it's simply shown by policy,
  // not because it moved — OnHandRow carries no activity fields to tell the
  // two apart (docs/clutter-in-reports-decision.md), so the badge only shows
  // when the setting is off, the one case where it can only mean "moved".
  const location = me.data?.clients.flatMap((c) => c.locations).find((l) => l.id === locationId);
  const includeHidden = useIncludeHiddenInReports(location?.clientId ?? "");
  const includeHiddenInReports = includeHidden.data?.includeHiddenInReports ?? false;

  const rows = useMemo(() => {
    const all = report.data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return q
      ? all.filter((r) => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
      : all;
  }, [report.data, query]);

  // Per-item display unit resolver (report-uom-plan.md, "On screen": staff
  // override → establishment default → viewer's own general preference →
  // item base unit — same chain Stock and Counts already use). `onHand`
  // itself is served in the item's own base unit; converting happens only
  // at render time below, same pattern as counts/session.tsx's LineRow.
  const allItemIds = useMemo(
    () => Array.from(new Set((report.data?.rows ?? []).map((r) => r.itemId))),
    [report.data],
  );
  const { resolve: resolveDisplay } = useItemDisplayUnit(allItemIds);

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

  const { sortedRows, sortKey, sortDirection, toggleSort } = useSort(rows, {
    accessors: {
      item: (r) => r.name,
      category: (r) => r.category,
      onHand: (r) => r.onHand,
      cost: (r) => r.cost,
      retail: (r) => r.retail,
      costValue: (r) => r.costValue,
      retailValue: (r) => r.retailValue,
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Inventory on Hand"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "on-hand", "xlsx")}
            csvUrl={exportUrl(locationId, "on-hand", "csv")}
            pdfUrl={exportUrl(locationId, "on-hand", "pdf")}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarSearch value={query} onChange={setQuery} placeholder="Find an item or category…" />
            {/* Provenance, not a control — so it carries no caption and never grows.
                The row is items-end, which would drop this line onto the input's
                bottom BORDER; pb-2 lifts it onto the input's own text instead. */}
            {report.isPending ? (
              <div className="shrink-0 pb-2">
                <Skeleton className="h-4 w-44" />
              </div>
            ) : report.data && report.data.rows.length > 0 ? (
              <p className="shrink-0 pb-2 text-sm text-muted-foreground">
                As of last count <span className="tnum font-medium text-foreground">{formatDate(report.data.lastCountDate)}</span>
              </p>
            ) : null}
          </>
        }
      >
        {queryFailed(report) ? (
          <TableFailure query={report} />
        ) : report.isPending ? (
          <TableLoading />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty
            icon={Boxes}
            title="No committed count yet"
            description="On-hand stock is derived from the last committed count. Commit a count to populate this report."
          />
        ) : (
          <>
            {categoryBars.length >= 2 && query.trim() === "" && (
              <ChartBlock title="Stock value by category (cost)">
                <MagnitudeBars data={categoryBars} name="Cost value" />
              </ChartBlock>
            )}
            {rows.length === 0 ? (
              <TableEmpty icon={Boxes} title="No rows match the search" description="Try a different item or category name." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <SortableTableHead sortKey="item" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                      Item
                    </SortableTableHead>
                    <SortableTableHead sortKey="category" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                      Category
                    </SortableTableHead>
                    <SortableTableHead
                      sortKey="onHand"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                      className="text-right"
                    >
                      On Hand
                    </SortableTableHead>
                    <SortableTableHead
                      sortKey="cost"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                      className="text-right"
                    >
                      Cost
                    </SortableTableHead>
                    <SortableTableHead
                      sortKey="retail"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                      className="text-right"
                    >
                      Retail
                    </SortableTableHead>
                    <SortableTableHead
                      sortKey="costValue"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                      className="text-right"
                    >
                      Cost Value
                    </SortableTableHead>
                    <SortableTableHead
                      sortKey="retailValue"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                      className="text-right"
                    >
                      Retail Value
                    </SortableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map((row) => (
                    <TableRow key={row.locationItemId} className={cn(row.belowPar && "bg-warning/5")}>
                      {/* Item names run long and carry an inline badge — cap and wrap
                          them here so the six numeric columns never scroll sideways. */}
                      <TableCell className="max-w-[22rem] font-medium break-words">
                        {row.name}
                        {row.belowPar && (
                          <Badge variant="warning" className="ml-2">
                            Low stock
                          </Badge>
                        )}
                        {!row.isActive && !includeHiddenInReports && (
                          <Badge variant="warning" className="ml-2">
                            hidden · active
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.category}</TableCell>
                      <TableCell className={cn("tnum text-right", row.onHand < 0 && "text-destructive")}>
                        {(() => {
                          const itemUnit = { id: row.unitName, name: row.unitName, kind: row.unitKind, factorToBase: row.unitFactorToBase };
                          const displayUnit = resolveDisplay(row.itemId, itemUnit) ?? itemUnit;
                          const shown = displayUnit.kind === itemUnit.kind ? convert(row.onHand, itemUnit, displayUnit) : row.onHand;
                          return formatQty(shown, displayUnit.name);
                        })()}
                      </TableCell>
                      <TableCell className="tnum text-right">{formatUnitPrice(row.cost)}</TableCell>
                      <TableCell className="tnum text-right">{formatUnitPrice(row.retail)}</TableCell>
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
