import { useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useMe } from "@/api/auth";
import { exportUrl, useParLevelReport } from "@/api/reports";
import { useIncludeHiddenInReports } from "@/api/settings";
import { formatMoney, formatNumber, formatDate } from "@/lib/utils";
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


const REORDER_BAR_CAP = 8;

/**
 * Par Level report (client req 2026-07-21) — a purchasing guide. Shows every
 * item with a reorder point: current stock vs par, how much it moved last
 * period, and a suggested order quantity. Items below par lead the list.
 */
export function ParLevelReportPage() {
  const locationId = useLocationId();
  const me = useMe();
  const report = useParLevelReport();
  const [query, setQuery] = useState("");

  // Same reasoning as On-Hand/Non-Moving: ParLevelRow.usage is the reorder
  // depletion rate, not the purchases/forfeits/transfers/variance signal the
  // server filter actually checks (report-lists.ts's hasOnHandPeriodActivity),
  // and that signal isn't on the wire — so the badge is only unambiguous when
  // the setting is off (docs/clutter-in-reports-decision.md).
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

  // "Used (last period)" is genuinely ABSENT from the wire response for a
  // blocked STAFF account (hide-variance-from-staff Phase 2.4/4.4), not
  // zeroed — driven off the data itself, same as every other presence check
  // on this page, rather than a second read of the role/flag this page has
  // no other reason to know about. Checked against the full row set, not the
  // filtered/searched `rows`, so a search that happens to match zero rows
  // can never flip the column on or off.
  const showUsage = (report.data?.rows ?? []).some((r) => r.usage !== undefined);

  // What to buy: the biggest suggested orders by value.
  const reorderBars = useMemo(() => {
    return (report.data?.rows ?? [])
      .filter((r) => r.suggestedOrder > 0)
      .slice(0, REORDER_BAR_CAP)
      .map((r) => ({ label: r.name, value: round2(r.orderValue) }));
  }, [report.data]);

  const { sortedRows, sortKey, sortDirection, toggleSort } = useSort(rows, {
    accessors: {
      item: (r) => r.name,
      category: (r) => r.category,
      onHand: (r) => r.onHand,
      par: (r) => r.parLevel ?? -Infinity,
      used: (r) => r.usage ?? -Infinity,
      suggestedOrder: (r) => r.suggestedOrder,
      orderValue: (r) => r.orderValue,
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Par Level"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "par-level", "xlsx")}
            csvUrl={exportUrl(locationId, "par-level", "csv")}
            pdfUrl={exportUrl(locationId, "par-level", "pdf")}
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
            ) : report.data && report.data.rows.length > 0 ? (
              <p className="shrink-0 pb-2 text-sm text-muted-foreground">
                Stock as of <span className="tnum font-medium text-foreground">{formatDate(report.data.lastCountDate)}</span>
                {report.data.periodBegin ? (
                  <>
                    {" · movement "}
                    <span className="tnum font-medium text-foreground">
                      {report.data.periodBegin} → {report.data.periodEnd}
                    </span>
                  </>
                ) : null}
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
            icon={ClipboardList}
            title="No par levels set"
            description="Set a par (reorder point) on your items — this report then shows what to buy, and how much, against recent movement."
          />
        ) : (
          <>
            {reorderBars.length >= 2 && query.trim() === "" && (
              <ChartBlock title="Suggested order by value" hint={`Top ${reorderBars.length} to restock`}>
                <MagnitudeBars data={reorderBars} name="Order value" />
              </ChartBlock>
            )}
            {rows.length === 0 ? (
              <TableEmpty icon={ClipboardList} title="No rows match the search" description="Try a different item or category name." />
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
                      sortKey="par"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                      className="text-right"
                    >
                      Par
                    </SortableTableHead>
                    {showUsage && (
                      <SortableTableHead
                        sortKey="used"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={toggleSort}
                        className="text-right"
                      >
                        Used (last period)
                      </SortableTableHead>
                    )}
                    <SortableTableHead
                      sortKey="suggestedOrder"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                      className="text-right"
                    >
                      Suggested Order
                    </SortableTableHead>
                    <SortableTableHead
                      sortKey="orderValue"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                      className="text-right"
                    >
                      Order Value
                    </SortableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map((row) => (
                    <TableRow key={row.locationItemId} className={cn(row.belowPar && "bg-warning/5")}>
                      <TableCell className="max-w-[22rem] font-medium break-words">
                        {row.name}
                        {row.belowPar && (
                          <Badge variant="warning" className="ml-2">
                            Below par
                          </Badge>
                        )}
                        {!row.isActive && !includeHiddenInReports && (
                          <Badge variant="warning" className="ml-2">
                            hidden · active
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.category}</TableCell>
                      <TableCell className={cn("tnum text-right", row.belowPar && "text-warning-text")}>{formatNumber(row.onHand)}</TableCell>
                      <TableCell className="tnum text-right text-muted-foreground">{formatNumber(row.parLevel)}</TableCell>
                      {showUsage && (
                        <TableCell className="tnum text-right text-muted-foreground">
                          {row.usage !== undefined ? formatNumber(row.usage) : "—"}
                        </TableCell>
                      )}
                      <TableCell className="tnum text-right font-medium">{row.suggestedOrder > 0 ? formatNumber(row.suggestedOrder) : "—"}</TableCell>
                      <TableCell className="tnum text-right">{row.orderValue > 0 ? formatMoney(row.orderValue) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {query.trim() === "" && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={showUsage ? 5 : 4} className="font-medium">
                        {report.data.totals.belowParCount} below par
                      </TableCell>
                      <TableCell className="text-right font-medium">Total to buy</TableCell>
                      <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.orderValue)}</TableCell>
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
