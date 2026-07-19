import { useState } from "react";
import { toast } from "sonner";
import { useUpdateLocationItem } from "@/api/location";
import type { LocationItem } from "@/api/types";
import { ApiError } from "@/api/http";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { QuantityInput } from "@/components/quantity-input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Click-to-edit prices; changes are logged with old/new values in the activity trail. */
export function PriceEdit({ row, canEdit }: { row: LocationItem; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [cost, setCost] = useState(String(row.cost));
  const [retail, setRetail] = useState(String(row.retail));
  const [par, setPar] = useState(row.parLevel === null ? "" : String(row.parLevel));
  const update = useUpdateLocationItem();

  const missing = row.cost === 0 || row.retail === 0;

  const display = (
    <span className={missing ? "font-medium text-destructive" : "tnum"}>
      {formatMoney(row.cost)} / {formatMoney(row.retail)}
    </span>
  );

  if (!canEdit) return display;

  const save = async () => {
    try {
      await update.mutateAsync({
        id: row.id,
        cost: Number(cost) || 0,
        retail: Number(retail) || 0,
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
          className="rounded px-1 py-0.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          {display}
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
        <Button size="sm" className="w-full" onClick={save} disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
