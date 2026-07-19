import { useMemo, useState } from "react";
import { PieChart } from "lucide-react";
import { round2 } from "@fnb/core";
import { useCountDates } from "@/api/ops";
import { useLocationId } from "@/api/location";
import { exportUrl, useCostAnalysisReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TableLoading } from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
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

export function CostAnalysisPage() {
  const locationId = useLocationId();
  const countDates = useCountDates();
  const [begin, setBegin] = useState<string | undefined>(undefined);
  const [end, setEnd] = useState<string | undefined>(undefined);

  const dates = countDates.data?.dates ?? [];
  const effectiveBegin = begin ?? (dates.length >= 2 ? dates[dates.length - 2] : undefined);
  const effectiveEnd = end ?? (dates.length >= 2 ? dates[dates.length - 1] : undefined);
  const endOptions = useMemo(() => dates.filter((d) => !effectiveBegin || d > effectiveBegin), [dates, effectiveBegin]);

  const report = useCostAnalysisReport(effectiveBegin, effectiveEnd);

  if (countDates.isPending) return <Skeleton className="h-96 w-full" />;

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

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5">
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
      </div>

      {report.isPending ? (
        <TableLoading rows={8} />
      ) : !report.data ? null : (
        <div className="space-y-8">
          {/* Sales summary */}
          <div className="rounded-lg border">
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
                  <TableCell className="font-medium">Total sales</TableCell>
                  <TableCell className="tnum text-right font-semibold">
                    {formatMoney(round2(report.data.sales.totalGross))}
                  </TableCell>
                  <TableCell className="tnum text-right font-semibold">
                    {formatMoney(round2(report.data.sales.totalNet))}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          {/* One cost section per product type — beverage & food side by side (req #3). */}
          {report.data.sections.map((section) => (
            <div key={section.productType}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide">
                {section.productType} cost analysis
              </h3>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted hover:bg-muted">
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Beginning</TableHead>
                      <TableHead className="text-right">Purchases</TableHead>
                      <TableHead className="text-right">Ending</TableHead>
                      <TableHead className="text-right font-semibold">Cost</TableHead>
                      <TableHead className="text-right">Cost Net</TableHead>
                      <TableHead className="text-right">GROSS %</TableHead>
                      <TableHead className="text-right">NET %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {section.rows.map((row) => (
                      <TableRow key={row.category}>
                        <TableCell className="font-medium">{row.category}</TableCell>
                        <TableCell className="tnum text-right">{formatMoney(round2(row.beginningCost))}</TableCell>
                        <TableCell className="tnum text-right">{formatMoney(round2(row.purchasesCost))}</TableCell>
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
                      <TableCell className="tnum text-right font-medium">{formatMoney(round2(section.totals.endingCost))}</TableCell>
                      <TableCell className="tnum text-right font-semibold">{formatMoney(round2(section.totals.cost))}</TableCell>
                      <TableCell className="tnum text-right font-medium">{formatMoney(round2(section.totals.costNet))}</TableCell>
                      <TableCell className="tnum text-right font-semibold">{pct(section.totals.grossPct)}</TableCell>
                      <TableCell className="tnum text-right font-semibold">{pct(section.totals.netPct)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
