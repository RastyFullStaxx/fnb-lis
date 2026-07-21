import { useMemo, useState } from "react";
import { ShoppingCart } from "lucide-react";
import { PAYMENT_TERMS_LABELS, round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useCountDates } from "@/api/ops";
import { exportUrl, usePurchaseReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, TableError, ToolbarSearch } from "@/components/table-surface";
import { DateRangeControl, ExportButtons } from "@/components/report-toolbar";
import { ChartBlock } from "@/components/charts/chart-block";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
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

/** Bars stay readable up to ~8 rows — fold the long tail into "Other". */
const SUPPLIER_BAR_CAP = 7;

export function PurchaseReportPage() {
  const locationId = useLocationId();
  const dates = useCountDates();
  const [from, to, setFrom, setTo] = useReportRange(dates.data?.dates);
  const report = usePurchaseReport(from, to);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const all = report.data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return q
      ? all.filter((r) => r.name.toLowerCase().includes(q) || r.supplier.toLowerCase().includes(q))
      : all;
  }, [report.data, query]);

  const supplierBars = useMemo(() => {
    const bySupplier = report.data?.bySupplier ?? [];
    const head = bySupplier.slice(0, SUPPLIER_BAR_CAP).map((s) => ({ label: s.supplier, value: round2(s.cost) }));
    const tail = bySupplier.slice(SUPPLIER_BAR_CAP);
    if (tail.length > 0) {
      head.push({ label: `Other (${tail.length})`, value: round2(tail.reduce((n, s) => n + s.cost, 0)) });
    }
    return head;
  }, [report.data]);

  return (
    <div>
      <PageHeader
        title="Purchase Report"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "purchases", "xlsx", { from, to })}
            csvUrl={exportUrl(locationId, "purchases", "csv", { from, to })}
            pdfUrl={exportUrl(locationId, "purchases", "pdf", { from, to })}
            disabled={!report.data?.rows.length}
          />
        }
      />

      <TableSurface
        className="max-h-[70vh]"
        filters={
          <>
            <ToolbarSearch label="Search" value={query} onChange={setQuery} placeholder="Find an item or supplier…" />
            <DateRangeControl from={from} to={to} onFrom={setFrom} onTo={setTo} />
          </>
        }
      >
        {report.isPending ? (
          <TableLoading />
        ) : report.isError ? (
          <TableError onRetry={() => void report.refetch()} retrying={report.isRefetching} />
        ) : !report.data || report.data.rows.length === 0 ? (
          <TableEmpty icon={ShoppingCart} title="No purchases in this range" description="Adjust the dates to find committed deliveries." />
        ) : (
          <>
            {/* Ranks the whole range, not the search result — the search narrows
                the ledger below, never the spend picture it sits under. */}
            {supplierBars.length >= 2 && (
              <ChartBlock
                title="Cost by Supplier"
                hint={
                  report.data.bySupplier.length > SUPPLIER_BAR_CAP
                    ? `Top ${SUPPLIER_BAR_CAP} of ${report.data.bySupplier.length} suppliers`
                    : undefined
                }
              >
                <MagnitudeBars data={supplierBars} name="Cost" />
              </ChartBlock>
            )}
            {rows.length === 0 ? (
              <TableEmpty icon={ShoppingCart} title="No rows match the search" description="Try a different item or supplier name." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead>Date</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                    <TableHead className="text-right">Line Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="tnum">{row.purchaseDate}</TableCell>
                      <TableCell className="max-w-[18rem] break-words text-muted-foreground">
                        {row.supplier}
                        {row.refNo && <span className="ml-1.5 text-xs">({row.refNo})</span>}
                      </TableCell>
                      <TableCell className="max-w-[22rem] break-words font-medium">{row.name}</TableCell>
                      <TableCell className="tnum text-right">{n2(row.qty)}</TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.unitCost)}</TableCell>
                      <TableCell className="tnum text-right">{formatMoney(row.lineTotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {query.trim() === "" && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3} className="font-medium">
                        Total
                      </TableCell>
                      <TableCell className="tnum text-right font-medium">{n2(report.data.totals.qty)}</TableCell>
                      <TableCell />
                      <TableCell className="tnum text-right font-semibold">{formatMoney(report.data.totals.cost)}</TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            )}
          </>
        )}
      </TableSurface>

      {report.data && report.data.rows.length > 0 && (
        <div className="mt-8">
          {/* Contact + payment terms per supplier (client req 2026-07-20):
              who to call, and when the invoice falls due. */}
          <h3 className="mb-2 text-sm font-semibold">By Supplier</h3>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Supplier</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Terms</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.data.bySupplier.map((s) => (
                <TableRow key={s.supplier}>
                  <TableCell className="max-w-[18rem] break-words font-medium">
                    {s.supplier}
                    {s.email && <span className="block text-xs text-muted-foreground">{s.email}</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.contactPerson || "—"}</TableCell>
                  <TableCell className="tnum text-muted-foreground">{s.phone || "—"}</TableCell>
                  <TableCell>
                    {s.paymentTerms ? (
                      <Badge variant="outline">{PAYMENT_TERMS_LABELS[s.paymentTerms]}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="tnum text-right">{n2(s.qty)}</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(s.cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
