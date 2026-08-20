import { useMemo, useState } from "react";
import { PackageX } from "lucide-react";
import { toast } from "sonner";
import { round2 } from "@fnb/core";
import { useClutterCandidatesReport, useHideLocationItem } from "@/api/location";
import { ApiError } from "@/api/http";
import { formatMoney, formatNumber, formatUnitPrice } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableEmpty, TableFailure, TableLoading, TableSurface, ToolbarSearch, queryFailed } from "@/components/table-surface";
import { ChartBlock } from "@/components/charts/chart-block";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const CLUTTER_BAR_CAP = 8;

/**
 * Clutter Candidates (clutter-item-removal plan, Phase 3 of the UI work).
 *
 * Deliberately NOT a report: approving a candidate mutates the catalog
 * (Hide flips isActive), while every report on this app is read-only. It
 * lives off Local Database instead — same home as the schedule control and
 * restore — so a mutate action never leaks into audit-service report
 * viewers, exports, or print.
 *
 * Built the same way as non-moving.tsx: TableSurface, search box, idle-value
 * bar chart, empty/loading/failure fills from table-surface.tsx.
 */
export function ClutterCandidatesPage() {
  const report = useClutterCandidatesReport();
  const hide = useHideLocationItem();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const all = report.data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return q
      ? all.filter((r) => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
      : all;
  }, [report.data, query]);

  // Where the idle cash sits: the biggest candidate lines by cost value —
  // same cap pattern as Non-Moving's deadBars.
  const clutterBars = useMemo(() => {
    return (report.data?.rows ?? [])
      .slice(0, CLUTTER_BAR_CAP)
      .map((r) => ({ label: r.name, value: round2(r.costValue) }));
  }, [report.data]);

  const onHide = async (locationItemId: string, name: string) => {
    try {
      await hide.mutateAsync(locationItemId);
      toast.success(`${name} hidden from catalog.`);
    } catch (err) {
      // Block reasons (open count, live recipe, unreceived transfer) come
      // back as the server's own message — shown as is, row stays untouched.
      toast.error(err instanceof ApiError ? err.message : "Could not hide this item");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Clutter Candidates" />

      <TableSurface
        filters={
          <>
            <ToolbarSearch value={query} onChange={setQuery} placeholder="Find an item or category…" />
            {report.isPending ? (
              <div className="shrink-0 pb-2">
                <Skeleton className="h-4 w-56" />
              </div>
            ) : report.data && report.data.asOfDate ? (
              <p className="shrink-0 pb-2 text-sm text-muted-foreground">
                Checked against the last{" "}
                <span className="tnum font-medium text-foreground">12 months</span>, as of{" "}
                <span className="tnum font-medium text-foreground">{report.data.asOfDate}</span>
              </p>
            ) : null}
          </>
        }
      >
        {queryFailed(report) ? (
          <TableFailure query={report} title="Couldn't load clutter candidates" />
        ) : report.isPending ? (
          <TableLoading />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty
            icon={PackageX}
            title="Nothing sitting idle."
            description="Every item on hand moved recently or is inside its own season."
          />
        ) : (
          <>
            {clutterBars.length >= 2 && query.trim() === "" && (
              <ChartBlock title="Idle stock value (cost)" hint={`Top ${clutterBars.length} by value`}>
                <MagnitudeBars data={clutterBars} name="Cost value" />
              </ChartBlock>
            )}
            {rows.length === 0 ? (
              <TableEmpty icon={PackageX} title="No rows match the search" description="Try a different item or category name." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead>Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">On Hand</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Cost Value</TableHead>
                    <TableHead className="text-right">Checked</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.locationItemId}>
                      <TableCell className="max-w-[22rem] font-medium break-words">{row.name}</TableCell>
                      <TableCell className="text-muted-foreground">{row.category}</TableCell>
                      <TableCell className="tnum text-right">{formatNumber(row.onHand)}</TableCell>
                      <TableCell className="tnum text-right">
                        {/* Not sent over the wire directly — the report only
                            carries onHand and costValue (= onHand × cost),
                            so the per-unit figure is derived here rather
                            than adding a field the server doesn't send. */}
                        {row.onHand > 0 ? formatUnitPrice(row.costValue / row.onHand) : "—"}
                      </TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.costValue)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {/* The header above says "12 months" as the norm, but
                            an item with no committed count that far back (new
                            stock, or a location under a year old) is only
                            checked against its last one closed period —
                            report-lists.ts clutterCandidates() falls back to
                            that rather than fabricate a 12-month usage figure
                            from a missing begin count. Surfacing the real
                            window per row keeps that header claim honest
                            instead of overstating the evidence behind every
                            row uniformly. */}
                        {row.monthsChecked === 12 ? "12 mo" : "1 period"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="xs"
                          variant="destructive"
                          onClick={() => void onHide(row.locationItemId, row.name)}
                        >
                          Hide
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </TableSurface>
    </div>
  );
}
