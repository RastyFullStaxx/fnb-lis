import { useMemo, useState } from "react";
import { BarChart3, Info } from "lucide-react";
import { round2 } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useCountDates, useFullAudit } from "@/api/ops";
import { useLocationId } from "@/api/location";
import { useProductTypes } from "@/api/master";
import { exportUrl, useFullAuditDrill } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ExportButtons } from "@/components/report-toolbar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export function FullAuditPage() {
  const me = useMe();
  const locationId = useLocationId();
  const countDates = useCountDates();
  const productTypes = useProductTypes();
  const [begin, setBegin] = useState<string>();
  const [end, setEnd] = useState<string>();
  const [productType, setProductType] = useState(ALL);
  const [drill, setDrill] = useState<{ id: string; name: string } | null>(null);

  const location = me.data?.clients.flatMap((c) => c.locations.map((l) => ({ ...l, clientName: c.name }))).find((l) => l.id === locationId);

  const dates = countDates.data?.dates ?? [];
  const effectiveBegin = begin ?? (dates.length >= 2 ? dates[dates.length - 2] : undefined);
  const effectiveEnd = end ?? (dates.length >= 2 ? dates[dates.length - 1] : undefined);

  const report = useFullAudit(effectiveBegin, effectiveEnd, productType === ALL ? undefined : productType);

  const endOptions = useMemo(() => dates.filter((d) => !effectiveBegin || d > effectiveBegin), [dates, effectiveBegin]);

  if (countDates.isPending) return <Skeleton className="h-96 w-full" />;

  if (dates.length < 2) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Full Audit" />
        <EmptyState
          icon={BarChart3}
          title="Two committed counts unlock this report"
          description="The Full Audit reconciles the stock between a beginning and an ending count. Commit a count, record the period's activity, then count again."
        />
      </div>
    );
  }

  const exportParams = { begin: effectiveBegin ?? "", end: effectiveEnd ?? "", ...(productType !== ALL ? { productType } : {}) };

  return (
    <div className="mx-auto max-w-full print:max-w-none">
      <PageHeader
        title="Full Audit"
        description="Beginning count + purchases + returns − ending count = usage; compared against what was sold, used, and produced."
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "full-audit", "xlsx", exportParams)}
            csvUrl={exportUrl(locationId, "full-audit", "csv", exportParams)}
            onPrint={() => window.print()}
            disabled={!report.data?.rows.length}
          />
        }
      />

      {/* Print-only header */}
      {location && effectiveBegin && effectiveEnd && (
        <div className="mb-4 hidden print:block">
          <h1 className="text-lg font-bold text-primary">Full Audit Report</h1>
          <p className="text-sm">
            {location.clientName} · {location.name} · {effectiveBegin} → {effectiveEnd}
          </p>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Beginning count</p>
          <Select value={effectiveBegin} onValueChange={(v) => { setBegin(v); if (effectiveEnd && effectiveEnd <= v) setEnd(undefined); }}>
            <SelectTrigger className="tnum w-40">
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
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Ending count</p>
          <Select value={effectiveEnd} onValueChange={setEnd}>
            <SelectTrigger className="tnum w-40">
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
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Type</p>
          <Select value={productType} onValueChange={setProductType}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {(productTypes.data?.productTypes ?? []).map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {effectiveBegin && effectiveEnd && (
        <p className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground print:hidden">
          <Info className="size-3.5" />
          Activity from {effectiveBegin} up to — not including — {effectiveEnd} (your ending count day).
          Counts are read on each boundary date.
        </p>
      )}

      {report.isPending && effectiveBegin && effectiveEnd ? (
        <Skeleton className="h-96 w-full" />
      ) : report.data ? (
        report.data.rows.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No activity or counts in this period"
            description="Pick different boundary dates, or check that the counts were committed."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border print:overflow-visible print:border-0">
            <Table className="min-w-[72rem]">
              <TableHeader className="sticky top-0 z-10">
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="min-w-48">Item</TableHead>
                  <TableHead className="text-right">Begin (full + open)</TableHead>
                  <TableHead className="text-right">Purchased</TableHead>
                  <TableHead className="text-right">Returns</TableHead>
                  <TableHead className="text-right">End (full + open)</TableHead>
                  <TableHead className="text-right font-semibold">Usage</TableHead>
                  <TableHead className="text-right">Sold (direct + recipe)</TableHead>
                  <TableHead className="text-right">Non-rev</TableHead>
                  <TableHead className="text-right">Prod</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right font-semibold">Variance</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">At cost</TableHead>
                  <TableHead className="text-right">At retail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.categories.map((group) => (
                  <CategoryRows key={group.categoryName} group={group} onDrill={setDrill} />
                ))}
                <TableRow className="border-t-2 bg-muted/60 font-semibold hover:bg-muted/60">
                  <TableCell>Grand total</TableCell>
                  <TableCell colSpan={8} />
                  <TableCell className="tnum text-right">{formatMoney(round2(report.data.totals.revenue))}</TableCell>
                  <TableCell colSpan={2} />
                  <TableCell className={cn("tnum text-right", report.data.totals.varianceCost < 0 && "text-destructive")}>
                    {formatMoney(round2(report.data.totals.varianceCost))}
                  </TableCell>
                  <TableCell className={cn("tnum text-right", report.data.totals.varianceRetail < 0 && "text-destructive")}>
                    {formatMoney(round2(report.data.totals.varianceRetail))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )
      ) : null}

      <DrillDialog item={drill} begin={effectiveBegin} end={effectiveEnd} onClose={() => setDrill(null)} />
    </div>
  );
}

type Group = NonNullable<ReturnType<typeof useFullAudit>["data"]>["categories"][number];

function CategoryRows({ group, onDrill }: { group: Group; onDrill: (item: { id: string; name: string }) => void }) {
  return (
    <>
      <TableRow className="bg-secondary/60 hover:bg-secondary/60">
        <TableCell colSpan={14} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-secondary-foreground">
          {group.categoryName}
        </TableCell>
      </TableRow>
      {group.rows.map((row) => (
        <TableRow
          key={row.locationItemId}
          className={cn("cursor-pointer", row.flags.short ? "bg-destructive/5 hover:bg-destructive/10" : "hover:bg-muted/40")}
          onClick={() => onDrill({ id: row.locationItemId, name: row.itemName })}
        >
          <TableCell>
            <span className="font-medium">{row.itemName}</span>
            {row.flags.missingPrice && (
              <Badge variant="destructive" className="ml-2 print:hidden">
                no price
              </Badge>
            )}
          </TableCell>
          <TableCell className="tnum text-right">
            {n2(row.beginFull)}
            {row.beginOpenEquiv > 0 && <span className="text-muted-foreground"> + {n2(row.beginOpenEquiv)}</span>}
          </TableCell>
          <TableCell className="tnum text-right">{row.purchased > 0 ? n2(row.purchased) : "—"}</TableCell>
          <TableCell className="tnum text-right">{row.forfeited > 0 ? n2(row.forfeited) : "—"}</TableCell>
          <TableCell className="tnum text-right">
            {n2(row.endFull)}
            {row.endOpenEquiv > 0 && <span className="text-muted-foreground"> + {n2(row.endOpenEquiv)}</span>}
          </TableCell>
          <TableCell className="tnum text-right font-medium">{n2(row.usage)}</TableCell>
          <TableCell className="tnum text-right">
            {row.soldDirect + row.soldPortion > 0 ? (
              <>
                {n2(row.soldDirect)}
                {row.soldPortion > 0 && <span className="text-muted-foreground"> + {n2(row.soldPortion)}</span>}
              </>
            ) : (
              "—"
            )}
          </TableCell>
          <TableCell className="tnum text-right">{row.nonRevenue > 0 ? n2(row.nonRevenue) : "—"}</TableCell>
          <TableCell className="tnum text-right">{row.production > 0 ? n2(row.production) : "—"}</TableCell>
          <TableCell className="tnum text-right">{row.revenue > 0 ? formatMoney(round2(row.revenue)) : "—"}</TableCell>
          <TableCell className={cn("tnum text-right font-medium", row.flags.short && "text-destructive")}>
            {n2(row.variance)}
          </TableCell>
          <TableCell className={cn("tnum text-right", row.flags.short && "text-destructive")}>
            {row.variancePct === null ? "—" : `${n2(row.variancePct)}%`}
          </TableCell>
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
          <Skeleton className="h-40 w-full" />
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
