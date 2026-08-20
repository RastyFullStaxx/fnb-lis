import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Boxes, Copy, Eye, Info, PackageX, Plus, Scale, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { can, isMissingPrice, isExpiryDatePast, MODULE_TYPE_LABELS, resolveBottleWeights, resolveIsPerishable, type ModuleType, type Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useCopyFromLocation, useCurrentLocation, useLocationId, useLocationItems, useRestoreLocationItem } from "@/api/location";
import type { LocationItem } from "@/api/types";
import { displayVariantLabel } from "@/api/types";
import { ApiError } from "@/api/http";
import { cn } from "@/lib/utils";
import { useItemDisplayUnit } from "@/lib/preferences";
import { useSort } from "@/hooks/use-sort";
import { PageHeader } from "@/components/page-header";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TableEmpty, TableFailure, TableLoading, TableSurface, ToolbarSearch, queryFailed } from "@/components/table-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { Toggle } from "@/components/toggle-chip";
import { AttachItemDialog } from "./attach-dialog";
import { PriceEdit } from "./price-edit";
import { WeightReport } from "./weight-report";
import { WeightEdit } from "./weight-edit";
import { PerishableEdit } from "./perishable-edit";
import { ScheduleEdit } from "./schedule-edit";

/**
 * Tare + liquid weight (density) for the list, and whether either is missing
 * (client req 2026-07-25). Mirrors the server's `missingWeights` rule in
 * services/dashboard.ts: only weighable variants need these, NET mode needs no
 * density, and a density falls back to the item's category default.
 */
function weighInfo(row: LocationItem) {
  const v = row.itemVariant;
  const weighable = v.contentTracked || v.weighMode === "NET" || v.weighMode === "DENSITY";
  // Local override → master variant → category default (client decision
  // 2026-07-25); same rule the counts route and the weigh preview apply.
  const r = resolveBottleWeights(row, v, v.item.category.defaultDensityFactor);
  const noTare = r.tareWeight == null || r.tareWeight <= 0;
  const needsDensity = v.weighMode !== "NET";
  const noDensity = needsDensity && (r.densityFactor == null || r.densityFactor <= 0);
  return {
    weighable,
    noTare,
    noDensity,
    fromLocal: r.fromLocal,
    incomplete: weighable && (noTare || noDensity),
    tare: noTare ? "—" : `${r.tareWeight} ${r.tareWeightUnit ?? "g"}`,
    density: !needsDensity ? "n/a" : noDensity ? "—" : String(r.densityFactor),
  };
}
import { AssetDetailsEdit } from "./asset-details-edit";

export function StockPage() {
  const me = useMe();
  const location = useCurrentLocation();
  const locationId = useLocationId();
  // ?q= seeds the search — the command palette deep-links here with it.
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [missingOnly, setMissingOnly] = useState(params.get("missingPrices") === "1");
  // The notification bell deep-links here; without a matching filter it just
  // dropped you on the whole catalog and left you to find the row.
  const [needsWeightOnly, setNeedsWeightOnly] = useState(params.get("needsWeight") === "1");
  const [reportedOnly, setReportedOnly] = useState(params.get("weightReported") === "1");
  const [attachOpen, setAttachOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  // Folds restore into Local Database (clutter-item-removal plan, Phase 4) —
  // off by default so a hidden row never appears without asking for it.
  const [showHidden, setShowHidden] = useState(false);
  // The expired-batch badge's "on or past today" comparison (Phase 5.1) —
  // computed once per render, same value every row on this screen shares.
  const today = new Date().toISOString().slice(0, 10);
  const fetched = useLocationItems({ search: search || undefined, missingPrices: missingOnly, includeInactive: showHidden });
  // Weight filters are client-side: the same weighInfo() the rows render from,
  // so the chip count and the list can never disagree.
  const rows = {
    ...fetched,
    data: fetched.data?.filter((r) => {
      if (needsWeightOnly && !weighInfo(r).incomplete) return false;
      if (reportedOnly && !r.itemVariant.weightReviewNote) return false;
      return true;
    }),
  };
  // Unfiltered catalog just for the missing-price count, so the chip's label
  // stays stable under search and the filter never strands the user.
  const catalog = useLocationItems();

  // Per-item display unit resolver (client req 2026-07-31,
  // docs/per-user-per-item-uom-plan.md) — same hook Counts and Recipes use,
  // batched over every item currently in view so a staff override or admin
  // default actually shows up on this list, not only in Open Amount entry.
  const allItemIds = useMemo(
    () => Array.from(new Set((rows.data ?? []).map((r) => r.itemVariant.item.id))),
    [rows.data],
  );
  const { resolve: resolveDisplay } = useItemDisplayUnit(allItemIds);

  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;
  const canEditPrices = can(role, "prices.edit");
  // Gates the Clutter Candidates entry point — same permission the
  // underlying endpoints enforce (master.write), distinct from prices.edit
  // even though today's role table happens to grant both to the same roles.
  const canMasterWrite = can(role, "master.write");
  const restore = useRestoreLocationItem();
  const onRestore = async (id: string, name: string) => {
    try {
      await restore.mutateAsync(id);
      toast.success(`${name} restored to catalog.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not restore this item");
    }
  };
  const missingCount =
    catalog.data?.filter((r) => isMissingPrice(r, r.itemVariant.item.category.productType)).length ?? 0;
  const needsWeightCount = catalog.data?.filter((r) => weighInfo(r).incomplete).length ?? 0;
  const reportedCount = catalog.data?.filter((r) => r.itemVariant.weightReviewNote).length ?? 0;
  const locationModules = location?.modules ?? [];
  const moduleScope = locationModules.map((m) => MODULE_TYPE_LABELS[m as ModuleType] ?? m).join(" + ");
  // Asset Details is a whole column of "—" on a Bar or Kitchen catalog, and on a
  // 13" laptop that is width taken from the numbers people came to read.
  const showAssetDetails = locationModules.includes("ASSET");

  const { sortedRows, sortKey, sortDirection, toggleSort } = useSort(rows.data ?? [], {
    accessors: {
      item: (r) => r.itemVariant.item.name,
      category: (r) => r.itemVariant.item.category.name,
      cost: (r) => r.cost ?? 0,
      par: (r) => r.parLevel ?? -Infinity,
      weight: (r) =>
        resolveBottleWeights(r, r.itemVariant, r.itemVariant.item.category.defaultDensityFactor).tareWeight ??
        -Infinity,
      status: (r) => {
        const missing = isMissingPrice(r, r.itemVariant.item.category.productType);
        const weigh = weighInfo(r);
        if (missing) return 0;
        if (weigh.incomplete) return 1;
        if (r.itemVariant.weightReviewNote) return 2;
        return 3;
      },
      expires: (r) => (resolveIsPerishable(r, r.itemVariant.item.category.defaultPerishable) ? 1 : 0),
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={moduleScope ? `Local Database (${moduleScope})` : "Local Database"}
        actions={
          <>
            {canMasterWrite && (
              <Button asChild variant="outline">
                <Link to={`/l/${locationId}/stock/clutter-candidates`}>
                  <PackageX className="size-4" /> Clutter Candidates
                </Link>
              </Button>
            )}
            {canEditPrices && (
              <>
                <Button variant="outline" onClick={() => setCopyOpen(true)}>
                  <Copy className="size-4" /> Copy from Location
                </Button>
                <Button onClick={() => setAttachOpen(true)}>
                  <Plus className="size-4" /> Add Items
                </Button>
              </>
            )}
          </>
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarSearch
              value={search}
              onChange={setSearch}
              placeholder="Search this catalog…"
              label="Search"
            />
            {/* No caption on the chip — its own label already names the filter. */}
            {(missingOnly || missingCount > 0) && (
              <Toggle pressed={missingOnly} onPressedChange={setMissingOnly}>
                <TriangleAlert className="size-3.5" />
                {missingCount > 0
                  ? `${missingCount} missing price${missingCount === 1 ? "" : "s"}`
                  : "Missing prices"}
              </Toggle>
            )}
            {(needsWeightOnly || needsWeightCount > 0) && (
              <Toggle pressed={needsWeightOnly} onPressedChange={setNeedsWeightOnly}>
                <Scale className="size-3.5" />
                {needsWeightCount > 0
                  ? `${needsWeightCount} need${needsWeightCount === 1 ? "s" : ""} weight`
                  : "Needs weight"}
              </Toggle>
            )}
            {(reportedOnly || reportedCount > 0) && (
              <Toggle pressed={reportedOnly} onPressedChange={setReportedOnly}>
                <Scale className="size-3.5" />
                {reportedCount} weight{reportedCount === 1 ? "" : "s"} reported
              </Toggle>
            )}
            {/* Options slot, last per DESIGN.md's toolbar order (tabs, search,
                filters, options) — same master.write gate as the schedule icon
                and the Clutter Candidates entry point, since this is what
                surfaces the rows Restore acts on. */}
            {canMasterWrite && (
              <Toggle pressed={showHidden} onPressedChange={setShowHidden}>
                <Eye className="size-3.5" />
                Show Hidden
              </Toggle>
            )}
          </>
        }
      >
        {queryFailed(rows) ? (
          <TableFailure query={rows} title="Couldn't load this location's catalog" />
        ) : rows.isPending ? (
          <TableLoading />
        ) : (rows.data ?? []).length === 0 ? (
          <TableEmpty
            icon={Boxes}
            title={search || missingOnly ? "Nothing matches the current filter" : "This location's catalog is empty"}
            description={
              search || missingOnly
                ? "Clear the search or filter to see everything."
                : `Add items from the master catalog, or copy another location's catalog to start fast.${
                    moduleScope ? ` This location's catalog covers ${moduleScope} items only.` : ""
                  }`
            }
            action={
              canEditPrices &&
              !search &&
              !missingOnly && (
                <Button onClick={() => setAttachOpen(true)}>
                  <Plus className="size-4" /> Add Items
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <SortableTableHead sortKey="item" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
                  Item
                </SortableTableHead>
                {/* Category costs ~120px it can't justify on a 13" laptop, so
                    below 2xl it moves under the item name instead of being
                    dropped — same information, no horizontal scroll. */}
                <SortableTableHead
                  sortKey="category"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                  className="hidden 2xl:table-cell"
                >
                  Category
                </SortableTableHead>
                <SortableTableHead
                  sortKey="cost"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                  className="text-right"
                >
                  Cost / Retail
                </SortableTableHead>
                <SortableTableHead
                  sortKey="par"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                  className="text-right"
                >
                  {/* "Par" is bar-trade jargon — keep it for the pros, but a
                      hover note spells it out for everyone else. */}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex cursor-help items-center gap-1">
                          Par <Info className="size-3.5 text-muted-foreground" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Stock level to keep on hand — restock when it drops below this.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </SortableTableHead>
                {/* The weigh control lives in this cell rather than a column of
                    its own — a reserved column costs horizontal scroll on a
                    laptop, which is where counting actually happens. */}
                {/* The second number is millilitres per unit of the first, and
                    rendered bare it read as an unexplained "1.0625". The header
                    is the only place with room to say so. */}
                <SortableTableHead
                  sortKey="weight"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                  className="text-right"
                  title="Empty bottle weight, and millilitres of content per unit of that weight"
                >
                  Empty Weight / ml per unit
                </SortableTableHead>
                <SortableTableHead
                  sortKey="status"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                  className="text-right"
                >
                  Status
                </SortableTableHead>
                <SortableTableHead
                  sortKey="expires"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                  className="text-right"
                >
                  {/* Whether this row needs an expiry date at receiving —
                      resolved from the category default unless overridden
                      here (expiry-date-plan.md). */}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex cursor-help items-center gap-1">
                          Expires <Info className="size-3.5 text-muted-foreground" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Whether this item needs an expiry date when it's received. Comes from the
                        category by default; click the clock to override for this location.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </SortableTableHead>
                {showAssetDetails && <SortableTableHead sortable={false} className="text-right">Asset Details</SortableTableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((row) => {
                const missing = isMissingPrice(row, row.itemVariant.item.category.productType);
                const weigh = weighInfo(row);
                const isAsset = row.itemVariant.item.category.productType === "Asset";
                return (
                  <TableRow
                    key={row.id}
                    className={cn("group", missing && row.isActive && "bg-destructive/5", !row.isActive && "opacity-60")}
                  >
                    {/* Wrap rather than truncate — an auditor has to read the whole item name. */}
                    <TableCell className="max-w-[22rem] break-words">
                      <span className="font-medium">{row.itemVariant.item.name}</span>
                      <span className="ml-2 text-sm text-muted-foreground">
                        {displayVariantLabel(row.itemVariant, resolveDisplay(row.itemVariant.item.id, row.itemVariant.unit))}
                      </span>
                      <span className="block text-xs text-muted-foreground 2xl:hidden">
                        {row.itemVariant.item.category.name}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground 2xl:table-cell">
                      {row.itemVariant.item.category.name}
                    </TableCell>
                    <TableCell className="text-right">
                      <PriceEdit row={row} canEdit={canEditPrices && row.isActive} />
                    </TableCell>
                    <TableCell className="tnum text-right">
                      {row.parLevel ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="tnum whitespace-nowrap">
                      {weigh.weighable ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <span>
                            <span className={cn(weigh.noTare && "text-warning-text")}>{weigh.tare}</span>
                            <span className="text-muted-foreground"> / </span>
                            <span className={cn(weigh.noDensity && "text-warning-text")}>{weigh.density}</span>
                            {/* Whose number this is. Without it a manager can't tell
                                their own weighing from the shared default, and
                                re-weighing feels pointless. */}
                            {weigh.fromLocal && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="ml-1.5 cursor-help text-xs text-muted-foreground">own</span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    Your own weighing, recorded here. It applies to this
                                    location only and replaces the standard value.
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </span>
                          {row.isActive && <WeightEdit row={row} />}
                        </div>
                      ) : (
                        <span className="block text-right text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {missing ? (
                        <Badge variant="destructive">No price</Badge>
                      ) : weigh.incomplete ? (
                        // "Needs weight" alone is jargon and a dead end — say
                        // who fixes it, so nobody is left wondering.
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <Badge variant="warning" className="cursor-help">Needs weight</Badge>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              This bottle can't be weighed until someone weighs the
                              empty container — use Weigh on this row. Meanwhile it can
                              be counted whole, or entered as an open amount.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : row.itemVariant.weightReviewNote ? (
                        // An open report IS this row's status — it was its own
                        // column before, which cost width on every other row.
                        <WeightReport row={row} as="badge" />
                      ) : (
                        <Badge variant="success">Ready</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <span>
                          {resolveIsPerishable(row, row.itemVariant.item.category.defaultPerishable) ? (
                            "Perishable"
                          ) : (
                            <span className="text-muted-foreground">Not perishable</span>
                          )}
                          {row.isPerishable != null && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="ml-1.5 cursor-help text-xs text-muted-foreground">own</span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Your own override, recorded here. It applies to this location only
                                  and replaces the category default.
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {/* The oldest open batch on record for this row, past its
                              own date — computed here, never stored (Phase 5.1). A
                              row can be "Perishable" with nothing expired yet, so
                              this is its own badge, not folded into the text above. */}
                          {isExpiryDatePast(row.earliestOpenExpiry, today) && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Badge variant="destructive" className="ml-1.5 cursor-help">
                                      Expired
                                    </Badge>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  At least one delivered batch is past its printed date.
                                  Log a Non-Revenue entry with reason "Expired" to take it
                                  out of stock.
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </span>
                        {row.isActive ? (
                          <>
                            <PerishableEdit row={row} />
                            <ScheduleEdit row={row} />
                          </>
                        ) : (
                          canMasterWrite && (
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={restore.isPending}
                              onClick={() => void onRestore(row.id, row.itemVariant.item.name)}
                            >
                              Restore
                            </Button>
                          )
                        )}
                      </div>
                    </TableCell>
                    {showAssetDetails && (
                    <TableCell className="text-right">
                      {isAsset ? (
                        <div className="flex flex-col items-end gap-1">
                          <AssetDetailsEdit row={row} canEdit={canEditPrices && row.isActive} />
                          {(row.condition || row.status) && (
                            <div className="flex items-center gap-1">
                              {row.condition && <Badge variant="outline">{row.condition}</Badge>}
                              {row.status && <Badge variant="secondary">{row.status}</Badge>}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableSurface>

      <AttachItemDialog open={attachOpen} onOpenChange={setAttachOpen} />
      <CopyFromDialog open={copyOpen} onOpenChange={setCopyOpen} />
    </div>
  );
}

function CopyFromDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const me = useMe();
  const { locationId } = useParams();
  const [sourceId, setSourceId] = useState("");
  const copyFrom = useCopyFromLocation();

  const options = (me.data?.clients ?? []).flatMap((client) =>
    client.locations
      .filter((l) => l.id !== locationId)
      .map((l) => ({ id: l.id, label: `${client.name} · ${l.name}` })),
  );

  const run = async () => {
    if (!sourceId) return;
    try {
      const result = await copyFrom.mutateAsync(sourceId);
      const notes: string[] = [];
      if (result.skipped - result.skippedByModule > 0) {
        notes.push(`${result.skipped - result.skippedByModule} already existed`);
      }
      if (result.skippedByModule > 0) {
        notes.push(`${result.skippedByModule} outside this location's assigned modules`);
      }
      toast.success(
        `Copied ${result.copied} ${result.copied === 1 ? "item" : "items"}` +
          (notes.length > 0 ? ` — ${notes.join("; ")}` : ""),
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Copy failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copy Catalog from Another Location</DialogTitle>
          <DialogDescription>
            Brings that location's items and prices into this one. Items already here — or outside this
            location's assigned modules — are left out.
          </DialogDescription>
        </DialogHeader>
        <Select value={sourceId} onValueChange={setSourceId}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a source location" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button onClick={run} disabled={!sourceId || copyFrom.isPending}>
            {copyFrom.isPending ? "Copying…" : "Copy Catalog"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
