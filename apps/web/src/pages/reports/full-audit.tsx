import { useMemo, useState } from "react";
import { BarChart3, Info } from "lucide-react";
import { round2 } from "@fnb/core";
import { useCountDates, useFullAudit } from "@/api/ops";
import { useProductTypes } from "@/api/master";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
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
  const countDates = useCountDates();
  const productTypes = useProductTypes();
  const [begin, setBegin] = useState<string>();
  const [end, setEnd] = useState<string>();
  const [productType, setProductType] = useState(ALL);

  const dates = countDates.data?.dates ?? [];
  // Default to the most recent complete period.
  const effectiveBegin = begin ?? (dates.length >= 2 ? dates[dates.length - 2] : undefined);
  const effectiveEnd = end ?? (dates.length >= 2 ? dates[dates.length - 1] : undefined);

  const report = useFullAudit(
    effectiveBegin,
    effectiveEnd,
    productType === ALL ? undefined : productType,
  );

  const endOptions = useMemo(
    () => dates.filter((d) => !effectiveBegin || d > effectiveBegin),
    [dates, effectiveBegin],
  );

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

  return (
    <div className="mx-auto max-w-full print:max-w-none">
      <PageHeader
        title="Full Audit"
        description="Beginning count + purchases + returns − ending count = usage; compared against what was sold, used, and produced."
      />

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
          <div className="overflow-x-auto rounded-lg border">
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
                  <CategoryRows key={group.categoryName} group={group} />
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
    </div>
  );
}

type Group = NonNullable<ReturnType<typeof useFullAudit>["data"]>["categories"][number];

function CategoryRows({ group }: { group: Group }) {
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
          className={cn(row.flags.short && "bg-destructive/5 hover:bg-destructive/10")}
        >
          <TableCell>
            <span className="font-medium">{row.itemName}</span>
            {row.flags.missingPrice && (
              <Badge variant="destructive" className="ml-2">
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
                {row.soldPortion > 0 && (
                  <span className="text-muted-foreground"> + {n2(row.soldPortion)}</span>
                )}
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
