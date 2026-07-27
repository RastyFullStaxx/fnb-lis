import { useMemo, useState } from "react";
import { Wrench } from "lucide-react";
import { round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { exportUrl, useAssetRegisterReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, TableError, ToolbarSearch } from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
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

const n2 = (v: number) => round2(v).toLocaleString("en-US", { maximumFractionDigits: 2 });

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
            {report.isPending ? (
              <div className="shrink-0 pb-2">
                <Skeleton className="h-4 w-44" />
              </div>
            ) : report.data && report.data.rows.length > 0 ? (
              <p className="shrink-0 pb-2 text-sm text-muted-foreground">
                As of <span className="tnum font-medium text-foreground">{report.data.asOf}</span>
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
                <TableHead>Brand / Model</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Serial No.</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead className="text-right">Initial Cost</TableHead>
                <TableHead className="text-right">Current Cost</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead>Last Note</TableHead>
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
                  <TableCell className="text-muted-foreground">
                    {[row.brand, row.model].filter(Boolean).join(" / ") || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.category}</TableCell>
                  <TableCell className="text-muted-foreground">{row.serialNo ?? "—"}</TableCell>
                  <TableCell>{row.condition ? <Badge variant="outline">{row.condition}</Badge> : "—"}</TableCell>
                  <TableCell>{row.status ? <Badge variant="secondary">{row.status}</Badge> : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{row.industry ?? "—"}</TableCell>
                  <TableCell className="tnum text-right">{row.initialCost != null ? formatMoney(row.initialCost) : "—"}</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(row.currentCost)}</TableCell>
                  <TableCell className="text-muted-foreground">{row.supplier ?? "—"}</TableCell>
                  <TableCell className="max-w-[14rem] break-words text-muted-foreground">{row.remarks ?? "—"}</TableCell>
                  <TableCell className="max-w-[16rem] break-words text-muted-foreground">
                    {row.latestNote ? (
                      <>
                        {row.latestNote}
                        {row.latestNoteDate && <span className="tnum"> ({row.latestNoteDate})</span>}
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {query.trim() === "" && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={7} className="font-medium">
                    Total ({report.data.totals.count})
                  </TableCell>
                  <TableCell className="tnum text-right font-semibold">{n2(report.data.totals.initialCostValue)}</TableCell>
                  <TableCell className="tnum text-right font-semibold">{n2(report.data.totals.currentCostValue)}</TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        )}
      </TableSurface>
    </div>
  );
}
