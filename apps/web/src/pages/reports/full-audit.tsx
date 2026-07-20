import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { BarChart3, ChevronDown, FileDown, Info } from "lucide-react";
import { can, round2, type Role } from "@fnb/core";
import { toast } from "sonner";
import { useMe } from "@/api/auth";
import { useCountDates, useFullAudit } from "@/api/ops";
import { useLocationId } from "@/api/location";
import { useProductTypes } from "@/api/master";
import { useCompanyInfo } from "@/api/settings";
import { exportUrl, useFullAuditDrill } from "@/api/reports";
import { ApiError, downloadFile } from "@/api/http";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TableLoading, TableEmpty, TableError, ToolbarSearch } from "@/components/table-surface";
import { ExportButtons } from "@/components/report-toolbar";
import { Toggle } from "@/components/toggle-chip";
import { MagnitudeBars } from "@/components/charts/magnitude-bars";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const ALL = "__all__";

const n2 = (v: number) => round2(v).toLocaleString("en-US", { maximumFractionDigits: 2 });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Solid tint for sticky cells on short rows — translucent destructive/5 would
    let scrolled columns bleed through a pinned cell. */
const SHORT_ROW_STICKY_BG = "bg-[oklch(0.977_0.011_25)]";

export function FullAuditPage() {
  const me = useMe();
  const locationId = useLocationId();
  const countDates = useCountDates();
  const productTypes = useProductTypes();
  // Deep links (e.g. Stocky citations) seed the period via ?begin=&end=.
  const [params] = useSearchParams();
  const urlBegin = params.get("begin");
  const urlEnd = params.get("end");
  const [begin, setBegin] = useState<string | undefined>(urlBegin && DATE_RE.test(urlBegin) ? urlBegin : undefined);
  const [end, setEnd] = useState<string | undefined>(urlEnd && DATE_RE.test(urlEnd) ? urlEnd : undefined);
  const [productType, setProductType] = useState(params.get("productType") || ALL);
  const [drill, setDrill] = useState<{ id: string; name: string } | null>(null);
  const [query, setQuery] = useState("");
  // ?variance=only — the Variance Report entry on the hub lands here with the
  // filter pre-armed (client report #10: only items that carry a variance).
  const [varianceOnly, setVarianceOnly] = useState(params.get("variance") === "only");
  // Compact is the DEFAULT: only the columns the verdict needs — Begin, End,
  // Usage, Sold, and the variance block — so the report fits without
  // horizontal scrolling. "All Columns" brings the movement detail back;
  // exports and print always carry every column.
  const [compact, setCompact] = useState(true);

  const location = me.data?.clients.flatMap((c) => c.locations.map((l) => ({ ...l, clientName: c.name }))).find((l) => l.id === locationId);
  const company = useCompanyInfo(location?.clientId ?? "");

  const dates = countDates.data?.dates ?? [];
  const effectiveBegin = begin ?? (dates.length >= 2 ? dates[dates.length - 2] : undefined);
  const effectiveEnd = end ?? (dates.length >= 2 ? dates[dates.length - 1] : undefined);

  const report = useFullAudit(effectiveBegin, effectiveEnd, productType === ALL ? undefined : productType);

  const endOptions = useMemo(() => dates.filter((d) => !effectiveBegin || d > effectiveBegin), [dates, effectiveBegin]);

  // Dashboard variance leaders deep-link here with ?drill=<locationItemId>:
  // open that item's source records as soon as the report identifies it.
  const drillParam = params.get("drill");
  const consumedDrill = useRef(false);
  useEffect(() => {
    if (!drillParam || consumedDrill.current || !report.data) return;
    const row = report.data.rows.find((r) => r.locationItemId === drillParam);
    if (row) {
      consumedDrill.current = true;
      setDrill({ id: row.locationItemId, name: row.itemName });
    }
  }, [drillParam, report.data]);

  // Density controls: search + "variance only" collapse a 200-row catalog to
  // the rows under review. Category groups with no surviving rows drop out.
  const visibleGroups = useMemo(() => {
    if (!report.data) return [];
    const q = query.trim().toLowerCase();
    return report.data.categories
      .map((group) => ({
        ...group,
        rows: group.rows.filter(
          (row) =>
            (!q || row.itemName.toLowerCase().includes(q)) &&
            (!varianceOnly || row.variance !== 0),
        ),
      }))
      .filter((group) => group.rows.length > 0);
  }, [report.data, query, varianceOnly]);

  const filteredOut =
    report.data ? report.data.rows.length - visibleGroups.reduce((n, g) => n + g.rows.length, 0) : 0;

  if (countDates.isPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="Full Audit" />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
          <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3 py-2.5">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-36" />
          </div>
          <TableLoading rows={10} />
        </div>
      </div>
    );
  }

  if (dates.length < 2) {
    return (
      <div>
        <PageHeader title="Full Audit" />
        <EmptyState
          icon={BarChart3}
          title="Two committed counts unlock this report"
          description="The Full Audit reconciles the stock between a beginning and an ending count. Commit a count, record the period's activity, then count again."
        />
      </div>
    );
  }

  // Exports mirror the on-screen filters: with "Variance Only" armed, the
  // downloaded file is the Variance Report (client req #10).
  const exportParams = {
    begin: effectiveBegin ?? "",
    end: effectiveEnd ?? "",
    ...(productType !== ALL ? { productType } : {}),
    ...(varianceOnly ? { variance: "only" } : {}),
  };
  const legacyParams = { begin: effectiveBegin ?? "", end: effectiveEnd ?? "" };

  return (
    <div className="flex min-h-0 flex-1 flex-col print:block">
      <PageHeader
        title="Full Audit"
        actions={
          <>
            <LegacyFormatMenu
              disabled={!report.data?.rows.length}
              urls={{
                detailedXlsx: exportUrl(locationId, "legacy-audit", "xlsx", { ...legacyParams, variant: "detailed" }),
                detailedCsv: exportUrl(locationId, "legacy-audit", "csv", { ...legacyParams, variant: "detailed" }),
                detailedPdf: exportUrl(locationId, "legacy-audit", "pdf", { ...legacyParams, variant: "detailed" }),
                inventoryXlsx: exportUrl(locationId, "legacy-audit", "xlsx", { ...legacyParams, variant: "inventory" }),
                inventoryCsv: exportUrl(locationId, "legacy-audit", "csv", { ...legacyParams, variant: "inventory" }),
                inventoryPdf: exportUrl(locationId, "legacy-audit", "pdf", { ...legacyParams, variant: "inventory" }),
              }}
            />
            <ExportButtons
              xlsxUrl={exportUrl(locationId, "full-audit", "xlsx", exportParams)}
              csvUrl={exportUrl(locationId, "full-audit", "csv", exportParams)}
              pdfUrl={exportUrl(locationId, "full-audit", "pdf", exportParams)}
              onPrint={() => window.print()}
              disabled={!report.data?.rows.length}
            />
          </>
        }
      />

      {/* Print-only header */}
      {location && effectiveBegin && effectiveEnd && (
        <div className="mb-4 hidden print:block">
          {(company.data?.legalName || company.data?.address) && (
            <p className="text-xs text-muted-foreground">
              {[company.data.legalName, company.data.address].filter(Boolean).join(" · ")}
            </p>
          )}
          <h1 className="text-lg font-bold text-primary">Full Audit Report</h1>
          <p className="text-sm">
            {location.clientName} · {location.name} · {effectiveBegin} → {effectiveEnd}
          </p>
          {company.data?.reportFooter && (
            <p className="mt-1 text-xs italic text-muted-foreground">{company.data.reportFooter}</p>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border print:block print:overflow-visible print:rounded-none print:border-0">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2.5 print:hidden">
          <Label htmlFor="fa-begin" className="text-xs text-muted-foreground">Beginning</Label>
          <Select value={effectiveBegin} onValueChange={(v) => { setBegin(v); if (effectiveEnd && effectiveEnd <= v) setEnd(undefined); }}>
            <SelectTrigger id="fa-begin" className="tnum w-40 bg-background">
              <SelectValue placeholder="Pick a date" />
            </SelectTrigger>
            <SelectContent>
              {dates.map((d) => (
                <SelectItem key={d} value={d} className="tnum">
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label htmlFor="fa-end" className="text-xs text-muted-foreground">Ending</Label>
          <Select value={effectiveEnd} onValueChange={setEnd}>
            <SelectTrigger id="fa-end" className="tnum w-40 bg-background">
              <SelectValue placeholder="Pick a date" />
            </SelectTrigger>
            <SelectContent>
              {endOptions.map((d) => (
                <SelectItem key={d} value={d} className="tnum">
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label htmlFor="fa-type" className="text-xs text-muted-foreground">Type</Label>
          <Select value={productType} onValueChange={setProductType}>
            <SelectTrigger id="fa-type" className="w-36 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Types</SelectItem>
              {(productTypes.data?.productTypes ?? []).map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToolbarSearch
            value={query}
            onChange={setQuery}
            placeholder="Find an item…"
            className="w-48"
          />
          <Toggle pressed={varianceOnly} onPressedChange={setVarianceOnly}>
            Variance Only
          </Toggle>
          <Toggle pressed={!compact} onPressedChange={(pressed) => setCompact(!pressed)}>
            All Columns
          </Toggle>
        </div>

        {report.data && report.data.rows.length > 0 && effectiveBegin && effectiveEnd ? (
          <VerdictStrip report={report.data} begin={effectiveBegin} end={effectiveEnd} />
        ) : null}

        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto [&_[data-slot=table-container]]:overflow-visible print:overflow-visible">
          {report.isPending && effectiveBegin && effectiveEnd ? (
            <TableLoading rows={10} />
          ) : report.isError ? (
            <TableError onRetry={() => void report.refetch()} retrying={report.isRefetching} />
          ) : !report.data ? (
            <div className="px-4 py-16 text-center text-sm text-muted-foreground">
              Pick a beginning and ending count to run the reconciliation.
            </div>
          ) : report.data.rows.length === 0 ? (
            <TableEmpty
              icon={BarChart3}
              title="No activity or counts in this period"
              description="Pick different boundary dates, or check that the counts were committed."
            />
          ) : visibleGroups.length === 0 ? (
            <TableEmpty
              icon={BarChart3}
              title="No rows match the current filters"
              description={
                varianceOnly
                  ? "Every remaining item reconciled cleanly. Clear the filters to see the full report."
                  : "Try a different search term."
              }
            />
          ) : (
            <Table
              // border-separate + per-CELL sticky headers: with border-collapse,
              // Chrome leaves row backgrounds/borders behind when a thead
              // sticks, so scrolled rows bleed through the pinned header. Cell
              // backgrounds and cell borders always travel.
              className={cn(
                "border-separate border-spacing-0 [&_th]:border-b [&_td]:border-b",
                compact ? "min-w-[52rem]" : "min-w-[78rem]",
              )}
            >
              <TableHeader>
                {/* Column groups halve the scan: movement → usage → sold → verdict. */}
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky left-0 top-0 z-30 bg-muted" aria-label="Item column group" />
                  <TableHead
                    colSpan={compact ? 2 : 5}
                    className="sticky top-0 z-20 border-l bg-muted text-center text-xs font-medium text-muted-foreground"
                  >
                    Stock Movement
                  </TableHead>
                  <TableHead className="sticky top-0 z-20 border-l bg-muted" aria-label="Usage column group" />
                  <TableHead
                    colSpan={compact ? 1 : 4}
                    className="sticky top-0 z-20 border-l bg-muted text-center text-xs font-medium text-muted-foreground"
                  >
                    Sold &amp; Used
                  </TableHead>
                  <TableHead
                    colSpan={compact ? 3 : 4}
                    className="sticky top-0 z-20 border-l bg-muted text-center text-xs font-medium text-muted-foreground"
                  >
                    Variance
                  </TableHead>
                </TableRow>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky left-0 top-10 z-30 min-w-48 bg-muted">Item</TableHead>
                  <TableHead className="sticky top-10 z-20 border-l bg-muted text-right">
                    {compact ? "Begin" : "Begin (Full + Open)"}
                  </TableHead>
                  {!compact && <TableHead className="sticky top-10 z-20 bg-muted text-right">Purchased</TableHead>}
                  {!compact && <TableHead className="sticky top-10 z-20 bg-muted text-right">Returns</TableHead>}
                  {!compact && <TableHead className="sticky top-10 z-20 bg-muted text-right">Transfers (In − Out)</TableHead>}
                  <TableHead className="sticky top-10 z-20 bg-muted text-right">
                    {compact ? "End" : "End (Full + Open)"}
                  </TableHead>
                  <TableHead className="sticky top-10 z-20 border-l bg-muted text-right font-semibold">Usage</TableHead>
                  <TableHead className="sticky top-10 z-20 border-l bg-muted text-right">
                    {compact ? "Sold" : "Sold (Direct + Recipe)"}
                  </TableHead>
                  {!compact && <TableHead className="sticky top-10 z-20 bg-muted text-right">Non-Revenue</TableHead>}
                  {!compact && <TableHead className="sticky top-10 z-20 bg-muted text-right">Production</TableHead>}
                  {!compact && <TableHead className="sticky top-10 z-20 bg-muted text-right">Revenue</TableHead>}
                  <TableHead className="sticky top-10 z-20 border-l bg-muted text-right font-semibold">Variance vs Sold</TableHead>
                  {!compact && <TableHead className="sticky top-10 z-20 bg-muted text-right">%</TableHead>}
                  <TableHead className="sticky top-10 z-20 bg-muted text-right">At Cost</TableHead>
                  <TableHead className="sticky top-10 z-20 bg-muted text-right">At Retail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleGroups.map((group) => (
                  <CategoryRows key={group.categoryName} group={group} onDrill={setDrill} compact={compact} />
                ))}
                <TableRow className="bg-muted/60 font-semibold hover:bg-muted/60 [&_td]:border-t-2">
                  <TableCell className="sticky left-0 z-10 bg-muted">Grand Total</TableCell>
                  {compact ? (
                    <TableCell colSpan={4} />
                  ) : (
                    <>
                      <TableCell colSpan={9} />
                      <TableCell className="tnum text-right">{formatMoney(round2(report.data.totals.revenue))}</TableCell>
                      <TableCell colSpan={2} />
                    </>
                  )}
                  {compact ? <TableCell /> : null}
                  <TableCell className={cn("tnum text-right", report.data.totals.varianceCost < 0 && "text-destructive")}>
                    {formatMoney(round2(report.data.totals.varianceCost))}
                  </TableCell>
                  <TableCell className={cn("tnum text-right", report.data.totals.varianceRetail < 0 && "text-destructive")}>
                    {formatMoney(round2(report.data.totals.varianceRetail))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </div>

        {filteredOut > 0 && report.data ? (
          <p className="shrink-0 border-t px-3 py-1.5 text-xs text-muted-foreground print:hidden">
            {filteredOut} of {report.data.rows.length} rows hidden by filters — exports always include every row.
          </p>
        ) : null}
      </div>

      <DrillDialog item={drill} begin={effectiveBegin} end={effectiveEnd} onClose={() => setDrill(null)} />
    </div>
  );
}

type Report = NonNullable<ReturnType<typeof useFullAudit>["data"]>;
type Group = Report["categories"][number];

/**
 * The two client-format downloads (Detailed Full Audit / Inventory Report —
 * docs/client-report-formats.md): same 24-column legacy table, different
 * title and headline cost ratio. Grouped in one menu so the title row stays
 * calm.
 */
function LegacyFormatMenu({
  urls,
  disabled,
}: {
  urls: Record<"detailedXlsx" | "detailedCsv" | "detailedPdf" | "inventoryXlsx" | "inventoryCsv" | "inventoryPdf", string>;
  disabled?: boolean;
}) {
  const me = useMe();
  const role = (me.data?.user.role ?? "READONLY") as Role;
  if (!can(role, "reports.export")) return null;

  const download = async (url: string) => {
    try {
      await downloadFile(url);
      toast.success("Export ready");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Export failed");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <FileDown className="size-4" /> Client Formats
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Detailed Full Audit Report</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void download(urls.detailedXlsx)}>Excel</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void download(urls.detailedCsv)}>CSV</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void download(urls.detailedPdf)}>PDF</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Inventory Report</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void download(urls.inventoryXlsx)}>Excel</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void download(urls.inventoryCsv)}>CSV</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void download(urls.inventoryPdf)}>PDF</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The verdict before the evidence: period variance at cost and retail, how
 * many items missed, and which categories drive it — so the reader knows the
 * answer before scrolling 15 columns. Screen-only; print keeps the pure table.
 */
function VerdictStrip({ report, begin, end }: { report: Report; begin: string; end: string }) {
  const itemsShort = report.rows.filter((r) => r.variance < 0).length;
  const itemsOver = report.rows.filter((r) => r.variance > 0).length;
  const categories = report.categories
    .filter((g) => g.totals.varianceCost !== 0)
    .map((g) => ({ label: g.categoryName, value: round2(g.totals.varianceCost) }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 6);

  return (
    <div className="shrink-0 border-b bg-muted/20 px-4 py-4 print:hidden">
      <div className="grid gap-6 lg:grid-cols-[minmax(200px,240px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Period Variance at Cost</p>
            <p
              className={cn(
                "mt-0.5 text-[28px] font-semibold leading-[34px] tracking-tight",
                report.totals.varianceCost < 0 && "text-destructive",
              )}
            >
              {formatMoney(round2(report.totals.varianceCost))}
            </p>
            <p className={cn("mt-0.5 text-xs text-muted-foreground", report.totals.varianceRetail < 0 && "text-destructive")}>
              {formatMoney(round2(report.totals.varianceRetail))} at retail
            </p>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {itemsShort === 0 && itemsOver === 0
              ? "Every item reconciled cleanly this period."
              : `${itemsShort} ${itemsShort === 1 ? "item" : "items"} short · ${itemsOver} over expectation · ${begin} to ${end}`}
          </p>
        </div>
        {categories.length > 0 ? (
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Variance by Category (Cost)</p>
            <div className="mt-2">
              <MagnitudeBars data={categories} name="Variance" diverging />
            </div>
          </div>
        ) : (
          <div className="flex items-center rounded-md bg-success/10 px-4 text-sm">
            No category carries a cost variance in this period.
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryRows({
  group,
  onDrill,
  compact,
}: {
  group: Group;
  onDrill: (item: { id: string; name: string }) => void;
  compact: boolean;
}) {
  return (
    <>
      <TableRow className="bg-secondary/60 hover:bg-secondary/60">
        <TableCell className="sticky left-0 z-10 bg-secondary py-1.5 text-xs font-semibold uppercase tracking-wide text-secondary-foreground">
          {group.categoryName}
        </TableCell>
        <TableCell colSpan={compact ? 7 : 14} className="py-1.5" />
      </TableRow>
      {group.rows.map((row) => (
        <TableRow
          key={row.locationItemId}
          tabIndex={0}
          className={cn(
            "cursor-pointer focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2",
            row.flags.short ? "bg-destructive/5 hover:bg-destructive/10" : "hover:bg-muted/40",
          )}
          onClick={() => onDrill({ id: row.locationItemId, name: row.itemName })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onDrill({ id: row.locationItemId, name: row.itemName });
            }
          }}
          aria-label={`Open source records for ${row.itemName}`}
        >
          <TableCell className={cn("sticky left-0 z-10", row.flags.short ? SHORT_ROW_STICKY_BG : "bg-background")}>
            <span className="font-medium">{row.itemName}</span>
            {row.flags.missingPrice && (
              <Badge variant="outline" className="ml-2 border-warning-text/40 text-warning-text print:hidden">
                no price
              </Badge>
            )}
          </TableCell>
          <TableCell className="tnum border-l text-right">
            {n2(row.beginFull)}
            {row.beginOpenEquiv > 0 && <span className="text-muted-foreground"> + {n2(row.beginOpenEquiv)}</span>}
          </TableCell>
          {!compact && <TableCell className="tnum text-right">{row.purchased > 0 ? n2(row.purchased) : "—"}</TableCell>}
          {!compact && <TableCell className="tnum text-right">{row.forfeited > 0 ? n2(row.forfeited) : "—"}</TableCell>}
          {!compact && (
            <TableCell className="tnum text-right">
              {row.transferIn === 0 && row.transferOut === 0 ? (
                "—"
              ) : (
                <>
                  {row.transferIn > 0 && `+${n2(row.transferIn)}`}
                  {row.transferIn > 0 && row.transferOut > 0 && " "}
                  {row.transferOut > 0 && <span className="text-muted-foreground">−{n2(row.transferOut)}</span>}
                </>
              )}
            </TableCell>
          )}
          <TableCell className="tnum text-right">
            {n2(row.endFull)}
            {row.endOpenEquiv > 0 && <span className="text-muted-foreground"> + {n2(row.endOpenEquiv)}</span>}
          </TableCell>
          <TableCell className="tnum border-l text-right font-medium">{n2(row.usage)}</TableCell>
          <TableCell className="tnum border-l text-right">
            {row.soldDirect + row.soldPortion > 0 ? (
              <>
                {n2(row.soldDirect)}
                {row.soldPortion > 0 && <span className="text-muted-foreground"> + {n2(row.soldPortion)}</span>}
              </>
            ) : (
              "—"
            )}
          </TableCell>
          {!compact && <TableCell className="tnum text-right">{row.nonRevenue > 0 ? n2(row.nonRevenue) : "—"}</TableCell>}
          {!compact && <TableCell className="tnum text-right">{row.production > 0 ? n2(row.production) : "—"}</TableCell>}
          {!compact && (
            <TableCell className="tnum text-right">{row.revenue > 0 ? formatMoney(round2(row.revenue)) : "—"}</TableCell>
          )}
          <TableCell className={cn("tnum border-l text-right font-medium", row.flags.short && "text-destructive")}>
            {n2(row.variance)}
          </TableCell>
          {!compact && (
            <TableCell className={cn("tnum text-right", row.flags.short && "text-destructive")}>
              {row.variancePct === null ? "—" : `${n2(row.variancePct)}%`}
            </TableCell>
          )}
          <TableCell className={cn("tnum text-right", row.varianceCost < 0 && "text-destructive")}>
            {formatMoney(round2(row.varianceCost))}
          </TableCell>
          <TableCell className={cn("tnum text-right", row.varianceRetail < 0 && "text-destructive")}>
            {formatMoney(round2(row.varianceRetail))}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

const DRILL_LABELS: Record<string, string> = {
  COUNT: "Count",
  PURCHASE: "Purchase",
  SALE: "Sale",
  NON_REVENUE: "Non-revenue",
  PRODUCTION: "Production",
  FORFEIT: "Return",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
};

function DrillDialog({
  item,
  begin,
  end,
  onClose,
}: {
  item: { id: string; name: string } | null;
  begin?: string;
  end?: string;
  onClose: () => void;
}) {
  const drill = useFullAuditDrill(begin ?? "", end ?? "", item?.id ?? null);

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item?.name}</DialogTitle>
          <DialogDescription>
            The source records behind this row, {begin} → {end}.
          </DialogDescription>
        </DialogHeader>
        {drill.isPending ? (
          <div className="divide-y rounded-lg border" aria-label="Loading source records">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <Skeleton className="h-5 w-16 shrink-0" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-14 shrink-0" />
              </div>
            ))}
          </div>
        ) : (drill.data?.records.length ?? 0) === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No source records in this period.</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {drill.data!.records.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2">
                <Badge variant="outline" className="shrink-0">
                  {DRILL_LABELS[r.kind] ?? r.kind}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{r.detail}</p>
                  <p className="tnum text-xs text-muted-foreground">{r.date}</p>
                </div>
                {r.amount !== null && <span className="tnum text-sm">{formatMoney(r.amount)}</span>}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
