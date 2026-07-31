import { useEffect, useState } from "react";
import { Scale } from "lucide-react";
import { toast } from "sonner";
import { can, resolveBottleWeights, type Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useUpdateLocationItem } from "@/api/location";
import { ApiError } from "@/api/http";
import type { LocationItem } from "@/api/types";
import { cn } from "@/lib/utils";
import { WeightReport } from "./weight-report";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { QuantityInput } from "@/components/quantity-input";
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

/**
 * The client weighs their own bottle and records it here (client decision
 * 2026-07-25: "sila na mag timbang… dapat din makita nila").
 *
 * It saves onto THIS location's catalog row, never the master variant —
 * ItemVariant is shared by every tenant, so editing it would silently rewrite
 * another client's numbers. Blank falls back to the master value.
 */
export function WeightEdit({ row }: { row: LocationItem }) {
  const me = useMe();
  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;
  // Same permission the PUT enforces (prices.edit), so the button can never
  // appear to someone the server will refuse.
  const canEdit = can(role, "prices.edit");
  const update = useUpdateLocationItem();
  const [open, setOpen] = useState(false);

  const v = row.itemVariant;
  const resolved = resolveBottleWeights(row, v, v.item.category.defaultDensityFactor);
  const weighable = v.contentTracked || v.weighMode === "NET" || v.weighMode === "DENSITY";
  const needsDensity = v.weighMode !== "NET";
  // A bottle that can't be weighed yet is the whole reason this button exists,
  // so it stays visible — the "Needs weight" badge two columns over is useless
  // if the fix for it only appears on hover. Once weights are in, re-weighing
  // is rare, so it recedes and stops competing with the numbers.
  const incomplete =
    (resolved.tareWeight ?? 0) <= 0 || (needsDensity && (resolved.densityFactor ?? 0) <= 0);

  const [tare, setTare] = useState("");
  const [unit, setUnit] = useState<"g" | "oz">("g");
  const [density, setDensity] = useState("");

  // Seed from the OVERRIDE only — an empty box has to mean "inheriting the
  // master", or saving an untouched dialog would silently pin today's master
  // value onto this location forever.
  useEffect(() => {
    if (!open) return;
    setTare(row.tareWeight != null ? String(row.tareWeight) : "");
    setUnit((row.tareWeightUnit ?? resolved.tareWeightUnit ?? "g") as "g" | "oz");
    setDensity(row.densityFactor != null ? String(row.densityFactor) : "");
  }, [open, row.tareWeight, row.tareWeightUnit, row.densityFactor, resolved.tareWeightUnit]);

  if (!weighable || !canEdit) return null;

  const save = async () => {
    const t = tare.trim() === "" ? null : Number(tare);
    const d = density.trim() === "" ? null : Number(density);
    if (t !== null && (!Number.isFinite(t) || t < 0)) return toast.error("Enter a valid empty weight");
    if (d !== null && (!Number.isFinite(d) || d <= 0)) return toast.error("Enter a valid liquid weight");
    try {
      await update.mutateAsync({
        id: row.id,
        tareWeight: t,
        tareWeightUnit: t === null ? null : unit,
        densityFactor: d,
      });
      toast.success(`Weights saved for ${v.item.name}`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the weights");
    }
  };

  return (
    <>
      {/* Always visible. It sits in the weights cell itself, so there is no
          reserved column to pay for and nothing to discover by hovering — the
          icon alone when a weight exists, spelled out when one is missing. */}
      <Button
        variant={incomplete ? "outline" : "ghost"}
        size="xs"
        className={cn("shrink-0", !incomplete && "size-6 p-0 text-muted-foreground")}
        title={incomplete ? undefined : "Re-weigh this bottle"}
        aria-label={incomplete ? undefined : `Weigh ${v.item.name}`}
        onClick={() => setOpen(true)}
      >
        <Scale className="size-3.5" />
        {incomplete && "Weigh"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bottle weights — {v.item.name}</DialogTitle>
            <DialogDescription>
              Weigh the empty container and record it here. This applies to your
              catalog only; leave a box blank to use the standard value.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-[1fr_6rem] items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="wt-tare">Empty (tare) weight</Label>
                <QuantityInput
                  id="wt-tare"
                  className="tnum"
                  autoFocus
                  placeholder={resolved.tareWeight != null ? `Standard: ${resolved.tareWeight}` : "Weigh the empty bottle"}
                  value={tare}
                  onChange={(e) => setTare(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wt-unit">Unit</Label>
                <Select value={unit} onValueChange={(u) => setUnit(u as "g" | "oz")}>
                  <SelectTrigger id="wt-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="g">g</SelectItem>
                    <SelectItem value="oz">oz</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {needsDensity && (
              <div className="space-y-1.5">
                <Label htmlFor="wt-density">Liquid weight</Label>
                <QuantityInput
                  id="wt-density"
                  className="tnum"
                  placeholder={resolved.densityFactor != null ? `Standard: ${resolved.densityFactor}` : "ml per gram/oz"}
                  value={density}
                  onChange={(e) => setDensity(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  ml of liquid per gram/oz — turns a scale reading into remaining volume.
                </p>
              </div>
            )}

            {row.tareWeight == null && row.densityFactor == null && resolved.tareWeight != null && (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Currently using the standard values. Anything you enter here overrides
                them for this location only.
              </p>
            )}
          </div>

          <DialogFooter>
            <WeightReport row={row} />
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Go Back
            </Button>
            <Button onClick={() => void save()} disabled={update.isPending}>
              Save weights
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
