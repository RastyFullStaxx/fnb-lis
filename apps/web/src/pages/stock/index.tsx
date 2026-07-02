import { useState } from "react";
import { useParams } from "react-router";
import { Boxes, Copy, Plus, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { can, type Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useCopyFromLocation, useLocationItems } from "@/api/location";
import { variantLabel } from "@/api/types";
import { ApiError } from "@/api/http";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/toggle-chip";
import { AttachItemDialog } from "./attach-dialog";
import { PriceEdit } from "./price-edit";

export function StockPage() {
  const me = useMe();
  const [search, setSearch] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const rows = useLocationItems({ search: search || undefined, missingPrices: missingOnly });

  const role = (me.data?.user.role ?? "READONLY") as Role;
  const canEditPrices = can(role, "prices.edit");

  const missingCount = rows.data?.filter((r) => r.cost === 0 || r.retail === 0).length ?? 0;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Stock"
        description="This location's operating catalog — every countable, purchasable, sellable item with its prices."
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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search this catalog…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {missingCount > 0 && (
          <Toggle pressed={missingOnly} onPressedChange={setMissingOnly}>
            <TriangleAlert className="size-3.5" />
            {missingCount} missing price{missingCount === 1 ? "" : "s"}
          </Toggle>
        )}
      </div>

      {rows.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : (rows.data ?? []).length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={search || missingOnly ? "Nothing matches the current filter" : "This location's catalog is empty"}
          description={
            search || missingOnly
              ? "Clear the search or filter to see everything."
              : "Add items from the master catalog, or copy another location's catalog to start fast."
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
        <div className="rounded-lg border">
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
                  <TableRow key={row.id} className={missing ? "bg-destructive/5" : undefined}>
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
        </div>
      )}

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
      toast.success(
        `Copied ${result.copied} item(s)` +
          (result.skipped > 0 ? ` — ${result.skipped} already existed and were kept as-is` : ""),
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
            Brings that location's items and prices into this one. Items already here are left untouched.
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
