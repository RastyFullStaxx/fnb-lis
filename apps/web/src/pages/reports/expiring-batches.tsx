import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useLocationId } from "@/api/location";
import { exportUrl, useExpiringBatchesReport } from "@/api/reports";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { useSort } from "@/hooks/use-sort";
import { PageHeader } from "@/components/page-header";
import { TableEmpty, TableFailure, TableLoading, TableSurface, ToolbarSearch, queryFailed } from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
import { Badge } from "@/components/ui/badge";
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
 * Expiring Batches report (expiry-date-plan.md, phases doc Phase 6.1) — the
 * manager-level "what's expiring across the board" view. Every open, dated
 * purchase-line batch at this location, expired first (oldest expiry within
 * that group), then everything still ahead sorted soonest-to-expire —
 * exactly the ordering `expiringBatchesReport()` already returns, so the
 * page renders rows in server order rather than re-sorting client-side.
 *
 * Row tint reuses `bg-warning/10`, the same amber DESIGN.md already assigns
 * to "over" variance and `belowPar` rows — a deliberately different color
 * from the destructive/red negative-variance tint (DESIGN.md's report-table
 * spec: "a different color to avoid confusion with variance severity"),
 * reused here rather than inventing a third palette entry since this report
 * carries no variance rows to confuse it with.
 *
 * No date range and no cost/retail columns: this reads live open batches,
 * not a closed period, and expiry isn't a valuation — same reasoning
 * On-Hand's screen view uses for having no `from`/`to` picker.
 */
export function ExpiringBatchesReportPage() {
  const locationId = useLocationId();
  const report = useExpiringBatchesReport();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const all = report.data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return q
      ? all.filter((r) => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
      : all;
  }, [report.data, query]);

  const { sortedRows, sortKey, sortDirection, toggleSort } = useSort(rows, {
    accessors: {
      item: (r) => r.name,
      category: (r) => r.category,
      qty: (r) => r.qty,
      received: (r) => r.purchaseDate,
      expires: (r) => r.expiryDate,
      status: (r) => (r.isExpired ? 0 : 1),
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Expiring Batches"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "expiring-batches", "xlsx")}
            csvUrl={exportUrl(locationId, "expiring-batches", "csv")}
            pdfUrl={exportUrl(locationId, "expiring-batches", "pdf")}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <TableSurface
        filters={<ToolbarSearch value={query} onChange={setQuery} placeholder="Find an item or category…" />}
      >
        {queryFailed(report) ? (
          <TableFailure query={report} />
        ) : report.isPending ? (
          <TableLoading />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty
            icon={AlertTriangle}
            title="Nothing dated on the shelf"
            description="No open, committed delivery on record carries an expiry date yet — perishable batches show up here as soon as they're received."
          />
        ) : rows.length === 0 ? (
          <TableEmpty icon={AlertTriangle} title="No rows match the search" description="Try a different item or category name." />
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
                  sortKey="qty"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                  className="text-right"
                >
                  Qty
                </SortableTableHead>
                <SortableTableHead sortKey="received" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                  Received
                </SortableTableHead>
                <SortableTableHead sortKey="expires" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                  Expires
                </SortableTableHead>
                <SortableTableHead sortKey="status" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                  Status
                </SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((row) => (
                <TableRow
                  key={row.purchaseLineId}
                  className={cn(row.isExpired && "bg-warning/10 hover:bg-warning/15")}
                >
                  <TableCell className="max-w-[22rem] font-medium break-words">{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">{row.category}</TableCell>
                  <TableCell className="tnum text-right">{formatNumber(row.qty)}</TableCell>
                  <TableCell className="tnum">{formatDate(row.purchaseDate)}</TableCell>
                  <TableCell className="tnum">{formatDate(row.expiryDate)}</TableCell>
                  <TableCell>
                    {row.isExpired ? (
                      <Badge variant="warning">Expired</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">Upcoming</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {query.trim() === "" && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={6} className="font-medium">
                    {report.data.totals.expiredCount} expired · {report.data.totals.upcomingCount} upcoming
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        )}
      </TableSurface>
    </div>
  );
}
