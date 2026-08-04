import { useMemo, useState } from "react";
import { ClipboardList, Printer } from "lucide-react";
import { useAreas, useCurrentLocation, useLocationItems } from "@/api/location";
import { formatDate } from "@/lib/utils";
import type { LocationItem } from "@/api/types";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Physical Count Sheet (proposal §3.11) — the paper you carry round the bar.
 *
 * This matters more on a single-computer install than anywhere else in the
 * system: when the one machine running the desktop dies mid-count, paper is the
 * establishment's only fallback. See docs/sync-and-data-lifecycle.md §6.
 *
 * It is a BLIND sheet, deliberately. No expected quantity, no par level, no
 * cost, no retail — nothing that tells the counter what the answer is supposed
 * to be. Printing the expected figure next to an empty box is how you get people
 * copying the system's number instead of counting the shelf, and the gap between
 * those two numbers is the entire product. Every other report here exists to
 * show expected-vs-actual; this one exists to collect the actual.
 */

type Grouping = "category" | "alphabetical";

/** Weighable items get a scale column — an open bottle can't be a whole number. */
function isWeighable(row: LocationItem): boolean {
  const v = row.itemVariant;
  return v.contentTracked || v.weighMode === "NET" || v.weighMode === "DENSITY";
}

export function CountSheetPage() {
  const location = useCurrentLocation();
  const catalog = useLocationItems();
  const areas = useAreas();
  /**
   * One tally column per storage area, straight off the client's own sheet
   * (MAIN BAR / COCKTAIL LOUNGE / BEER HALL / STOCK ROOM), plus a Total the
   * counter adds up — they already write that in the margin.
   *
   * A location with no areas keeps the original single "Full units" column, so
   * nothing changes for anyone who counts one room.
   */
  const areaCols = (areas.data ?? []).filter((a) => a.status === "ACTIVE");
  const hasAreas = areaCols.length > 0;
  const [grouping, setGrouping] = useState<Grouping>("category");

  const groups = useMemo(() => {
    const rows = (catalog.data ?? []).filter((r) => r.isActive);
    const label = (r: LocationItem) => `${r.itemVariant.item.name} ${r.itemVariant.size ?? ""}`.trim();
    const byName = (a: LocationItem, b: LocationItem) => label(a).localeCompare(label(b));

    if (grouping === "alphabetical") {
      return [{ title: "All items", rows: [...rows].sort(byName) }];
    }
    const map = new Map<string, LocationItem[]>();
    for (const r of rows) {
      const key = r.itemVariant.item.category?.name ?? "Uncategorised";
      const list = map.get(key);
      if (list) list.push(r);
      else map.set(key, [r]);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([title, list]) => ({ title, rows: list.sort(byName) }));
  }, [catalog.data, grouping]);

  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Physical Count Sheet"
        actions={
          <div className="flex items-center gap-3 print:hidden">
            <div className="flex items-center gap-2">
              <Label htmlFor="cs-group" className="text-sm text-muted-foreground">
                Order
              </Label>
              <Select value={grouping} onValueChange={(v) => setGrouping(v as Grouping)}>
                <SelectTrigger id="cs-group" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="category">By category</SelectItem>
                  <SelectItem value="alphabetical">Alphabetical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => window.print()}>
              <Printer className="size-4" />
              Print
            </Button>
          </div>
        }
      />

      {/* Print-only header: the sheet has to identify itself once it's on paper
          and away from the screen that said which location it came from. */}
      <div className="hidden print:block">
        <h1 className="text-base font-semibold">Physical Count Sheet — {location?.name ?? ""}</h1>
        <p className="mt-1 text-xs">
          Printed {formatDate(new Date().toISOString().slice(0, 10))} · {total} items ·{" "}
          {grouping === "category" ? "by category" : "alphabetical"}
        </p>
        <p className="mt-3 text-xs">
          Counted by ________________________ Date ______________ Checked by ________________________
        </p>
      </div>

      <p className="mt-2 max-w-prose text-sm text-muted-foreground print:hidden">
        A blind sheet — it deliberately shows no expected quantities or values, so what gets written
        down is what's actually on the shelf.
      </p>

      <div className="mt-4 flex-1 overflow-auto">
        {catalog.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : total === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            This location's catalog is empty — add items before printing a count sheet.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.title} className="mb-6 break-inside-avoid">
              <h2 className="mb-1 text-sm font-semibold">{group.title}</h2>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="w-[8%] py-1 text-left font-medium">Code</th>
                    <th className="py-1 text-left font-medium">Item</th>
                    <th className="w-[10%] py-1 text-left font-medium">Size</th>
                    {hasAreas ? (
                      <>
                        {areaCols.map((a) => (
                          <th key={a.id} className="py-1 text-left font-medium">
                            {a.name}
                          </th>
                        ))}
                        <th className="w-[9%] py-1 text-left font-medium">Total</th>
                      </>
                    ) : (
                      <th className="w-[14%] py-1 text-left font-medium">Full units</th>
                    )}
                    <th className="w-[12%] py-1 text-left font-medium">Open / scale</th>
                    <th className="w-[14%] py-1 text-left font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-1.5 align-bottom text-xs text-muted-foreground">
                        {r.assetCode ?? ""}
                      </td>
                      <td className="py-1.5 align-bottom">{r.itemVariant.item.name}</td>
                      <td className="py-1.5 align-bottom text-muted-foreground">
                        {r.itemVariant.size ?? ""} {r.itemVariant.unit?.name ?? ""}
                      </td>
                      {/* Ruled write-in boxes rather than empty cells: an
                          underline tells a counter where to put the number. */}
                      {hasAreas ? (
                        <>
                          {areaCols.map((a) => (
                            <td key={a.id} className="py-1.5 align-bottom">
                              <span className="block h-4 border-b border-dashed border-muted-foreground/50" />
                            </td>
                          ))}
                          {/* Solid rule, not dashed: the total is the one number
                              transcribed into the system, so it should look
                              different from the tallies feeding it. */}
                          <td className="py-1.5 align-bottom">
                            <span className="block h-4 border-b border-muted-foreground" />
                          </td>
                        </>
                      ) : (
                        <td className="py-1.5 align-bottom">
                          <span className="block h-4 border-b border-dashed border-muted-foreground/50" />
                        </td>
                      )}
                      <td className="py-1.5 align-bottom">
                        {isWeighable(r) ? (
                          <span className="block h-4 border-b border-dashed border-muted-foreground/50" />
                        ) : (
                          <span className="block text-center text-xs text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="py-1.5 align-bottom">
                        <span className="block h-4 border-b border-dashed border-muted-foreground/50" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
