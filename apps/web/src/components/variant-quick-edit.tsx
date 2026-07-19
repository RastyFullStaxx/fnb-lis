import { useEffect, useState } from "react";
import { Scale } from "lucide-react";
import { toast } from "sonner";
import { useUpdateVariant } from "@/api/master";
import { ApiError } from "@/api/http";
import { defaultWeighUnit, useUnitSystem } from "@/lib/preferences";
import type { ItemVariant } from "@/api/types";
import { Button } from "@/components/ui/button";
import { QuantityInput } from "@/components/quantity-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Set or correct a single variant's bottle (tare) weight, unit, and density
 * factor. This is the one place in the app that can touch these fields on an
 * *existing* item — the New Item sheet only sets them at creation.
 *
 * Reused from two entry points:
 *  - Counts, in the moment a counter hits a bottle with no weight configured
 *    (title/description lean on "this bottle").
 *  - Items, for deliberate catalog maintenance (title/description lean on
 *    "this variant").
 * Both call the same `useUpdateVariant` mutation the server has exposed all
 * along (PUT /variants/:id) — nothing new on the backend.
 */
export function VariantQuickEditDialog({
  open,
  onOpenChange,
  itemName,
  variant,
  categoryDefaultDensity,
  context = "items",
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** For the dialog title, e.g. "Grey Goose". */
  itemName: string;
  variant: Pick<ItemVariant, "id" | "size" | "tareWeight" | "tareWeightUnit" | "densityFactor"> & {
    unit: { name: string };
  };
  /** Category default density factor, shown as a placeholder when the variant has none of its own — same fallback the weigh calculator itself uses. */
  categoryDefaultDensity?: number | null;
  /** Adjusts copy for where the dialog was opened from; the mutation is identical either way. */
  context?: "counts" | "purchases" | "items";
  /** Called with the server's updated variant after a successful save, so the caller can patch its own local state (e.g. the item mid-count) without waiting on a refetch. */
  onSaved?: (variant: ItemVariant) => void;
}) {
  const unitSystem = useUnitSystem();
  const updateVariant = useUpdateVariant();

  const [tareWeight, setTareWeight] = useState("");
  const [tareWeightUnit, setTareWeightUnit] = useState<"g" | "oz">(defaultWeighUnit(unitSystem));
  const [densityFactor, setDensityFactor] = useState("");

  // Re-seed from the current variant every time the dialog opens, so
  // reopening it for a different (or since-updated) variant never shows
  // stale values left over from a previous edit.
  useEffect(() => {
    if (!open) return;
    setTareWeight(variant.tareWeight != null ? String(variant.tareWeight) : "");
    setTareWeightUnit(variant.tareWeightUnit ?? defaultWeighUnit(unitSystem));
    setDensityFactor(variant.densityFactor != null ? String(variant.densityFactor) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, variant.id]);

  const tareNum = tareWeight === "" ? null : Number(tareWeight);
  const densityNum = densityFactor === "" ? null : Number(densityFactor);
  const tareValid = tareNum === null || (Number.isFinite(tareNum) && tareNum >= 0);
  const densityValid = densityNum === null || (Number.isFinite(densityNum) && densityNum > 0);
  // A bottle weight without a way to convert the reading into content isn't
  // usable yet — require both, or neither, rather than saving a half state
  // that still blocks weighing.
  const hasDensitySomewhere = densityNum !== null || (categoryDefaultDensity ?? 0) > 0;
  const canSave =
    tareNum !== null && tareNum >= 0 && tareValid && densityValid && hasDensitySomewhere;

  const save = async () => {
    if (!canSave) return;
    try {
      const updated = await updateVariant.mutateAsync({
        id: variant.id,
        tareWeight: tareNum,
        tareWeightUnit,
        densityFactor: densityNum,
      });
      toast.success("Bottle weight saved");
      onSaved?.(updated);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the bottle weight");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="size-4" /> {itemName} · {variant.size} {variant.unit.name}
          </DialogTitle>
          <DialogDescription>
            {context === "counts"
              ? "Weigh the empty bottle once and save it here — this count will pick it up immediately."
              : context === "purchases"
                ? "Weigh the empty bottle once and save it here — this return will pick it up immediately."
                : "Sets the empty-container weight and conversion used whenever this variant is weighed."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="qe-tare" className="text-xs">
              Tare weight
            </Label>
            <QuantityInput
              id="qe-tare"
              autoFocus
              className="tnum"
              placeholder="empty container"
              value={tareWeight}
              onChange={(e) => setTareWeight(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tare unit</Label>
            <Select value={tareWeightUnit} onValueChange={(v) => setTareWeightUnit(v as "g" | "oz")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="g">g</SelectItem>
                <SelectItem value="oz">oz</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label className="text-xs">Liquid Weight</Label>
            <QuantityInput
              className="tnum"
              placeholder={
                categoryDefaultDensity
                  ? `${categoryDefaultDensity} (category default)`
                  : "ml per weight unit"
              }
              value={densityFactor}
              onChange={(e) => setDensityFactor(e.target.value)}
            />
          </div>
        </div>
        {!hasDensitySomewhere && (
          <p className="text-xs text-muted-foreground">
            This category has no default Liquid Weight either — enter one here so this variant can be
            weighed.
          </p>
        )}
        {!tareValid && <p className="text-sm text-destructive">Tare weight must be zero or more.</p>}
        {tareValid && !densityValid && (
          <p className="text-sm text-destructive">Liquid Weight must be greater than zero.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave || updateVariant.isPending}>
            {updateVariant.isPending ? "Saving…" : "Save bottle weight"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
