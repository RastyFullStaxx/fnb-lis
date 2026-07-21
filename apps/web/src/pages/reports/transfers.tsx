import { useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useCountDates } from "@/api/ops";
import { exportUrl, useTransferReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, TableError, ToolbarField } from "@/components/table-surface";
import { DateRangeControl, ExportButtons } from "@/components/report-toolbar";
import { ChartBlock } from "@/components/charts/chart-block";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useReportRange } from "./use-report-range";

const n2 = (v: number) => round2(v).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function TransferReportPage() {
  const locationId = useLocationId();
  const dates = useCountDates();
  const [from, to, setFrom, setTo] = useReportRange(dates.data?.dates);
  const [direction, setDirection] = useState<"out" | "in">("out");
  const report = useTransferReport(from, to, direction);

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

  return (
    <div>
      <PageHeader
        title="Transfers Report"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "transfers", "xlsx", { from, to, direction })}
            csvUrl={exportUrl(locationId, "transfers", "csv", { from, to, direction })}
            pdfUrl={exportUrl(locationId, "transfers", "pdf", { from, to, direction })}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <TableSurface
        className="max-h-[70vh]"
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
            <DateRangeControl from={from} to={to} onFrom={setFrom} onTo={setTo} />
          </>
        }
      >
        {report.isPending ? (
          <TableLoading />
        ) : report.isError ? (
          <TableError onRetry={() => void report.refetch()} retrying={report.isRefetching} />
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
                    : "At cost — everything dispatched arrived"
                }
              >
                <MagnitudeBars data={movement.bars} name="At cost" />
              </ChartBlock>
            )}
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead>Date</TableHead>
                  <TableHead>{direction === "out" ? "To" : "From"}</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                  <TableHead className="text-right">At Cost</TableHead>
                  <TableHead className="text-right">At Retail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.rows.map((row, i) => {
                  const short = row.qtyReceived !== null && row.qtyReceived < row.qtySent;
                  return (
                    <TableRow key={i}>
                      <TableCell className="tnum">{row.date}</TableCell>
                      <TableCell className="text-muted-foreground">{row.counterparty}</TableCell>
                      <TableCell className="max-w-[22rem] font-medium break-words">{row.name}</TableCell>
                      <TableCell className="tnum text-right">{n2(row.qtySent)}</TableCell>
                      <TableCell className={cn("tnum text-right", short && "font-medium text-destructive")}>
                        {row.qtyReceived === null ? (
                          <span className="text-muted-foreground">pending</span>
                        ) : (
                          n2(row.qtyReceived)
                        )}
                      </TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.unitCost)}</TableCell>
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
                    {direction === "out" ? n2(report.data.totals.qty) : ""}
                  </TableCell>
                  <TableCell className="tnum text-right font-medium">
                    {direction === "in" ? n2(report.data.totals.qty) : ""}
                  </TableCell>
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
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">At Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.data.byCounterparty.map((g) => (
                <TableRow key={g.counterparty}>
                  <TableCell className="font-medium">{g.counterparty}</TableCell>
                  <TableCell className="tnum text-right">{n2(g.qty)}</TableCell>
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
