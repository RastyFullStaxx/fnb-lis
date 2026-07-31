import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { isMissingPrice } from "@fnb/core";
import { useActivity } from "@/api/activity";
import { useUpdateLocationItem } from "@/api/location";
import type { LocationItem } from "@/api/types";
import { ApiError } from "@/api/http";
import { cn, formatMoney, formatUnitPrice } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { QuantityInput } from "@/components/quantity-input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Client req 2026-07-31: same guard as the Activity page (46.1) — the
 * server tags `locationItem.priceChange` on ANY catalog edit that isn't a
 * weight or asset field, so a retail/parLevel/isActive-only save also
 * carries this action with `new.cost` left undefined. Only treat it as a
 * price change when cost is present on both sides and actually differs.
 */
function lastPriceChange(details: string | null): { oldCost: number; newCost: number } | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details) as { old?: { cost?: number }; new?: { cost?: number } };
    const oldCost = parsed.old?.cost;
    const newCost = parsed.new?.cost;
    if (oldCost === undefined || newCost === undefined || oldCost === newCost) return null;
    return { oldCost, newCost };
  } catch {
    return null;
  }
}

/** Click-to-edit prices; changes are logged with old/new values in the activity trail. */
export function PriceEdit({ row, canEdit }: { row: LocationItem; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [cost, setCost] = useState(String(row.cost));
  const [retail, setRetail] = useState(String(row.retail));
  const [par, setPar] = useState(row.parLevel === null ? "" : String(row.parLevel));
  const update = useUpdateLocationItem();

  // Only fetched while the popover is open — this table can list a large
  // catalog, and nobody needs price history for a row they haven't clicked.
  const history = useActivity(
    { entity: "LocationItem", entityId: row.id, action: "locationItem.priceChange" },
    open,
  );
  const lastChange = (history.data?.rows ?? []).map((r) => lastPriceChange(r.details)).find((c) => c !== null) ?? null;

  const productType = row.itemVariant.item.category.productType;
  const missing = isMissingPrice(row, productType);

  // An absent price is "—" like every other blank in this table. "₱0.00" reads
  // as a real price of zero, which is a different (and wrong) claim — and on an
  // Asset the retail column is not missing at all, it simply doesn't apply.
  const money = (v: number, applicable = true) =>
    !applicable ? "n/a" : v > 0 ? formatUnitPrice(v) : "—";

  const display = (
    <span className={cn("tnum", missing && "font-medium text-destructive")}>
      {money(row.cost)} / {money(row.retail, productType !== "Asset")}
    </span>
  );

  if (!canEdit) return display;

  const save = async () => {
    // `Number("") || 0` silently stored ₱0.00 for a cleared field — a real price
    // of zero is a different claim from "I haven't set one", and every other
    // quantity form in the app rejects empty rather than inventing a value.
    // parLevel is genuinely optional, which is why it maps to null instead.
    const invalid = ([
      ["cost", cost],
      ["retail price", retail],
    ] as const).find(([, raw]) => raw.trim() === "" || !(Number(raw) >= 0));
    if (invalid) return toast.error(`Enter a ${invalid[0]} — use 0 only if it really is free.`);
    try {
      await update.mutateAsync({
        id: row.id,
        cost: Number(cost),
        retail: Number(retail),
        parLevel: par === "" ? null : Number(par),
      });
      toast.success(`${row.itemVariant.item.name} prices updated`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save prices");
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setCost(String(row.cost));
          setRetail(String(row.retail));
          setPar(row.parLevel === null ? "" : String(row.parLevel));
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Edit cost, retail, and par"
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          {display}
          <Pencil
            aria-hidden="true"
            className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" align="end">
        <div className="space-y-1.5">
          <Label htmlFor={`cost-${row.id}`} className="text-xs">
            Cost
          </Label>
          <QuantityInput
            id={`cost-${row.id}`}
            className="tnum h-8"
            value={cost}
            autoFocus
            onChange={(e) => setCost(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`retail-${row.id}`} className="text-xs">
            Retail
          </Label>
          <QuantityInput
            id={`retail-${row.id}`}
            className="tnum h-8"
            value={retail}
            onChange={(e) => setRetail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`par-${row.id}`} className="text-xs">
            Par level (optional)
          </Label>
          <QuantityInput
            id={`par-${row.id}`}
            className="tnum h-8"
            value={par}
            onChange={(e) => setPar(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </div>
        {lastChange && (
          <p className="text-xs text-muted-foreground">
            Last cost change: {formatMoney(lastChange.oldCost)} to {formatMoney(lastChange.newCost)}
          </p>
        )}
        <Button size="sm" className="w-full" onClick={save} disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
