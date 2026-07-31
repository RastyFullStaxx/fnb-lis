import { useMemo, useState } from "react";
import { Wrench } from "lucide-react";
import { useLocationId } from "@/api/location";
import { exportUrl, useAssetRegisterReport } from "@/api/reports";
import { formatMoney, formatDate, formatNumber } from "@/lib/utils";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";


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
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Asset Code</TableHead>
                <TableHead>Item</TableHead>
                {!compact && <TableHead>Brand / Model</TableHead>}
                <TableHead>Category</TableHead>
                {!compact && <TableHead>Serial No.</TableHead>}
                <TableHead>Condition</TableHead>
                <TableHead>Status</TableHead>
                {!compact && <TableHead>Industry</TableHead>}
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Initial Cost</TableHead>
                <TableHead className="text-right">Current Cost</TableHead>
                <TableHead className="text-right">Value</TableHead>
                {!compact && <TableHead>Supplier</TableHead>}
                {!compact && <TableHead>Remarks</TableHead>}
                {!compact && <TableHead>Last Note</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
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
                  <TableCell colSpan={compact ? 3 : 7} className="font-medium">
                    Total ({report.data.totals.count} {report.data.totals.count === 1 ? "asset" : "assets"})
                  </TableCell>
                  <TableCell className="tnum text-right font-semibold">
                    {formatNumber(report.data.totals.qty)}
                  </TableCell>
                  {/* Money, formatted as money — the footer printed bare
                      numbers while every row above carried a ₱. */}
                  <TableCell className="tnum text-right font-semibold">
                    {formatMoney(report.data.totals.initialCostValue)}
                  </TableCell>
                  <TableCell />
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
