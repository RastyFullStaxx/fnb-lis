import { useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { convert, formatQty, round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useMe } from "@/api/auth";
import { useCountDates } from "@/api/ops";
import { exportUrl, useTransferReport } from "@/api/reports";
import { useItemDisplayUnit } from "@/lib/preferences";
import { formatMoney, formatNumber, formatDate, formatUnitPrice } from "@/lib/utils";
import { useSort } from "@/hooks/use-sort";
import { PageHeader } from "@/components/page-header";
import { TableEmpty, TableFailure, TableLoading, TableSurface, ToolbarField, queryFailed } from "@/components/table-surface";
import { DateRangeControl, ExportButtons } from "@/components/report-toolbar";
import { ChartBlock } from "@/components/charts/chart-block";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { cn } from "@/lib/utils";
import { useReportRange } from "./use-report-range";


const ALL_BRANCHES = "__all__";

export function TransferReportPage() {
  const locationId = useLocationId();
  const dates = useCountDates();
  const me = useMe();
  const [from, to, setFrom, setTo] = useReportRange(dates.data?.dates);
  const [direction, setDirection] = useState<"out" | "in">("out");
  // Which branch this report is for (client req 2026-07-25: "Main to branches —
  // must select Main to branches accounts"). Same sibling-location list the
  // Transfers screen uses to pick a destination.
  const [branch, setBranch] = useState(ALL_BRANCHES);
  const branches = useMemo(() => {
    const client = me.data?.clients.find((c) => c.locations.some((l) => l.id === locationId));
    return (client?.locations ?? []).filter((l) => l.id !== locationId);
  }, [me.data, locationId]);
  const counterparty = branch === ALL_BRANCHES ? "" : branch;
  const report = useTransferReport(from, to, direction, true, counterparty);

  // Dispatched vs received at cost — the signature transfer metric. The gap
  // between the two bars is stock that left one location and never arrived at
  // the other: the leakage the linked-transfer design exists to surface. Always
  // two bars, so it draws even for a single transfer — unlike a by-counterparty
  // ranking, which needs ≥2 destinations and so never rendered for a client
  // that only ships to one stockroom.
  const movement = useMemo(() => {
    let dispatched = 0;
    let received = 0;
    for (const r of report.data?.rows ?? []) {
      dispatched += r.qtySent * r.unitCost;
      received += (r.qtyReceived ?? 0) * r.unitCost;
    }
    return {
      bars: [
        { label: "Dispatched", value: round2(dispatched) },
        { label: "Received", value: round2(received) },
      ],
      hasValue: dispatched > 0 || received > 0,
      shortfall: round2(dispatched - received),
    };
  }, [report.data]);

  // Per-item display unit resolver (report-uom-plan.md, "On screen") — Sent
  // and Received share one resolved unit per row, same scope as the export
  // route's convertRowsForExport(rows, ["qtySent", "qtyReceived"]).
  const allItemIds = useMemo(
    () => Array.from(new Set((report.data?.rows ?? []).map((r) => r.itemId))),
    [report.data],
  );
  const { resolve: resolveDisplay } = useItemDisplayUnit(allItemIds);

  const transferRows = report.data?.rows ?? [];
  const { sortedRows, sortKey, sortDirection, toggleSort } = useSort(transferRows, {
    accessors: {
      date: (r) => r.date,
      counterparty: (r) => r.counterparty,
      item: (r) => r.name,
      sent: (r) => r.qtySent,
      received: (r) => r.qtyReceived ?? -Infinity,
      unitCost: (r) => r.unitCost,
      atCost: (r) => r.costValue,
      atRetail: (r) => r.retailValue,
    },
  });

  const byCounterpartyRows = report.data?.byCounterparty ?? [];
  const { sortedRows: sortedByCounterparty, sortKey: byCounterpartySortKey, sortDirection: byCounterpartySortDirection, toggleSort: toggleByCounterpartySort } = useSort(
    byCounterpartyRows,
    {
      accessors: {
        location: (g) => g.counterparty,
        qty: (g) => g.qty,
        cost: (g) => g.cost,
      },
    },
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Transfers Report"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "transfers", "xlsx", { from, to, direction, ...(counterparty ? { counterparty } : {}) })}
            csvUrl={exportUrl(locationId, "transfers", "csv", { from, to, direction, ...(counterparty ? { counterparty } : {}) })}
            pdfUrl={exportUrl(locationId, "transfers", "pdf", { from, to, direction, ...(counterparty ? { counterparty } : {}) })}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarField label="Direction">
              <Tabs value={direction} onValueChange={(v) => setDirection(v as "out" | "in")}>
                <TabsList>
                  <TabsTrigger value="out">Out (Dispatched)</TabsTrigger>
                  <TabsTrigger value="in">In (Received)</TabsTrigger>
                </TabsList>
              </Tabs>
            </ToolbarField>
            {branches.length > 0 && (
              <ToolbarField label={direction === "out" ? "To Branch" : "From Branch"} htmlFor="tr-branch">
                <Select value={branch} onValueChange={setBranch}>
                  <SelectTrigger id="tr-branch" className="w-44 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_BRANCHES}>All Branches</SelectItem>
                    {branches.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ToolbarField>
            )}
            <DateRangeControl from={from} to={to} onFrom={setFrom} onTo={setTo} />
          </>
        }
      >
        {queryFailed(report) ? (
          <TableFailure query={report} />
        ) : report.isPending ? (
          <TableLoading />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty
            icon={ArrowLeftRight}
            title={direction === "out" ? "Nothing dispatched in this range" : "Nothing received in this range"}
            description="Adjust the dates, or check the Transfers screen for drafts awaiting commit."
          />
        ) : (
          <>
            {movement.hasValue && (
              <ChartBlock
                title="Dispatched vs Received"
                hint={
                  movement.shortfall > 0
                    ? `${formatMoney(movement.shortfall)} at cost didn't arrive`
                    : "At cost: everything dispatched arrived"
                }
              >
                <MagnitudeBars data={movement.bars} name="At cost" />
              </ChartBlock>
            )}
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <SortableTableHead sortKey="date" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                    Date
                  </SortableTableHead>
                  <SortableTableHead sortKey="counterparty" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                    {direction === "out" ? "To" : "From"}
                  </SortableTableHead>
                  <SortableTableHead sortKey="item" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                    Item
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="sent"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={toggleSort}
                    className="text-right"
                  >
                    Sent
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="received"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={toggleSort}
                    className="text-right"
                  >
                    Received
                  </SortableTableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <SortableTableHead
                    sortKey="unitCost"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={toggleSort}
                    className="text-right"
                  >
                    Unit Cost
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="atCost"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={toggleSort}
                    className="text-right"
                  >
                    At Cost
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="atRetail"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={toggleSort}
                    className="text-right"
                  >
                    At Retail
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((row, i) => {
                  const short = row.qtyReceived !== null && row.qtyReceived < row.qtySent;
                  const itemUnit = { id: row.unitName, name: row.unitName, kind: row.unitKind, factorToBase: row.unitFactorToBase };
                  const displayUnit = resolveDisplay(row.itemId, itemUnit) ?? itemUnit;
                  const convertQty = (q: number) => (displayUnit.kind === itemUnit.kind ? convert(q, itemUnit, displayUnit) : q);
                  return (
                    <TableRow key={i}>
                      <TableCell className="tnum">{formatDate(row.date)}</TableCell>
                      <TableCell className="text-muted-foreground">{row.counterparty}</TableCell>
                      <TableCell className="max-w-[22rem] font-medium break-words">{row.name}</TableCell>
                      <TableCell className="tnum text-right">{formatQty(convertQty(row.qtySent))}</TableCell>
                      <TableCell className={cn("tnum text-right", short && "font-medium text-destructive")}>
                        {row.qtyReceived === null ? (
                          <span className="text-muted-foreground">pending</span>
                        ) : (
                          formatQty(convertQty(row.qtyReceived))
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{displayUnit.name}</TableCell>
                      <TableCell className="tnum text-right">{formatUnitPrice(row.unitCost)}</TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.costValue)}</TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.retailValue)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="font-medium">
                    Total
                  </TableCell>
                  <TableCell className="tnum text-right font-medium">
                    {direction === "out" ? formatNumber(report.data.totals.qty) : ""}
                  </TableCell>
                  <TableCell className="tnum text-right font-medium">
                    {direction === "in" ? formatNumber(report.data.totals.qty) : ""}
                  </TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.cost)}</TableCell>
                  <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.retail)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </>
        )}
      </TableSurface>

      {report.data && report.data.rows.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-2 text-sm font-semibold">{direction === "out" ? "By destination" : "By source"}</h3>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortableTableHead sortKey="location" activeKey={byCounterpartySortKey} direction={byCounterpartySortDirection} onSort={toggleByCounterpartySort}>
                  Location
                </SortableTableHead>
                <SortableTableHead
                  sortKey="qty"
                  activeKey={byCounterpartySortKey}
                  direction={byCounterpartySortDirection}
                  onSort={toggleByCounterpartySort}
                  className="text-right"
                >
                  Qty
                </SortableTableHead>
                <SortableTableHead
                  sortKey="cost"
                  activeKey={byCounterpartySortKey}
                  direction={byCounterpartySortDirection}
                  onSort={toggleByCounterpartySort}
                  className="text-right"
                >
                  At Cost
                </SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedByCounterparty.map((g) => (
                <TableRow key={g.counterparty}>
                  <TableCell className="font-medium">{g.counterparty}</TableCell>
                  <TableCell className="tnum text-right">{formatNumber(g.qty)}</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(g.cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
