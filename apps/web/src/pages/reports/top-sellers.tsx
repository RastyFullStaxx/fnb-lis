import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { round2 } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useCountDates } from "@/api/ops";
import { exportUrl, useTopSellersReport } from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty } from "@/components/table-surface";
import { DateRangeControl, ExportButtons } from "@/components/report-toolbar";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useReportRange } from "./use-report-range";

const LIMITS = [10, 25, 50] as const;
type Limit = (typeof LIMITS)[number];

// Qty formatted to 6 dp max — whole numbers show clean, fractions show precise.
const n6 = (v: number) => round2(v).toLocaleString("en-US", { maximumFractionDigits: 6 });

export function TopSellersPage() {
  const locationId = useLocationId();
  const dates = useCountDates();
  const [from, to, setFrom, setTo] = useReportRange(dates.data?.dates);
  const [limit, setLimit] = useState<Limit>(10);

  const report = useTopSellersReport(from, to, limit);

  const hasData =
    report.data &&
    (report.data.topBrands.length > 0 ||
      report.data.topMenus.length > 0 ||
      report.data.topIngredients.length > 0);

  return (
    <div>
      <PageHeader
        title="Top Sellers"
        actions={
          <ExportButtons
            xlsxUrl={exportUrl(locationId, "top-sellers", "xlsx", { from, to })}
            csvUrl={exportUrl(locationId, "top-sellers", "csv", { from, to })}
            disabled={!hasData}
          />
        }
      />

      <TableSurface
        filters={
          <>
            <DateRangeControl from={from} to={to} onFrom={setFrom} onTo={setTo} />
            <div className="flex items-center gap-1">
              {LIMITS.map((l) => (
                <Button
                  key={l}
                  variant={limit === l ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLimit(l)}
                >
                  Top {l}
                </Button>
              ))}
            </div>
          </>
        }
      >
        {report.isPending ? (
          <TableLoading />
        ) : !hasData ? (
          <TableEmpty
            icon={TrendingUp}
            title="No sales in this range"
            description="Adjust the dates to find recorded sales."
          />
        ) : (
          <>
            {/* ── Top Brands ── */}
            <p className="border-b px-4 py-2 text-sm font-semibold">Top Brands</p>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="w-10 text-right">#</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data!.topBrands.map((row, i) => (
                  <TableRow key={row.id}>
                    <TableCell className="tnum text-right text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">{row.category ?? "—"}</TableCell>
                    <TableCell className="tnum text-right">{n6(row.qty)}</TableCell>
                    <TableCell className="tnum text-right">{formatMoney(row.revenue)}</TableCell>
                  </TableRow>
                ))}
                {report.data!.topBrands.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No direct item sales in this range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {/* ── Top Menus ── */}
            <p className="border-y px-4 py-2 text-sm font-semibold">Top Menus</p>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="w-10 text-right">#</TableHead>
                  <TableHead>Menu / Cocktail</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data!.topMenus.map((row, i) => (
                  <TableRow key={row.id}>
                    <TableCell className="tnum text-right text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="tnum text-right">{n6(row.qty)}</TableCell>
                    <TableCell className="tnum text-right">{formatMoney(row.revenue)}</TableCell>
                  </TableRow>
                ))}
                {report.data!.topMenus.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No menu sales in this range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {/* ── Top Ingredients ── */}
            <p className="border-y px-4 py-2 text-sm font-semibold">Top Ingredients</p>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="w-10 text-right">#</TableHead>
                  <TableHead>Ingredient</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Qty consumed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data!.topIngredients.map((row, i) => (
                  <TableRow key={row.id}>
                    <TableCell className="tnum text-right text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">{row.category ?? "—"}</TableCell>
                    <TableCell className="tnum text-right">{n6(row.qty)}</TableCell>
                  </TableRow>
                ))}
                {report.data!.topIngredients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No menu sales with recipe snapshots in this range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </>
        )}
      </TableSurface>
    </div>
  );
}
