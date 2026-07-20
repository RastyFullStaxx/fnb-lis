import { useMemo, useState } from "react";
import { ArrowLeftRight, Wine } from "lucide-react";
import { NON_REVENUE_GROUP_LABELS, NON_REVENUE_GROUPS, round2, type NonRevenueGroup } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useCountDates } from "@/api/ops";
import { exportUrl, useNonRevenueReport, useTransferReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, TableError } from "@/components/table-surface";
import { DateRangeControl, ExportButtons } from "@/components/report-toolbar";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useReportRange } from "./use-report-range";

const n2 = (v: number) => round2(v).toLocaleString("en-US", { maximumFractionDigits: 2 });

const ALL_GROUPS = "__all__";
const STOCK_TRANSFER = "__transfers__";

export function NonRevenueReportPage() {
  const locationId = useLocationId();
  const dates = useCountDates();
  const [from, to, setFrom, setTo] = useReportRange(dates.data?.dates);
  // Client req (2026-07-20): each bucket generates its own report; the Full
  // Audit keeps rolling all of them up under Non-Revenue. The fourth tab —
  // Stock Transfer — is the legacy presentation of transfers (recorded there
  // as non-revenue inputs); ours are first-class records shown here in the
  // grouping the client expects.
  const [group, setGroup] = useState<string>(ALL_GROUPS);
  const transferTab = group === STOCK_TRANSFER;
  const activeGroup = group === ALL_GROUPS || transferTab ? undefined : (group as NonRevenueGroup);
  const report = useNonRevenueReport(from, to, activeGroup, !transferTab);
  const transfers = useTransferReport(from, to, "out", transferTab);

  // Cost by reason: which write-off bucket is eating the most money.
  const reasonBars = useMemo(
    () =>
      (report.data?.byReason ?? [])
        .filter((g) => g.cost > 0)
        .sort((a, b) => b.cost - a.cost)
        .map((g) => ({ label: g.reason, value: round2(g.cost) })),
    [report.data],
  );

  return (
    <div>
      <PageHeader
        title="Non-Revenue Report"
        actions={
          transferTab ? (
            <ExportButtons
              xlsxUrl={exportUrl(locationId, "transfers", "xlsx", { from, to, direction: "out" })}
              csvUrl={exportUrl(locationId, "transfers", "csv", { from, to, direction: "out" })}
              pdfUrl={exportUrl(locationId, "transfers", "pdf", { from, to, direction: "out" })}
              disabled={!transfers.data?.rows.length}
            />
          ) : (
            <ExportButtons
              xlsxUrl={exportUrl(locationId, "non-revenue", "xlsx", { from, to, ...(activeGroup ? { group: activeGroup } : {}) })}
              csvUrl={exportUrl(locationId, "non-revenue", "csv", { from, to, ...(activeGroup ? { group: activeGroup } : {}) })}
              pdfUrl={exportUrl(locationId, "non-revenue", "pdf", { from, to, ...(activeGroup ? { group: activeGroup } : {}) })}
              disabled={!report.data?.rows.length}
            />
          )
        }
      />

      <TableSurface
        className="max-h-[70vh]"
        filters={
          <>
            <Tabs value={group} onValueChange={setGroup}>
              <TabsList>
                <TabsTrigger value={ALL_GROUPS}>All</TabsTrigger>
                {NON_REVENUE_GROUPS.map((g) => (
                  <TabsTrigger key={g} value={g}>
                    {NON_REVENUE_GROUP_LABELS[g]}
                  </TabsTrigger>
                ))}
                <TabsTrigger value={STOCK_TRANSFER}>Stock Transfer</TabsTrigger>
              </TabsList>
            </Tabs>
            <DateRangeControl from={from} to={to} onFrom={setFrom} onTo={setTo} />
          </>
        }
      >
        {transferTab ? (
          transfers.isPending ? (
            <TableLoading />
          ) : transfers.isError ? (
            <TableError onRetry={() => void transfers.refetch()} retrying={transfers.isRefetching} />
          ) : !transfers.data || transfers.data.rows.length === 0 ? (
            <TableEmpty
              icon={ArrowLeftRight}
              title="No stock transfers in this range"
              description="Stock dispatched to other locations appears here, valued at cost and retail."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead>Date</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty Sent</TableHead>
                  <TableHead className="text-right">At Cost</TableHead>
                  <TableHead className="text-right">At Retail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.data.rows.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="tnum">{row.date}</TableCell>
                    <TableCell className="text-muted-foreground">{row.counterparty}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="tnum text-right">{n2(row.qtySent)}</TableCell>
                    <TableCell className="tnum text-right">{formatMoney(row.costValue)}</TableCell>
                    <TableCell className="tnum text-right">{formatMoney(row.retailValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="font-medium">
                    Total
                  </TableCell>
                  <TableCell className="tnum text-right font-medium">{n2(transfers.data.totals.qty)}</TableCell>
                  <TableCell className="tnum text-right font-semibold">{formatMoney(transfers.data.totals.cost)}</TableCell>
                  <TableCell className="tnum text-right font-semibold">{formatMoney(transfers.data.totals.retail)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )
        ) : report.isPending ? (
          <TableLoading />
        ) : report.isError ? (
          <TableError onRetry={() => void report.refetch()} retrying={report.isRefetching} />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty icon={Wine} title="No non-revenue use in this range" description="Adjust the dates to find recorded entries." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Date</TableHead>
                <TableHead>Item / Menu</TableHead>
                <TableHead>UOM</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Content/Unit</TableHead>
                <TableHead className="text-right">Est. Cost</TableHead>
                <TableHead className="text-right">Est. Retail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.data.rows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="tnum">{row.saleDate}</TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">{row.uom ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{row.reason}</Badge>
                  </TableCell>
                  <TableCell className="tnum text-right">{n2(row.qty)}</TableCell>
                  <TableCell className="tnum text-right">{row.contentOverride ?? "—"}</TableCell>
                  <TableCell className="tnum text-right">
                    {row.estimatedCost === null ? "—" : formatMoney(row.estimatedCost)}
                  </TableCell>
                  <TableCell className="tnum text-right">
                    {row.estimatedRetail === null ? "—" : formatMoney(row.estimatedRetail)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="font-medium">
                  Total
                </TableCell>
                <TableCell className="tnum text-right font-medium">{n2(report.data.totals.qty)}</TableCell>
                <TableCell />
                <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.cost)}</TableCell>
                <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.retail)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </TableSurface>

      {!transferTab && report.data && report.data.rows.length > 0 && (
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          {reasonBars.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Cost by Reason</h3>
              <MagnitudeBars data={reasonBars} name="Est. cost" />
            </div>
          )}
          <div>
            <h3 className="mb-3 text-sm font-semibold">By Reason</h3>
            <div className="flex flex-wrap gap-x-10 gap-y-3">
              {report.data.byReason.map((g) => (
                <div key={g.reason}>
                  <p className="text-sm font-medium">{g.reason}</p>
                  <p className="tnum text-xs text-muted-foreground">
                    {g.count} entr{g.count === 1 ? "y" : "ies"} · qty {n2(g.qty)}
                    {g.cost > 0 && ` · ${formatMoney(g.cost)}`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
