import { Fragment, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { MATERIAL_VARIANCE_PCT, round2, varianceSeverity } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useCountDates } from "@/api/ops";
import { useIncludeHiddenInReports, useVarianceThreshold } from "@/api/settings";
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
 * The 20 leaf columns after Product Name/Size-UOM, in the client's own
 * order (client req 2026-08-20 — screenshot of the old system's exact
 * on-screen header). This is a SCREEN-ONLY layout: the Excel/CSV/PDF
 * export (services/exports-suite.ts, LEGACY_HEADERS/legacyRowCells) keeps
 * its own richer 25-column set — Cost of Purchase, Cost of Sold, and a
 * Flag column — on purpose (client req 2026-08-20: downloads stay as-is).
 * Do not "sync" the two; they are intentionally different views of the
 * same LegacyAuditRow data.
 * `money` marks the peso columns; the rest are quantities.
 */
const COLUMNS: Array<{ header: string; money?: true; value: (r: LegacyAuditRow) => number | null }> = [
  { header: "Full", value: (r) => r.beginFull },
  { header: "Weigh", value: (r) => r.beginOpen },
  { header: "B-Cost", money: true, value: (r) => r.bCost },
  { header: "Purchased", value: (r) => r.purchased },
  { header: "F", value: (r) => r.forfeited },
  { header: "Full", value: (r) => r.endFull },
  { header: "Weigh", value: (r) => r.endOpen },
  { header: "E-Cost", money: true, value: (r) => r.eCost },
  { header: "USAGE", value: (r) => r.usage },
  { header: "Usaged Cost", money: true, value: (r) => r.costOfUsage },
  { header: "Sold", value: (r) => r.shot },
  { header: "Portion", value: (r) => r.bottle },
  { header: "Revenue", money: true, value: (r) => r.revenue },
  { header: "Uses VS Sales", value: (r) => r.usedVsSales },
  { header: "Non Rev Usage", value: (r) => r.nonRevUsage },
  { header: "Non Rev Cost", money: true, value: (r) => r.nonRevCost },
  { header: "Over/Short", value: (r) => r.overallVariance },
  { header: "%Over/Short", value: (r) => r.variancePct },
  { header: "Cost", money: true, value: (r) => r.varianceCost },
  { header: "Retail", money: true, value: (r) => r.varianceRetail },
];

/** Column groups above the leaf headers — the legacy report's banded look.
    Matches the client's reference screenshot exactly: Purchased/F and
    Usage/Usaged Cost are NOT their own groups (blank band, like B-Cost),
    SALES spans only Sold+Portion (Revenue sits outside it), and Variance
    spans only Uses VS Sales (Non Rev Usage/Cost sit outside it).
    A blank entry spans exactly 1 leaf column — never merged — so every
    leaf column gets its own row-1 cell and its vertical divider runs the
    full header height instead of only appearing once row 2 starts. */
const GROUPS: Array<[string, number]> = [
  ["", 1],
  ["", 1],
  ["Beginning Inventory", 2],
  ["", 1],
  ["", 1],
  ["", 1],
  ["Ending Inventory", 2],
  ["", 1],
  ["", 1],
  ["", 1],
  ["SALES", 2],
  ["", 1],
  ["Variance", 1],
  ["", 1],
  ["", 1],
  ["Overall Variance", 4],
];

/** Solid tint for the sticky-left cell on highlighted rows — translucent
    tints (bg-destructive/5, bg-warning/10) let scrolled-under columns bleed
    through a pinned cell, since this report is intentionally wide by design
    and meant to be scrolled. Same values as full-audit.tsx's identical fix,
    hand-matched to those two translucent tints over `--background` in the
    LIGHT theme, which is the only theme the app ships (no `.dark` toggle
    exists). If a dark theme is ever added these literals must gain a `dark:`
    twin, or highlighted rows will pin a near-white cell against a dark table. */
const SHORT_ROW_STICKY_BG = "bg-[oklch(0.977_0.011_25)]";
const OVER_ROW_STICKY_BG = "bg-[oklch(0.972_0.024_75)]";
/** Solid equivalent of `bg-muted/50` (the category-total row's tint) over the
    LIGHT theme's `--background` (pure white) — same reasoning and same
    hand-match technique as the two constants above, for the one other
    sticky-left cell that sat on a translucent row background. */
const TOTAL_ROW_STICKY_BG = "bg-[oklch(0.986_0.002_239.3)]";

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
  // LegacyAuditRow has no activity fields to re-derive hasReportActivity from
  // (report-suite.ts filters on the internal ReconRow before reshaping), so
  // the badge is only unambiguous when the setting is off — the one case
  // where a surviving hidden row can only mean "it moved"
  // (docs/clutter-in-reports-decision.md).
  const includeHidden = useIncludeHiddenInReports(location?.clientId ?? "");
  const includeHiddenInReports = includeHidden.data?.includeHiddenInReports ?? false;

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

        <div className="min-h-0 flex-1 overflow-auto [&_[data-slot=table-container]]:overflow-visible">
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
            <Table className="border-separate border-spacing-0 text-xs [&_td]:border-b [&_td]:px-1.5 [&_th]:px-1.5">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {GROUPS.map(([label, span], i) => (
                    <TableHead
                      key={i}
                      colSpan={span}
                      className={cn(
                        "sticky top-0 z-20 bg-muted text-center text-[11px] font-medium text-muted-foreground",
                        i > 0 && "border-l",
                        // Blank group cells (B-Cost, Purchased, F, USAGE, Revenue,
                        // Non Rev Usage/Cost, etc.) have nothing labeling them, so
                        // the reference screenshot merges them visually with the
                        // leaf header below — no horizontal rule between the two
                        // rows for those columns. Only labeled groups (Beginning/
                        // Ending Inventory, SALES, Variance, Overall Variance) get
                        // the divider under their label. Applying border-b only on
                        // the true branch (rather than border-b globally via the
                        // table wrapper + border-b-0 to cancel it) avoids a Tailwind
                        // v4 specificity tie between two same-weight utility classes,
                        // where the cancelling class isn't guaranteed to win.
                        label !== "" && "border-b",
                      )}
                    >
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky left-0 top-10 z-30 w-[14rem] min-w-[10rem] border-r border-b bg-muted">Product Name</TableHead>
                  <TableHead className="sticky top-10 z-20 border-b border-l bg-muted">Size/UOM</TableHead>
                  {COLUMNS.map((c) => (
                    <TableHead key={c.header} className="sticky top-10 z-20 border-b border-l bg-muted text-right whitespace-nowrap">
                      {c.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.groups.map((group) => (
                  <Fragment key={group.categoryName}>
                    <TableRow className="bg-secondary/60 hover:bg-secondary/60">
                      <TableCell className="sticky left-0 z-10 w-[14rem] min-w-[10rem] border-r break-words bg-secondary py-1 text-[11px] font-semibold uppercase tracking-wide text-secondary-foreground">
                        {group.categoryName}
                      </TableCell>
                      <TableCell colSpan={COLUMNS.length + 1} className="py-1" />
                    </TableRow>
                    {group.rows.map((row, i) => {
                      // Same materiality highlight as the Full Audit and the
                      // downloads: material short red, material over amber.
                      const sev = varianceSeverity(
                        { variance: row.overallVariance, variancePct: row.variancePct, contentTracked: row.contentTracked },
                        thresholdPct,
                      );
                      // The row tint is translucent by design (it needs to sit
                      // over the row's own alternating/hover background), but
                      // the STICKY cell can't use it — see SHORT/OVER_ROW_STICKY_BG
                      // above. bg-background is the sticky cell's own opaque
                      // fallback for an untinted row, not bg-inherit, which
                      // would resolve to the unstyled <tr>'s transparent
                      // background and let scrolled columns show through it.
                      const stickyBg =
                        sev === "short" ? SHORT_ROW_STICKY_BG : sev === "over" ? OVER_ROW_STICKY_BG : "bg-background";
                      return (
                        <TableRow
                          key={`${group.categoryName}-${i}`}
                          className={cn(
                            sev === "short" && "bg-destructive/5",
                            sev === "over" && "bg-warning/10",
                          )}
                        >
                          <TableCell className={cn("sticky left-0 z-10 w-[14rem] min-w-[10rem] border-r break-words font-medium", stickyBg)}>
                            {row.productName}
                            {!row.isActive && !includeHiddenInReports && (
                              <Badge variant="warning" className="ml-2">
                                hidden · active
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{row.sizeUom}</TableCell>
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
                      <TableCell className={cn("sticky left-0 z-10 w-[14rem] min-w-[10rem] border-r break-words uppercase", TOTAL_ROW_STICKY_BG)}>
                        {group.categoryName} total
                      </TableCell>
                      <TableCell />
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
                  <TableCell className="sticky left-0 z-10 w-[14rem] min-w-[10rem] border-r break-words bg-muted">GRAND TOTAL</TableCell>
                  <TableCell />
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
