import { Fragment, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { MATERIAL_VARIANCE_PCT, round2, varianceSeverity } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useCountDates } from "@/api/ops";
import { useVarianceThreshold } from "@/api/settings";
import { useMe } from "@/api/auth";
import { exportUrl, useLegacyAuditReport, type LegacyAuditRow } from "@/api/reports";
import { formatMoney, cn, formatNumber, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TableFailure, TableLoading, ToolbarField, queryFailed } from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";


type Variant = "detailed" | "inventory";

/**
 * The 24 legacy columns, in the client's own order. Kept as one spec so the
 * header row and the body can never drift — the same discipline the export's
 * LEGACY_HEADERS / legacyRowCells pair uses (services/exports-suite.ts).
 * `money` marks the peso columns (legacy LEGACY_MONEY_COLS); the rest are
 * quantities.
 */
const COLUMNS: Array<{ header: string; money?: true; value: (r: LegacyAuditRow) => number | null }> = [
  { header: "Begin Full", value: (r) => r.beginFull },
  { header: "Begin Open", value: (r) => r.beginOpen },
  { header: "B-Cost", money: true, value: (r) => r.bCost },
  { header: "Purchased", value: (r) => r.purchased },
  { header: "Cost of Purchase", money: true, value: (r) => r.purchasedCost },
  { header: "F", value: (r) => r.forfeited },
  { header: "End Full", value: (r) => r.endFull },
  { header: "End Open", value: (r) => r.endOpen },
  { header: "E-Cost", money: true, value: (r) => r.eCost },
  { header: "Usage", value: (r) => r.usage },
  { header: "Cost of Usage", money: true, value: (r) => r.costOfUsage },
  { header: "Shot", value: (r) => r.shot },
  { header: "Bottle", value: (r) => r.bottle },
  { header: "Cost of Sold", money: true, value: (r) => r.costOfSold },
  { header: "Revenue", money: true, value: (r) => r.revenue },
  { header: "Used vs Sales", value: (r) => r.usedVsSales },
  { header: "Non Rev Usage", value: (r) => r.nonRevUsage },
  { header: "Non Rev Cost", money: true, value: (r) => r.nonRevCost },
  { header: "Over/Short", value: (r) => r.overallVariance },
  { header: "%Over/Short", value: (r) => r.variancePct },
  { header: "Cost", money: true, value: (r) => r.varianceCost },
  { header: "At Retail", money: true, value: (r) => r.varianceRetail },
];

/** Column groups above the leaf headers — the legacy report's banded look. */
const GROUPS: Array<[string, number]> = [
  ["", 1],
  ["Beginning Inventory", 2],
  ["", 1],
  ["Purchased", 2],
  ["", 1],
  ["Ending Inventory", 2],
  ["", 1],
  ["Usage", 2],
  ["Sales", 2],
  ["", 2],
  ["Variance", 3],
  ["Overall Variance", 4],
];

/**
 * The client's legacy "Full Audit Report By Category" rendered on screen
 * (client req 2026-07-25 — he sent a screenshot of the old system and asked us
 * to match it). Same numbers, same 24 columns and same category banding as the
 * Detailed/Inventory downloads: this page and those files are both projections
 * of legacyAuditReport(), so they cannot disagree.
 */
export function LegacyAuditPage() {
  const locationId = useLocationId();
  const me = useMe();
  const countDates = useCountDates();
  const [begin, setBegin] = useState<string>();
  const [end, setEnd] = useState<string>();
  const [variant, setVariant] = useState<Variant>("detailed");

  const dates = countDates.data?.dates ?? [];
  const effectiveBegin = begin ?? (dates.length >= 2 ? dates[dates.length - 2] : undefined);
  const effectiveEnd = end ?? (dates.length >= 2 ? dates[dates.length - 1] : undefined);
  const endOptions = useMemo(() => dates.filter((d) => !effectiveBegin || d > effectiveBegin), [dates, effectiveBegin]);

  const report = useLegacyAuditReport(effectiveBegin ?? "", effectiveEnd ?? "", variant);

  const location = me.data?.clients.flatMap((c) => c.locations).find((l) => l.id === locationId);
  const threshold = useVarianceThreshold(location?.clientId ?? "");
  const thresholdPct = threshold.data?.varianceThresholdPct ?? MATERIAL_VARIANCE_PCT;

  const exportParams = { begin: effectiveBegin ?? "", end: effectiveEnd ?? "", variant };

  if (countDates.isPending) {
    return (
      <div>
        <PageHeader title="Full Audit by Category" />
        <TableLoading rows={10} />
      </div>
    );
  }

  if (dates.length < 2) {
    return (
      <div>
        <PageHeader title="Full Audit by Category" />
        <EmptyState
          icon={BarChart3}
          title="Two committed counts unlock this report"
          description="This is the reconciliation between a beginning and an ending count. Commit a count, record the period's activity, then count again."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Full Audit by Category"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "legacy-audit", "xlsx", exportParams)}
            csvUrl={exportUrl(locationId, "legacy-audit", "csv", exportParams)}
            pdfUrl={exportUrl(locationId, "legacy-audit", "pdf", exportParams)}
            onPrint={() => window.print()}
            disabled={!report.data?.groups.length}
          />
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
        <div className="flex shrink-0 flex-wrap items-end gap-x-3 gap-y-2 border-b bg-muted/30 px-3 py-2.5 print:hidden">
          <ToolbarField label="Report">
            <Tabs value={variant} onValueChange={(v) => setVariant(v as Variant)}>
              <TabsList>
                <TabsTrigger value="detailed">Detailed</TabsTrigger>
                <TabsTrigger value="inventory">Inventory</TabsTrigger>
              </TabsList>
            </Tabs>
          </ToolbarField>
          <ToolbarField label="Beginning" htmlFor="la-begin">
            <Select
              value={effectiveBegin}
              onValueChange={(v) => {
                setBegin(v);
                if (effectiveEnd && effectiveEnd <= v) setEnd(undefined);
              }}
            >
              <SelectTrigger id="la-begin" className="tnum w-32 bg-background">
                <SelectValue placeholder="Pick a date" />
              </SelectTrigger>
              <SelectContent>
                {dates.map((d) => (
                  <SelectItem key={d} value={d} className="tnum">{formatDate(d)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ToolbarField>
          <ToolbarField label="Ending" htmlFor="la-end">
            <Select value={effectiveEnd} onValueChange={setEnd}>
              <SelectTrigger id="la-end" className="tnum w-32 bg-background">
                <SelectValue placeholder="Pick a date" />
              </SelectTrigger>
              <SelectContent>
                {endOptions.map((d) => (
                  <SelectItem key={d} value={d} className="tnum">{formatDate(d)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ToolbarField>
          {/* The legacy report's headline badge: cost of sold (Detailed) or of
              usage (Inventory) over revenue. */}
          {report.data?.costRatio !== null && report.data !== undefined && (
            <div className="ml-auto shrink-0 pb-0.5">
              <Badge variant="warning" className="text-sm">
                {variant === "detailed" ? "Cost of Sold" : "Cost"} Ratio{" "}
                {/* costRatio is a FRACTION (cost ÷ revenue). It was rendered
                    straight with a "%" appended, so a 33.79% beverage cost read
                    as "0.34%" — off by 100 on the one number this report exists
                    for. The exports label it "(cost of sold / revenue)" and
                    write the raw fraction, which is honest; the screen quotes
                    the percentage, which is how F&B actually talks about it. */}
                {formatNumber((report.data.costRatio ?? 0) * 100)}%
              </Badge>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {queryFailed(report) ? (
            <TableFailure query={report} />
          ) : report.isPending ? (
            <TableLoading rows={10} />
          ) : !report.data || report.data.groups.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No activity or counts in this period"
              description="Pick different boundary dates, or check that the counts were committed."
            />
          ) : (
            <Table className="border-separate border-spacing-0 text-xs [&_td]:border-b [&_td]:px-1.5 [&_th]:border-b [&_th]:px-1.5">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {GROUPS.map(([label, span], i) => (
                    <TableHead
                      key={i}
                      colSpan={span}
                      className={cn(
                        "sticky top-0 z-20 bg-muted text-center text-[11px] font-medium text-muted-foreground",
                        i > 0 && "border-l",
                      )}
                    >
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky left-0 top-8 z-30 min-w-[12rem] bg-muted">Product Name</TableHead>
                  <TableHead className="sticky top-8 z-20 border-l bg-muted">Size/UOM</TableHead>
                  {COLUMNS.map((c) => (
                    <TableHead key={c.header} className="sticky top-8 z-20 bg-muted text-right whitespace-nowrap">
                      {c.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.groups.map((group) => (
                  <Fragment key={group.categoryName}>
                    <TableRow className="bg-secondary/60 hover:bg-secondary/60">
                      <TableCell
                        colSpan={COLUMNS.length + 2}
                        className="py-1 text-[11px] font-semibold uppercase tracking-wide text-secondary-foreground"
                      >
                        {group.categoryName}
                      </TableCell>
                    </TableRow>
                    {group.rows.map((row, i) => {
                      // Same materiality highlight as the Full Audit and the
                      // downloads: material short red, material over amber.
                      const sev = varianceSeverity(
                        { variance: row.overallVariance, variancePct: row.variancePct, contentTracked: row.contentTracked },
                        thresholdPct,
                      );
                      return (
                        <TableRow
                          key={`${group.categoryName}-${i}`}
                          className={cn(
                            sev === "short" && "bg-destructive/5",
                            sev === "over" && "bg-warning/10",
                          )}
                        >
                          <TableCell className="sticky left-0 z-10 max-w-[14rem] break-words bg-inherit font-medium">
                            {row.productName}
                          </TableCell>
                          <TableCell className="border-l whitespace-nowrap text-muted-foreground">{row.sizeUom}</TableCell>
                          {COLUMNS.map((c) => {
                            const v = c.value(row);
                            return (
                              <TableCell key={c.header} className="tnum text-right whitespace-nowrap">
                                {v === null ? "—" : c.money ? formatMoney(round2(v)) : formatNumber(v)}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted/50 font-medium hover:bg-muted/50">
                      <TableCell className="sticky left-0 z-10 bg-muted/50 uppercase">
                        {group.categoryName} total
                      </TableCell>
                      <TableCell className="border-l" />
                      {COLUMNS.map((c) => {
                        const v = c.header === "%Over/Short" ? null : c.value(group.totals as unknown as LegacyAuditRow);
                        return (
                          <TableCell key={c.header} className="tnum text-right whitespace-nowrap">
                            {v === null ? "" : c.money ? formatMoney(round2(v)) : formatNumber(v)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  </Fragment>
                ))}
                <TableRow className="bg-muted font-semibold hover:bg-muted [&_td]:border-t-2">
                  <TableCell className="sticky left-0 z-10 bg-muted">GRAND TOTAL</TableCell>
                  <TableCell className="border-l" />
                  {COLUMNS.map((c) => {
                    const v = c.header === "%Over/Short" ? null : c.value(report.data.totals as unknown as LegacyAuditRow);
                    return (
                      <TableCell key={c.header} className="tnum text-right whitespace-nowrap">
                        {v === null ? "" : c.money ? formatMoney(round2(v)) : formatNumber(v)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
