import { useState } from "react";
import { Wine } from "lucide-react";
import { toast } from "sonner";
import { useBottleKeepMutations, useBottleKeeps, useAreas, type BottleKeep } from "@/api/location";
import { ApiError } from "@/api/http";
import type { LocationItem } from "@/api/types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Bottle Keep, on the count screen (client req 2026-08-04: "pag pinasok yan sa
 * count").
 *
 * Two jobs, and the first is the one that protects the numbers.
 *
 * **1. Warn that kept bottles must not be counted.** A bottle a guest paid for
 * is physically on the shelf, but the sale already took it out of stock. Count
 * it and `end` is one too high, so usage drops by one, so the Full Audit reports
 * an over that never happened — and then a matching short when the guest comes
 * back and drinks it with no sale behind it. Nothing in the arithmetic can catch
 * that; only the person holding the shelf can. So the moment they pick an item
 * with bottles on keep, the screen says so.
 *
 * **2. Record a new keep without leaving the count.** Deliberately OUTSIDE the
 * Enter-to-save loop: picking an item, typing a number and pressing Enter is the
 * rhythm the whole screen is built around, and a keep is rare next to that. It
 * is a button and a dialog, not another field in the path.
 */

const DEFAULT_KEEP_DAYS = 30;

export function BottleKeepInline({
  item,
  countDate,
}: {
  item: LocationItem | null;
  /**
   * The COUNT's business date, not today.
   *
   * A keep recorded while counting belongs to the day being counted, and on an
   * offline desktop the device clock may be wrong — the count date is a value a
   * human already agreed to.
   */
  countDate: string;
}) {
  const [open, setOpen] = useState(false);
  const keeps = useBottleKeeps({ status: "ACTIVE" });

  if (!item) return null;

  const mine: BottleKeep[] = (keeps.data?.rows ?? []).filter((k) => k.locationItem?.id === item.id);
  const bottles = mine.reduce((n, k) => n + k.qty, 0);

  return (
    <div className="mt-3">
      {mine.length > 0 && (
        <div className="mb-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
          <p className="text-sm">
            <span className="font-medium">
              {bottles} {bottles === 1 ? "bottle is" : "bottles are"} on keep for a guest — do not
              count {bottles === 1 ? "it" : "them"}.
            </span>{" "}
            <span className="text-muted-foreground">
              {/* One entry per guest with a count, not one per bottle — a guest
                  holding two bottles read as "Lourd B., Ramon D., Lourd B.",
                  which looks like a bug in the list rather than a fact about
                  the shelf. */}
              {Object.entries(
                mine.reduce<Record<string, number>>((acc, k) => {
                  const name = k.customerName.trim();
                  acc[name] = (acc[name] ?? 0) + 1;
                  return acc;
                }, {}),
              )
                .map(([name, n]) => (n > 1 ? `${name} (${n})` : name))
                .join(", ")}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Paid for already, so the sale has taken {bottles === 1 ? "it" : "them"} out of stock.
            Counting {bottles === 1 ? "it" : "them"} would show an over that isn't there.
          </p>
        </div>
      )}

      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <Wine className="size-3.5" /> Bottle keep
      </Button>

      <KeepDialog item={item} countDate={countDate} open={open} onOpenChange={setOpen} />
    </div>
  );
}

function KeepDialog({
  item,
  countDate,
  open,
  onOpenChange,
}: {
  item: LocationItem;
  countDate: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { create } = useBottleKeepMutations();
  const areas = useAreas();
  const areaList = (areas.data ?? []).filter((a) => a.status === "ACTIVE");

  const [customerName, setCustomerName] = useState("");
  const [contact, setContact] = useState("");
  const [days, setDays] = useState(String(DEFAULT_KEEP_DAYS));
  const [areaId, setAreaId] = useState("");

  const save = async () => {
    const name = customerName.trim();
    if (!name) return toast.error("Whose bottle is it?");
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0) return toast.error("How many days is it kept for?");
    try {
      await create.mutateAsync({
        // Client-supplied id so an offline replay cannot create a second
        // bottle for the same guest — see routes/bottle-keep.ts.
        id: crypto.randomUUID(),
        locationItemId: item.id,
        ...(areaId ? { areaId } : {}),
        customerName: name,
        ...(contact.trim() ? { customerContact: contact.trim() } : {}),
        keptDate: countDate,
        expiryDays: n,
        qty: 1,
      });
      toast.success(`Bottle kept for ${name}`);
      setCustomerName("");
      setContact("");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not record the bottle keep");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keep a bottle for a guest</DialogTitle>
          <DialogDescription>
            {item.itemVariant.item.name} {item.itemVariant.size ?? ""}{" "}
            {item.itemVariant.unit?.name ?? ""} — paid for, left to finish next visit. It stays out
            of sellable stock until it expires.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="bk-name">Guest name</Label>
            <Input
              id="bk-name"
              autoFocus
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Ramon D."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bk-contact">Contact (optional)</Label>
            <Input id="bk-contact" value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="bk-days">Kept for (days)</Label>
              <Input
                id="bk-days"
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">From {countDate}.</p>
            </div>
            {areaList.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="bk-area">Stored in</Label>
                <Select value={areaId || "__none__"} onValueChange={(v) => setAreaId(v === "__none__" ? "" : v)}>
                  <SelectTrigger id="bk-area">
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not set</SelectItem>
                    {areaList.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Go Back
          </Button>
          <Button onClick={() => void save()} disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Keep bottle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
