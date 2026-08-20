import { useMemo, useState } from "react";
import { ArrowLeftRight, Wine } from "lucide-react";
import { NON_REVENUE_GROUP_LABELS, NON_REVENUE_GROUPS, round2, type NonRevenueGroup } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useCountDates } from "@/api/ops";
import { exportUrl, useNonRevenueReport, useTransferReport } from "@/api/reports";
import { formatMoney, formatNumber, formatDate } from "@/lib/utils";
import { useSort } from "@/hooks/use-sort";
import { PageHeader } from "@/components/page-header";
import { TableEmpty, TableFailure, TableLoading, TableSurface, ToolbarField, queryFailed } from "@/components/table-surface";
import { DateRangeControl, ExportButtons } from "@/components/report-toolbar";
import { ChartBlock } from "@/components/charts/chart-block";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useReportRange } from "./use-report-range";


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

  // Cost by reason: which write-off bucket is eating the most money. Capped so
  // the ranking stays readable — the tail is listed in full under the table.
  const reasonBars = useMemo(() => {
    // Only buckets that carry cost can appear as a bar, so the "of N" in the
    // hint counts THAT pool — not the full bucket list, which would imply the
    // ranking cut buckets it actually just left empty-valued.
    const eligible = (report.data?.byReason ?? []).filter((g) => g.cost > 0);
    const bars = [...eligible]
      .sort((a, b) => b.cost - a.cost)
      .map((g) => ({ label: g.reason, value: round2(g.cost) }));
    return { bars, bucketCount: eligible.length };
  }, [report.data]);

  const transferRows = transfers.data?.rows ?? [];
  const { sortedRows: sortedTransferRows, sortKey: transferSortKey, sortDirection: transferSortDirection, toggleSort: toggleTransferSort } = useSort(
    transferRows,
    {
      accessors: {
        date: (r) => r.date,
        to: (r) => r.counterparty,
        item: (r) => r.name,
        qtySent: (r) => r.qtySent,
        atCost: (r) => r.costValue,
        atRetail: (r) => r.retailValue,
      },
    },
  );

  const nonRevenueRows = report.data?.rows ?? [];
  const { sortedRows: sortedNonRevenueRows, sortKey: nrSortKey, sortDirection: nrSortDirection, toggleSort: toggleNrSort } = useSort(nonRevenueRows, {
    accessors: {
      date: (r) => r.saleDate,
      item: (r) => r.name,
      uom: (r) => r.uom ?? "",
      reason: (r) => r.reason,
      qty: (r) => r.qty,
      contentPerUnit: (r) => r.contentOverride ?? -Infinity,
      estCost: (r) => r.estimatedCost ?? -Infinity,
      estRetail: (r) => r.estimatedRetail ?? -Infinity,
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
        filters={
          <>
            {/* A Select, not tabs: five long reason labels plus the date range
                can't share one row on a smaller/mobile viewport, and would wrap.
                A dropdown is the right control for this many options and keeps
                the strip one row everywhere. */}
            <ToolbarField label="Reason" htmlFor="nr-reason">
              <Select value={group} onValueChange={setGroup}>
                <SelectTrigger id="nr-reason" className="w-48 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_GROUPS}>All Reasons</SelectItem>
                  {NON_REVENUE_GROUPS.map((g) => (
                    <SelectItem key={g} value={g}>
                      {NON_REVENUE_GROUP_LABELS[g]}
                    </SelectItem>
                  ))}
                  <SelectItem value={STOCK_TRANSFER}>Stock Transfer</SelectItem>
                </SelectContent>
              </Select>
            </ToolbarField>
            <DateRangeControl from={from} to={to} onFrom={setFrom} onTo={setTo} />
          </>
        }
      >
        {transferTab ? (
          queryFailed(transfers) ? (
            <TableFailure query={transfers} title="Couldn't load stock transfers" />
          ) : transfers.isPending ? (
            <TableLoading />
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
                  <SortableTableHead sortKey="date" activeKey={transferSortKey} direction={transferSortDirection} onSort={toggleTransferSort}>
                    Date
                  </SortableTableHead>
                  <SortableTableHead sortKey="to" activeKey={transferSortKey} direction={transferSortDirection} onSort={toggleTransferSort}>
                    To
                  </SortableTableHead>
                  <SortableTableHead sortKey="item" activeKey={transferSortKey} direction={transferSortDirection} onSort={toggleTransferSort}>
                    Item
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="qtySent"
                    activeKey={transferSortKey}
                    direction={transferSortDirection}
                    onSort={toggleTransferSort}
                    className="text-right"
                  >
                    Qty Sent
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="atCost"
                    activeKey={transferSortKey}
                    direction={transferSortDirection}
                    onSort={toggleTransferSort}
                    className="text-right"
                  >
                    At Cost
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="atRetail"
                    activeKey={transferSortKey}
                    direction={transferSortDirection}
                    onSort={toggleTransferSort}
                    className="text-right"
                  >
                    At Retail
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTransferRows.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="tnum">{formatDate(row.date)}</TableCell>
                    <TableCell className="max-w-[14rem] break-words text-muted-foreground">{row.counterparty}</TableCell>
                    <TableCell className="max-w-[22rem] font-medium break-words">{row.name}</TableCell>
                    <TableCell className="tnum text-right">{formatNumber(row.qtySent)}</TableCell>
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
                  <TableCell className="tnum text-right font-medium">{formatNumber(transfers.data.totals.qty)}</TableCell>
                  <TableCell className="tnum text-right font-semibold">{formatMoney(transfers.data.totals.cost)}</TableCell>
                  <TableCell className="tnum text-right font-semibold">{formatMoney(transfers.data.totals.retail)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )
        ) : queryFailed(report) ? (
          <TableFailure query={report} />
        ) : report.isPending ? (
          <TableLoading />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty icon={Wine} title="No non-revenue use in this range" description="Adjust the dates to find recorded entries." />
        ) : (
          <>
            {reasonBars.bars.length >= 2 && (
              <ChartBlock
                title="Cost by Bucket"
                hint={`${reasonBars.bars.length} of ${reasonBars.bucketCount} buckets`}
              >
                <MagnitudeBars data={reasonBars.bars} name="Est. cost" />
              </ChartBlock>
            )}
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <SortableTableHead sortKey="date" activeKey={nrSortKey} direction={nrSortDirection} onSort={toggleNrSort}>
                    Date
                  </SortableTableHead>
                  <SortableTableHead sortKey="item" activeKey={nrSortKey} direction={nrSortDirection} onSort={toggleNrSort}>
                    Item / Menu
                  </SortableTableHead>
                  <SortableTableHead sortKey="uom" activeKey={nrSortKey} direction={nrSortDirection} onSort={toggleNrSort}>
                    UOM
                  </SortableTableHead>
                  <SortableTableHead sortKey="reason" activeKey={nrSortKey} direction={nrSortDirection} onSort={toggleNrSort}>
                    Reason
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="qty"
                    activeKey={nrSortKey}
                    direction={nrSortDirection}
                    onSort={toggleNrSort}
                    className="text-right"
                  >
                    Qty
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="contentPerUnit"
                    activeKey={nrSortKey}
                    direction={nrSortDirection}
                    onSort={toggleNrSort}
                    className="text-right"
                  >
                    Content/Unit
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="estCost"
                    activeKey={nrSortKey}
                    direction={nrSortDirection}
                    onSort={toggleNrSort}
                    className="text-right"
                  >
                    Est. Cost
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="estRetail"
                    activeKey={nrSortKey}
                    direction={nrSortDirection}
                    onSort={toggleNrSort}
                    className="text-right"
                  >
                    Est. Retail
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedNonRevenueRows.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="tnum">{formatDate(row.saleDate)}</TableCell>
                    {/* Menu names run long; wrapping keeps them fully readable
                        without pushing the money columns off-screen. */}
                    <TableCell className="max-w-[22rem] font-medium break-words">
                      {row.name}
                      {/* A non-revenue row IS the activity, so isActive === false
                          here always means a hidden item that moved — never one
                          the server could have dropped (report-lists.ts). */}
                      {row.isActive === false && (
                        <Badge variant="warning" className="ml-2">
                          hidden · active
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.uom ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.reason}</Badge>
                    </TableCell>
                    <TableCell className="tnum text-right">{formatNumber(row.qty)}</TableCell>
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
                  <TableCell className="tnum text-right font-medium">{formatNumber(report.data.totals.qty)}</TableCell>
                  <TableCell />
                  <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.cost)}</TableCell>
                  <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.retail)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </>
        )}
      </TableSurface>

      {!transferTab && report.data && report.data.rows.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-sm font-semibold">By Bucket</h3>
          <div className="flex flex-wrap gap-x-10 gap-y-3">
            {report.data.byReason.map((g) => (
              <div key={g.group}>
                <p className="text-sm font-medium">{g.reason}</p>
                <p className="tnum text-xs text-muted-foreground">
                  {g.count} entr{g.count === 1 ? "y" : "ies"} · qty {formatNumber(g.qty)}
                  {g.cost > 0 && ` · ${formatMoney(g.cost)}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
