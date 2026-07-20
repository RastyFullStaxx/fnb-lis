import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { recipeCost } from "@fnb/core";
import { useMenu, useMenuMutations, type MenuSummary } from "@/api/menus";
import { variantLabel, type LocationItem } from "@/api/types";
import { ApiError } from "@/api/http";
import { cn, formatMoney } from "@/lib/utils";
import { ItemCombobox } from "@/components/item-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuantityInput } from "@/components/quantity-input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface BuilderLine {
  item: LocationItem;
  servingQty: string;
}

/** Builds a recipe and publishes it as a NEW version (v1 for new menus). */
export function RecipeBuilderSheet({
  open,
  menu,
  onOpenChange,
}: {
  open: boolean;
  menu: MenuSummary | null; // null = creating a brand-new menu
  onOpenChange: (open: boolean) => void;
}) {
  const mutations = useMenuMutations();
  const detail = useMenu(menu?.id ?? null);
  const [name, setName] = useState("");
  const [srp, setSrp] = useState("");
  const [lines, setLines] = useState<BuilderLine[]>([]);
  const [picking, setPicking] = useState<LocationItem | null>(null);

  // Prefill from the current version when creating a new version of an existing
  // menu — exactly once per open, so a detail response landing after the sheet
  // opened can never wipe SRP/lines the user has already started editing.
  const seeded = useRef(false);
  const awaitedDetail = useRef(false);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      awaitedDetail.current = false;
      return;
    }
    if (seeded.current) return;
    setName(menu?.name ?? "");
    if (menu && detail.isPending) {
      // Clear leftovers from a previous open; seeding happens when the version lands.
      awaitedDetail.current = true;
      setSrp("");
      setLines([]);
      return;
    }
    seeded.current = true;
    const current = menu ? detail.data?.versions[0] : undefined;
    if (current) {
      // If the detail arrived after the sheet opened, don't clobber anything
      // the user typed while it loaded; a cached detail seeds unconditionally.
      if (!awaitedDetail.current || (srp === "" && lines.length === 0)) {
        setSrp(String(current.srp));
        setLines(
          current.lines.map((l) => ({ item: l.locationItem, servingQty: String(l.servingQty) })),
        );
      }
    } else {
      setSrp("");
      setLines([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, menu, detail.data, detail.isPending]);

  const cost = useMemo(
    () =>
      recipeCost(
        lines
          .filter((l) => Number(l.servingQty) > 0)
          .map((l) => ({
            servingQty: Number(l.servingQty),
            size: l.item.itemVariant.size,
            contentTracked: l.item.itemVariant.contentTracked,
            ingredientCost: l.item.cost,
          })),
      ),
    [lines],
  );
  const srpNum = Number(srp) || 0;
  const margin = srpNum > 0 ? ((srpNum - cost) / srpNum) * 100 : null;

  const addLine = (item: LocationItem) => {
    if (lines.some((l) => l.item.id === item.id)) return toast.error("That ingredient is already in the recipe");
    setLines((prev) => [...prev, { item, servingQty: "" }]);
    setPicking(null);
  };

  const publish = async () => {
    const cleanLines = lines
      .filter((l) => Number(l.servingQty) > 0)
      .map((l, i) => ({ locationItemId: l.item.id, servingQty: Number(l.servingQty), sortOrder: i }));
    if (cleanLines.length === 0) return toast.error("Add at least one ingredient with a serving amount");
    try {
      let menuId = menu?.id;
      if (!menuId) {
        if (!name.trim()) return toast.error("Give the menu a name");
        const created = await mutations.create.mutateAsync({ name: name.trim() });
        menuId = created.id;
      }
      const version = await mutations.publish.mutateAsync({ menuId: menuId!, srp: srpNum, lines: cleanLines });
      toast.success(`Published v${version.versionNo} — future sales use it; past sales keep their version`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not publish the recipe");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{menu ? `${menu.name} — new version` : "New Menu"}</SheetTitle>
          <SheetDescription>
            {menu
              ? `Publishing creates v${(menu.current?.versionNo ?? 0) + 1}. Sales already recorded keep v${menu.current?.versionNo ?? 1}.`
              : "Name the menu, add its ingredients, and publish the first recipe version."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-4">
          {!menu && (
            <div className="space-y-2">
              <Label htmlFor="menu-name">Menu Name</Label>
              <Input id="menu-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}

          <div className="space-y-3">
            <Label>Ingredients</Label>
            {lines.map((line, i) => {
              const variant = line.item.itemVariant;
              return (
                <div key={line.item.id} className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {variant.item.name}
                      <span className="ml-1.5 font-normal text-muted-foreground">{variantLabel(variant)}</span>
                    </p>
                  </div>
                  <div className="w-32 space-y-1">
                    <Label className="text-xs" htmlFor={`serv-${i}`}>
                      Serving{variant.contentTracked ? ` (${variant.unit.name})` : " (units)"}
                    </Label>
                    <QuantityInput
                      id={`serv-${i}`}
                      className="tnum"
                      value={line.servingQty}
                      onChange={(e) =>
                        setLines((prev) => prev.map((l, j) => (j === i ? { ...l, servingQty: e.target.value } : l)))
                      }
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove ingredient"
                    onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}

            <ItemCombobox value={picking} onSelect={addLine} placeholder="Add an ingredient…" />
          </div>

          <Separator />

          <div className="grid grid-cols-3 items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="menu-srp">SRP</Label>
              <QuantityInput
                id="menu-srp"
                className="tnum"
                value={srp}
                onChange={(e) => setSrp(e.target.value)}
              />
            </div>
            <div aria-live="polite">
              <p className="text-xs text-muted-foreground">Estimated Cost</p>
              <p className="tnum text-lg font-semibold">
                <span
                  key={cost}
                  className="inline-block duration-150 animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none"
                >
                  {formatMoney(cost)}
                </span>
              </p>
            </div>
            <div aria-live="polite">
              <p className="text-xs text-muted-foreground">Margin</p>
              <p
                className={cn(
                  "tnum text-lg font-semibold",
                  margin !== null && margin < 0 && "text-destructive",
                )}
              >
                <span
                  key={margin === null ? "none" : margin.toFixed(0)}
                  className="inline-block duration-150 animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none"
                >
                  {margin === null ? "—" : `${margin.toFixed(0)}%`}
                </span>
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Cost uses each ingredient's current catalog cost; it freezes into the version at publish.
          </p>
        </div>

        <SheetFooter>
          <Button onClick={publish} disabled={mutations.publish.isPending || mutations.create.isPending}>
            {mutations.publish.isPending ? "Publishing…" : menu ? "Publish new version" : "Create & publish v1"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
