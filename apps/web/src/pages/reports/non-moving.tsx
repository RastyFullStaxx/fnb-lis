import { useMemo, useState } from "react";
import { PackageX } from "lucide-react";
import { convert, formatQty, round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useMe } from "@/api/auth";
import { exportUrl, useNonMovingReport } from "@/api/reports";
import { useIncludeHiddenInReports } from "@/api/settings";
import { useItemDisplayUnit } from "@/lib/preferences";
import { formatMoney, formatUnitPrice } from "@/lib/utils";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";


const DEAD_BAR_CAP = 8;

/**
 * Non-Moving items report (client req 2026-07-21) — dead stock. Items still on
 * hand that saw no movement over the last closed period: cash tied up in stock
 * that isn't selling. Ranked by the value sitting idle.
 */
export function NonMovingReportPage() {
  const locationId = useLocationId();
  const me = useMe();
  const report = useNonMovingReport();
  const [query, setQuery] = useState("");

  // Every row here has zero usage by construction — the report's own
  // subject. A hidden row still on the list survived because of purchases/
  // forfeits/transfers/variance in the window, which NonMovingRow doesn't
  // carry to the client, or because the setting shows it regardless
  // (docs/clutter-in-reports-decision.md). The badge is only unambiguous
  // when the setting is off.
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

  // Per-item display unit resolver (report-uom-plan.md, "On screen") — only
  // `onHand` converts here, same scope as the export route.
  const allItemIds = useMemo(
    () => Array.from(new Set((report.data?.rows ?? []).map((r) => r.itemId))),
    [report.data],
  );
  const { resolve: resolveDisplay } = useItemDisplayUnit(allItemIds);

  // Where the idle cash sits: the biggest dead-stock lines by cost value.
  const deadBars = useMemo(() => {
    return (report.data?.rows ?? [])
      .slice(0, DEAD_BAR_CAP)
      .map((r) => ({ label: r.name, value: round2(r.costValue) }));
  }, [report.data]);

  const { sortedRows, sortKey, sortDirection, toggleSort } = useSort(rows, {
    accessors: {
      item: (r) => r.name,
      category: (r) => r.category,
      onHand: (r) => r.onHand,
      cost: (r) => r.cost,
      costValue: (r) => r.costValue,
      retailValue: (r) => r.retailValue,
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Non-Moving Items"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "non-moving", "xlsx")}
            csvUrl={exportUrl(locationId, "non-moving", "csv")}
            pdfUrl={exportUrl(locationId, "non-moving", "pdf")}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarSearch value={query} onChange={setQuery} placeholder="Find an item or category…" />
            {report.isPending ? (
              <div className="shrink-0 pb-2">
                <Skeleton className="h-4 w-56" />
              </div>
            ) : report.data && report.data.periodBegin ? (
              <p className="shrink-0 pb-2 text-sm text-muted-foreground">
                No movement{" "}
                <span className="tnum font-medium text-foreground">
                  {report.data.periodBegin} → {report.data.periodEnd}
                </span>
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
            icon={PackageX}
            title="Nothing sitting idle"
            description="Every item on hand moved during the last closed period — no dead stock to flag. (Needs at least one closed audit period to judge movement.)"
          />
        ) : (
          <>
            {deadBars.length >= 2 && query.trim() === "" && (
              <ChartBlock title="Idle stock value (cost)" hint={`Top ${deadBars.length} by value`}>
                <MagnitudeBars data={deadBars} name="Cost value" />
              </ChartBlock>
            )}
            {rows.length === 0 ? (
              <TableEmpty icon={PackageX} title="No rows match the search" description="Try a different item or category name." />
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
                    <TableHead className="text-right">Unit</TableHead>
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
                    <TableRow key={row.locationItemId}>
                      <TableCell className="max-w-[22rem] font-medium break-words">
                        {row.name}
                        {!row.isActive && !includeHiddenInReports && (
                          <Badge variant="warning" className="ml-2">
                            hidden · active
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.category}</TableCell>
                      <TableCell className="tnum text-right">
                        {(() => {
                          const itemUnit = { id: row.unitName, name: row.unitName, kind: row.unitKind, factorToBase: row.unitFactorToBase };
                          const displayUnit = resolveDisplay(row.itemId, itemUnit) ?? itemUnit;
                          const shown = displayUnit.kind === itemUnit.kind ? convert(row.onHand, itemUnit, displayUnit) : row.onHand;
                          return formatQty(shown);
                        })()}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {(() => {
                          const itemUnit = { id: row.unitName, name: row.unitName, kind: row.unitKind, factorToBase: row.unitFactorToBase };
                          return (resolveDisplay(row.itemId, itemUnit) ?? itemUnit).name;
                        })()}
                      </TableCell>
                      <TableCell className="tnum text-right">{formatUnitPrice(row.cost)}</TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.costValue)}</TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.retailValue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {query.trim() === "" && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={5} className="font-medium">
                        {report.data.totals.count} item{report.data.totals.count === 1 ? "" : "s"} not moving
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
