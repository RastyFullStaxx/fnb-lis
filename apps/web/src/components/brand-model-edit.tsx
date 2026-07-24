import { useEffect, useState } from "react";
import { Tag } from "lucide-react";
import { toast } from "sonner";
import { useUpdateVariant } from "@/api/master";
import { ApiError } from "@/api/http";
import type { ItemVariant } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Set or correct a single variant's Brand/Model (architecture.md deviation
 * #21) on an *existing* item — the New Item sheet (item-form.tsx) only sets
 * these at creation, the same gap `VariantQuickEditDialog` closes for bottle
 * weight. Kept as its own dialog rather than folded into that one: Brand/
 * Model are plain catalog fields with no validity math (unlike tare/density),
 * so sharing the weighing dialog's `canSave` gating would be the wrong shape
 * for two optional text fields.
 *
 * Same `useUpdateVariant` mutation (PUT /variants/:id) as the weighing dialog
 * — nothing new on the backend.
 */
export function BrandModelEditDialog({
  open,
  onOpenChange,
  itemName,
  variant,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** For the dialog title, e.g. "Upright Freezer". */
  itemName: string;
  variant: Pick<ItemVariant, "id" | "size" | "brand" | "model"> & { unit: { name: string } };
  /** Called with the server's updated variant after a successful save, so the caller can patch its own local state without waiting on a refetch. */
  onSaved?: (variant: ItemVariant) => void;
}) {
  const updateVariant = useUpdateVariant();

  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");

  // Re-seed from the current variant every time the dialog opens, so
  // reopening it for a different (or since-updated) variant never shows
  // stale values left over from a previous edit.
  useEffect(() => {
    if (!open) return;
    setBrand(variant.brand ?? "");
    setModel(variant.model ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, variant.id]);

  const save = async () => {
    try {
      const updated = await updateVariant.mutateAsync({
        id: variant.id,
        brand: brand.trim() === "" ? null : brand.trim(),
        model: model.trim() === "" ? null : model.trim(),
      });
      toast.success("Brand/Model saved");
      onSaved?.(updated);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save Brand/Model");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="size-4" /> {itemName} · {variant.size} {variant.unit.name}
          </DialogTitle>
          <DialogDescription>Sets the brand and model recorded for this variant.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="qe-brand" className="text-xs">
              Brand
            </Label>
            <Input
              id="qe-brand"
              autoFocus
              placeholder="e.g. Samsung"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qe-model" className="text-xs">
              Model
            </Label>
            <Input
              id="qe-model"
              placeholder="e.g. RT38"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={updateVariant.isPending}>
            {updateVariant.isPending ? "Saving…" : "Save Brand/Model"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
