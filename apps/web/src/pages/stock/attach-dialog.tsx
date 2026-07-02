import { useState } from "react";
import { toast } from "sonner";
import { useAttachLocationItem, useAvailableVariants } from "@/api/location";
import { variantLabel, type AvailableVariant } from "@/api/types";
import { ApiError } from "@/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

/** Adds a master-catalog variant into this location's catalog with prices. */
export function AttachItemDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AvailableVariant | null>(null);
  const [cost, setCost] = useState("");
  const [retail, setRetail] = useState("");
  const available = useAvailableVariants({ search: search || undefined }, open);
  const attach = useAttachLocationItem();

  const reset = () => {
    setSearch("");
    setSelected(null);
    setCost("");
    setRetail("");
  };

  const save = async () => {
    if (!selected) return;
    try {
      await attach.mutateAsync({
        itemVariantId: selected.id,
        cost: Number(cost) || 0,
        retail: Number(retail) || 0,
      });
      toast.success(`${selected.item.name} ${variantLabel(selected)} added to this location`);
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add the item");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add item to this location</DialogTitle>
          <DialogDescription>
            Pick a size from the master catalog, then set this location's cost and retail price.
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <Command shouldFilter={false} className="rounded-lg border">
            <CommandInput placeholder="Search the master catalog…" value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>
                {available.isPending ? "Searching…" : "No available items — everything may already be in this catalog."}
              </CommandEmpty>
              <CommandGroup>
                {(available.data ?? []).map((v) => (
                  <CommandItem key={v.id} value={v.id} onSelect={() => setSelected(v)}>
                    <span className="flex-1">
                      {v.item.name}
                      <span className="ml-2 text-muted-foreground">{variantLabel(v)}</span>
                    </span>
                    <Badge variant="outline">{v.item.category.name}</Badge>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border bg-muted px-3 py-2">
              <div>
                <p className="font-medium">{selected.item.name}</p>
                <p className="text-sm text-muted-foreground">
                  {variantLabel(selected)} · {selected.item.category.name}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Change
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="attach-cost">Cost</Label>
                <Input
                  id="attach-cost"
                  type="number"
                  step="any"
                  min="0"
                  className="tnum"
                  autoFocus
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="attach-retail">Retail</Label>
                <Input
                  id="attach-retail"
                  type="number"
                  step="any"
                  min="0"
                  className="tnum"
                  value={retail}
                  onChange={(e) => setRetail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && save()}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Prices left at 0 flag the item as unpriced — reports need both cost and retail.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button onClick={save} disabled={!selected || attach.isPending}>
            {attach.isPending ? "Adding…" : "Add to catalog"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
