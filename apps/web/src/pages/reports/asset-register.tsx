import { useMemo, useState } from "react";
import { Wrench } from "lucide-react";
import { useLocationId } from "@/api/location";
import { exportUrl, useAssetRegisterReport } from "@/api/reports";
import { formatMoney, formatDate, formatNumber } from "@/lib/utils";
import { useSort } from "@/hooks/use-sort";
import { PageHeader } from "@/components/page-header";
import { TableEmpty, TableFailure, TableLoading, TableSurface, ToolbarSearch, queryFailed } from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
import { Toggle } from "@/components/toggle-chip";
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


/**
 * Asset Register (Phase 6.1/6.4) — the Audit Report equivalent for Asset. A
 * snapshot table, same shape as on-hand.tsx: no drill-down, no reconciliation
 * math (Asset has none). No Purchase column — Initial Cost and Current Cost
 * are the two cost figures that actually exist on LocationItem.
 */
export function AssetRegisterReportPage() {
  const locationId = useLocationId();
  const report = useAssetRegisterReport();
  const [query, setQuery] = useState("");
  // Thirteen columns is 1,860px — a sideways scroll on any 13" laptop. Same
  // answer the Full Audit already uses: compact by default (identity,
  // condition, and money), "All Columns" for the full register. Exports always
  // carry every column, so nothing is lost by narrowing the screen.
  const [compact, setCompact] = useState(true);

  const rows = useMemo(() => {
    const all = report.data?.rows ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.assetCode ?? "").toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        (r.brand ?? "").toLowerCase().includes(q) ||
        (r.serialNo ?? "").toLowerCase().includes(q),
    );
  }, [report.data, query]);

  const { sortedRows, sortKey, sortDirection, toggleSort } = useSort(rows, {
    accessors: {
      assetCode: (r) => r.assetCode,
      item: (r) => r.name,
      brand: (r) => [r.brand, r.model].filter(Boolean).join(" / "),
      category: (r) => r.category,
      serialNo: (r) => r.serialNo,
      condition: (r) => r.condition,
      status: (r) => r.status,
      industry: (r) => r.industry,
      qty: (r) => r.qty,
      initialCost: (r) => r.initialCost,
      currentCost: (r) => r.currentCost,
      value: (r) => r.currentValue,
      supplier: (r) => r.supplier,
      remarks: (r) => r.remarks,
      latestNote: (r) => r.latestNote,
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Asset Register"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "asset-register", "xlsx")}
            csvUrl={exportUrl(locationId, "asset-register", "csv")}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarSearch
              value={query}
              onChange={setQuery}
              placeholder="Find an asset code, item, brand, or serial…"
            />
            <Toggle pressed={!compact} onPressedChange={(on) => setCompact(!on)}>
              All Columns
            </Toggle>
            {report.isPending ? (
              <div className="shrink-0 pb-2">
                <Skeleton className="h-4 w-44" />
              </div>
            ) : report.data && report.data.rows.length > 0 ? (
              <p className="shrink-0 pb-2 text-sm text-muted-foreground">
                As of <span className="tnum font-medium text-foreground">{formatDate(report.data.asOf)}</span>
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
            icon={Wrench}
            title="No assets registered"
            description="Attach an Asset item to this location and set its register fields to see it here."
          />
        ) : rows.length === 0 ? (
          <TableEmpty icon={Wrench} title="No rows match the search" description="Try a different code, item, brand, or serial number." />
        ) : (
          <Table>
            <colgroup>
              <col />
              <col />
              {!compact && <col />}
              <col />
              {!compact && <col />}
              <col />
              <col />
              {!compact && <col />}
              <col className="w-px" />
              <col className="w-px" />
              <col className="w-px" />
              <col className="w-px" />
              {!compact && <col />}
              {!compact && <col />}
              {!compact && <col />}
            </colgroup>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <SortableTableHead sortKey="assetCode" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                  Asset Code
                </SortableTableHead>
                <SortableTableHead sortKey="item" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                  Item
                </SortableTableHead>
                {!compact && (
                  <SortableTableHead sortKey="brand" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                    Brand / Model
                  </SortableTableHead>
                )}
                <SortableTableHead sortKey="category" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                  Category
                </SortableTableHead>
                {!compact && (
                  <SortableTableHead sortKey="serialNo" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                    Serial No.
                  </SortableTableHead>
                )}
                <SortableTableHead sortKey="condition" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                  Condition
                </SortableTableHead>
                <SortableTableHead sortKey="status" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                  Status
                </SortableTableHead>
                {!compact && (
                  <SortableTableHead sortKey="industry" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                    Industry
                  </SortableTableHead>
                )}
                <SortableTableHead
                  sortKey="qty"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                  className="text-right"
                >
                  Qty
                </SortableTableHead>
                <SortableTableHead
                  sortKey="initialCost"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                  className="text-right"
                >
                  Initial Cost
                </SortableTableHead>
                <SortableTableHead
                  sortKey="currentCost"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                  className="text-right"
                >
                  Current Cost
                </SortableTableHead>
                <SortableTableHead
                  sortKey="value"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                  className="text-right"
                >
                  Value
                </SortableTableHead>
                {!compact && (
                  <SortableTableHead sortKey="supplier" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                    Supplier
                  </SortableTableHead>
                )}
                {!compact && (
                  <SortableTableHead sortKey="remarks" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                    Remarks
                  </SortableTableHead>
                )}
                {!compact && (
                  <SortableTableHead sortKey="latestNote" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                    Last Note
                  </SortableTableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((row) => (
                <TableRow key={row.locationItemId}>
                  <TableCell className="tnum font-medium">{row.assetCode ?? "—"}</TableCell>
                  <TableCell className="max-w-[16rem] break-words">
                    {row.name}
                    <span className="text-muted-foreground"> · {row.uom}</span>
                  </TableCell>
                  {!compact && (
                    <TableCell className="text-muted-foreground">
                      {[row.brand, row.model].filter(Boolean).join(" / ") || "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-muted-foreground">{row.category}</TableCell>
                  {!compact && <TableCell className="text-muted-foreground">{row.serialNo ?? "—"}</TableCell>}
                  <TableCell>{row.condition ? <Badge variant="outline">{row.condition}</Badge> : "—"}</TableCell>
                  <TableCell>{row.status ? <Badge variant="secondary">{row.status}</Badge> : "—"}</TableCell>
                  {!compact && <TableCell className="text-muted-foreground">{row.industry ?? "—"}</TableCell>}
                  <TableCell className="tnum text-right">{formatNumber(row.qty)}</TableCell>
                  <TableCell className="tnum text-right">{row.initialCost != null ? formatMoney(row.initialCost) : "—"}</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(row.currentCost)}</TableCell>
                  <TableCell className="tnum text-right font-medium">{formatMoney(row.currentValue)}</TableCell>
                  {!compact && <TableCell className="text-muted-foreground">{row.supplier ?? "—"}</TableCell>}
                  {!compact && (
                    <TableCell className="max-w-[14rem] break-words text-muted-foreground">{row.remarks ?? "—"}</TableCell>
                  )}
                  {!compact && (
                    <TableCell className="max-w-[16rem] break-words text-muted-foreground">
                      {row.latestNote ? (
                        <>
                          {row.latestNote}
                          {row.latestNoteDate && <span className="tnum"> ({formatDate(row.latestNoteDate)})</span>}
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
            {query.trim() === "" && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={compact ? 5 : 8} className="font-medium">
                    Total ({report.data.totals.count} {report.data.totals.count === 1 ? "asset" : "assets"})
                  </TableCell>
                  <TableCell className="tnum text-right font-semibold">
                    {formatNumber(report.data.totals.qty)}
                  </TableCell>
                  {/* Initial Cost and Current Cost are per-unit figures on each
                      row — summing them across different asset types isn't
                      meaningful, so those two columns carry no total. One
                      spanned blank cell (rather than two separate empty
                      cells) keeps their combined width locked to what the
                      body rows actually render, so Value's total can't drift
                      off its own column when its neighbors are empty. */}
                  <TableCell colSpan={2} />
                  <TableCell className="tnum text-right font-semibold">
                    {formatMoney(report.data.totals.currentCostValue)}
                  </TableCell>
                  {!compact && <TableCell colSpan={3} />}
                </TableRow>
              </TableFooter>
            )}
          </Table>
        )}
      </TableSurface>
    </div>
  );
}
