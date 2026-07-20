import { useMemo, useState } from "react";
import { PieChart } from "lucide-react";
import { round2 } from "@fnb/core";
import { useCountDates } from "@/api/ops";
import { useLocationId } from "@/api/location";
import { exportUrl, useCostAnalysisReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TableSurface, TableLoading, TableError } from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
import { Label } from "@/components/ui/label";
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
import { Skeleton } from "@/components/ui/skeleton";

const pct = (v: number | null) => (v === null ? "—" : `${round2(v).toFixed(2)}%`);
const pctShort = (v: number) => `${round2(v).toFixed(1)}%`;

export function CostAnalysisPage() {
  const locationId = useLocationId();
  const countDates = useCountDates();
  const [begin, setBegin] = useState<string | undefined>(undefined);
  const [end, setEnd] = useState<string | undefined>(undefined);

  const dates = countDates.data?.dates ?? [];
  const effectiveBegin = begin ?? (dates.length >= 2 ? dates[dates.length - 2] : undefined);
  const endOptions = useMemo(() => dates.filter((d) => !effectiveBegin || d > effectiveBegin), [dates, effectiveBegin]);
  // Fall back to the latest count date AFTER the beginning — picking the
  // newest date as "Beginning" must not silently fire a begin==end request.
  const effectiveEnd = end ?? endOptions.at(-1);

  const report = useCostAnalysisReport(effectiveBegin, effectiveEnd);

  if (countDates.isPending) {
    return (
      <div>
        <PageHeader title="Cost Analysis" />
        <div className="overflow-hidden rounded-lg border">
          <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2.5">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-40" />
          </div>
          <TableLoading rows={6} />
        </div>
      </div>
    );
  }

  if (dates.length < 2) {
    return (
      <div>
        <PageHeader title="Cost Analysis" />
        <EmptyState
          icon={PieChart}
          title="Two committed counts unlock this report"
          description="Cost Analysis reads beginning and ending inventory cost from committed counts, plus the purchases between them."
        />
      </div>
    );
  }

  const periodPicker = (
    <>
      <Label htmlFor="ca-begin" className="text-xs text-muted-foreground">Beginning</Label>
      <Select value={effectiveBegin} onValueChange={(v) => { setBegin(v); if (effectiveEnd && effectiveEnd <= v) setEnd(undefined); }}>
        <SelectTrigger id="ca-begin" className="tnum w-40 bg-background">
          <SelectValue placeholder="Pick a date" />
        </SelectTrigger>
        <SelectContent>
          {dates.map((d) => (
            <SelectItem key={d} value={d} className="tnum">{d}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Label htmlFor="ca-end" className="text-xs text-muted-foreground">Ending</Label>
      <Select value={effectiveEnd} onValueChange={setEnd}>
        <SelectTrigger id="ca-end" className="tnum w-40 bg-background">
          <SelectValue placeholder="Pick a date" />
        </SelectTrigger>
        <SelectContent>
          {endOptions.map((d) => (
            <SelectItem key={d} value={d} className="tnum">{d}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  return (
    <div>
      <PageHeader
        title="Cost Analysis"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "cost-analysis", "xlsx", { begin: effectiveBegin ?? "", end: effectiveEnd ?? "" })}
            csvUrl={exportUrl(locationId, "cost-analysis", "csv", { begin: effectiveBegin ?? "", end: effectiveEnd ?? "" })}
            disabled={!report.data?.sections.length}
          />
        }
      />

      {/* One surface: the period picker is fused to the sales summary, never a
          strip floating in the gap (DESIGN.md page skeleton). */}
      <TableSurface filters={periodPicker}>
        {!effectiveBegin || !effectiveEnd ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            Pick a beginning count and a later ending count to run the analysis.
          </p>
        ) : report.isPending ? (
          <TableLoading rows={5} />
        ) : report.isError ? (
          <TableError onRetry={() => void report.refetch()} retrying={report.isRefetching} />
        ) : !report.data ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            Could not build the report for this period — pick a different pair of count dates.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Sales</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Net (÷1.12)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.data.sales.byType.map((t) => (
                <TableRow key={t.productType}>
                  <TableCell>{t.productType} gross sales</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(round2(t.gross))}</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(round2(t.net))}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="text-muted-foreground">VAT amount (gross − net)</TableCell>
                <TableCell className="tnum text-right text-muted-foreground">
                  {formatMoney(round2(report.data.sales.vatAmount))}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">Total Sales</TableCell>
                <TableCell className="tnum text-right font-semibold">
                  {formatMoney(round2(report.data.sales.totalGross))}
                </TableCell>
                <TableCell className="tnum text-right font-semibold">
                  {formatMoney(round2(report.data.sales.totalNet))}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </TableSurface>

      {/* One flat section per product type — beverage & food (req #3): a small
          heading + bare table, never a second bordered card. */}
      {report.data && effectiveBegin && effectiveEnd
        ? report.data.sections.map((section) => {
            const pctBars = section.rows
              .filter((row) => row.netPct !== null && row.netPct > 0)
              .map((row) => ({ label: row.category, value: round2(row.netPct!) }));
            return (
              <div key={section.productType} className="mt-8">
                <h3 className="mb-2 text-sm font-semibold">
                  {section.productType.charAt(0) + section.productType.slice(1).toLowerCase()} cost analysis
                </h3>
                {pctBars.length >= 2 && (
                  <div className="mb-4 max-w-xl">
                    <p className="text-xs font-medium text-muted-foreground">
                      Net cost as a share of net sales
                      {section.totals.netPct !== null ? ` — section total ${pctShort(section.totals.netPct)}` : ""}
                    </p>
                    <div className="mt-2">
                      <MagnitudeBars
                        data={pctBars}
                        name="Net cost %"
                        formatter={(v) => pct(v)}
                        endLabelFormatter={pctShort}
                      />
                    </div>
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted hover:bg-muted">
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Beginning</TableHead>
                      <TableHead className="text-right">Purchases</TableHead>
                      <TableHead className="text-right">Transfers</TableHead>
                      <TableHead className="text-right">Ending</TableHead>
                      <TableHead className="text-right font-semibold">Cost</TableHead>
                      <TableHead className="text-right">Cost Net</TableHead>
                      <TableHead className="text-right">Gross %</TableHead>
                      <TableHead className="text-right">Net %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {section.rows.map((row) => (
                      <TableRow key={row.category}>
                        <TableCell className="font-medium">{row.category}</TableCell>
                        <TableCell className="tnum text-right">{formatMoney(round2(row.beginningCost))}</TableCell>
                        <TableCell className="tnum text-right">{formatMoney(round2(row.purchasesCost))}</TableCell>
                        <TableCell className="tnum text-right">
                          {row.transfersCost === 0 ? "—" : formatMoney(round2(row.transfersCost))}
                        </TableCell>
                        <TableCell className="tnum text-right">{formatMoney(round2(row.endingCost))}</TableCell>
                        <TableCell className="tnum text-right font-medium">{formatMoney(round2(row.cost))}</TableCell>
                        <TableCell className="tnum text-right">{formatMoney(round2(row.costNet))}</TableCell>
                        <TableCell className="tnum text-right">{pct(row.grossPct)}</TableCell>
                        <TableCell className="tnum text-right">{pct(row.netPct)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-medium">Total</TableCell>
                      <TableCell className="tnum text-right font-medium">{formatMoney(round2(section.totals.beginningCost))}</TableCell>
                      <TableCell className="tnum text-right font-medium">{formatMoney(round2(section.totals.purchasesCost))}</TableCell>
                      <TableCell className="tnum text-right font-medium">
                        {section.totals.transfersCost === 0 ? "—" : formatMoney(round2(section.totals.transfersCost))}
                      </TableCell>
                      <TableCell className="tnum text-right font-medium">{formatMoney(round2(section.totals.endingCost))}</TableCell>
                      <TableCell className="tnum text-right font-semibold">{formatMoney(round2(section.totals.cost))}</TableCell>
                      <TableCell className="tnum text-right font-medium">{formatMoney(round2(section.totals.costNet))}</TableCell>
                      <TableCell className="tnum text-right font-semibold">{pct(section.totals.grossPct)}</TableCell>
                      <TableCell className="tnum text-right font-semibold">{pct(section.totals.netPct)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            );
          })
        : null}
    </div>
  );
}
