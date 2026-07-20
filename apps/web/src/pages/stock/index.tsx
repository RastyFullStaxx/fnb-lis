import { useState } from "react";
import { useParams } from "react-router";
import { Boxes, Copy, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { can, MODULE_TYPE_LABELS, type ModuleType, type Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useCopyFromLocation, useCurrentLocation, useLocationItems } from "@/api/location";
import { variantLabel } from "@/api/types";
import { ApiError } from "@/api/http";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, ToolbarSearch } from "@/components/table-surface";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Toggle } from "@/components/toggle-chip";
import { AttachItemDialog } from "./attach-dialog";
import { PriceEdit } from "./price-edit";

export function StockPage() {
  const me = useMe();
  const location = useCurrentLocation();
  const [search, setSearch] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const rows = useLocationItems({ search: search || undefined, missingPrices: missingOnly });
  // Unfiltered catalog just for the missing-price count, so the chip's label
  // stays stable under search and the filter never strands the user.
  const catalog = useLocationItems();

  const role = (me.data?.user.role ?? "READONLY") as Role;
  const canEditPrices = can(role, "prices.edit");

  const missingCount = catalog.data?.filter((r) => r.cost === 0 || r.retail === 0).length ?? 0;
  const locationModules = location?.modules ?? [];
  const moduleScope = locationModules.map((m) => MODULE_TYPE_LABELS[m as ModuleType] ?? m).join(" + ");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Stock"
        actions={
          canEditPrices && (
            <>
              <Button variant="outline" onClick={() => setCopyOpen(true)}>
                <Copy className="size-4" /> Copy from location
              </Button>
              <Button onClick={() => setAttachOpen(true)}>
                <Plus className="size-4" /> Add items
              </Button>
            </>
          )
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarSearch value={search} onChange={setSearch} placeholder="Search this catalog…" />
            {(missingOnly || missingCount > 0) && (
              <Toggle pressed={missingOnly} onPressedChange={setMissingOnly}>
                <TriangleAlert className="size-3.5" />
                {missingCount > 0
                  ? `${missingCount} missing price${missingCount === 1 ? "" : "s"}`
                  : "Missing prices"}
              </Toggle>
            )}
          </>
        }
        actions={
          moduleScope ? (
            <span className="text-xs text-muted-foreground">{moduleScope} catalog</span>
          ) : undefined
        }
      >
        {rows.isPending ? (
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
                  <Plus className="size-4" /> Add items
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Cost / Retail</TableHead>
                <TableHead className="text-right">Par</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.data!.map((row) => {
                const missing = row.cost === 0 || row.retail === 0;
                return (
                  <TableRow key={row.id} className={cn("group", missing && "bg-destructive/5")}>
                    <TableCell>
                      <span className="font-medium">{row.itemVariant.item.name}</span>
                      <span className="ml-2 text-sm text-muted-foreground">{variantLabel(row.itemVariant)}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.itemVariant.item.category.name}
                    </TableCell>
                    <TableCell className="text-right">
                      <PriceEdit row={row} canEdit={canEditPrices} />
                    </TableCell>
                    <TableCell className="tnum text-right">
                      {row.parLevel ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {missing ? (
                        <Badge variant="destructive">No price</Badge>
                      ) : (
                        <Badge variant="secondary">Ready</Badge>
                      )}
                    </TableCell>
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
          <DialogTitle>Copy catalog from another location</DialogTitle>
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
            {copyFrom.isPending ? "Copying…" : "Copy catalog"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
