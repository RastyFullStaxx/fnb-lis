import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { toast } from "sonner";
import { can, resolveIsPerishable, type Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useUpdateLocationItem } from "@/api/location";
import { ApiError } from "@/api/http";
import type { LocationItem } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

/** Three-state sentinel for the Select — "" means Inherit (writes null). */
const INHERIT = "";
const TRUE = "true";
const FALSE = "false";

/**
 * Per-location override of Category.defaultPerishable (expiry-date-plan.md,
 * phase 2.2). Same shape as WeightEdit: saves onto THIS location's catalog
 * row, never the category itself, so overriding one establishment's call on
 * Cooking Oil never touches another client's Dry Goods category.
 *
 * Two-tier resolve, not three (constants.ts resolveIsPerishable) — a policy
 * call, not a physical measurement, so there is no ItemVariant middle tier
 * and no per-variant field to hold it.
 */
export function PerishableEdit({ row }: { row: LocationItem }) {
  const me = useMe();
  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;
  // Same permission the PUT enforces (prices.edit), so the button can never
  // appear to someone the server will refuse.
  const canEdit = can(role, "prices.edit");
  const update = useUpdateLocationItem();
  const [open, setOpen] = useState(false);

  const category = row.itemVariant.item.category;
  const resolved = resolveIsPerishable(row, category.defaultPerishable);

  const [choice, setChoice] = useState<string>(INHERIT);

  // Seed from the OVERRIDE only — an untouched dialog has to mean "inheriting
  // the category", or saving it would silently pin today's resolved value
  // onto this location forever.
  useEffect(() => {
    if (!open) return;
    setChoice(row.isPerishable == null ? INHERIT : row.isPerishable ? TRUE : FALSE);
  }, [open, row.isPerishable]);

  if (!canEdit) return null;

  const save = async () => {
    try {
      await update.mutateAsync({
        id: row.id,
        isPerishable: choice === INHERIT ? null : choice === TRUE,
      });
      toast.success(`Expiry tracking saved for ${row.itemVariant.item.name}`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save expiry tracking");
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        className="size-6 shrink-0 p-0 text-muted-foreground"
        title="Expiry tracking for this location"
        aria-label={`Expiry tracking for ${row.itemVariant.item.name}`}
        onClick={() => setOpen(true)}
      >
        <Clock className="size-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Expiry tracking — {row.itemVariant.item.name}</DialogTitle>
            <DialogDescription>
              Whether this item needs a real expiry date at receiving. This applies to your
              location's catalog only; Inherit falls back to the "{category.name}" category's own
              setting.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="perishable-choice">Tracking</Label>
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger id="perishable-choice">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT}>Inherit from category</SelectItem>
                <SelectItem value={TRUE}>Perishable</SelectItem>
                <SelectItem value={FALSE}>Not perishable</SelectItem>
              </SelectContent>
            </Select>
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Currently resolves to{" "}
              <span className="font-medium text-foreground">
                {resolved ? "Perishable" : "Not perishable"}
              </span>
              {row.isPerishable == null
                ? ` — from the "${category.name}" category default.`
                : " — your own override for this location."}
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Go Back
            </Button>
            <Button onClick={() => void save()} disabled={update.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
