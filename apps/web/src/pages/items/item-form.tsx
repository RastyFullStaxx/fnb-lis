import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Scale, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { itemCreate, itemUpdate, type ItemCreate, type ItemUpdate } from "@fnb/core";
import { useCategories, useCreateItem, useUnits, useUpdateItem } from "@/api/master";
import { variantLabel, type Item, type ItemVariant } from "@/api/types";
import { defaultWeighUnit, useUnitSystem } from "@/lib/preferences";
import { ApiError } from "@/api/http";
import { VariantQuickEditDialog } from "@/components/variant-quick-edit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuantityInput } from "@/components/quantity-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";

const EMPTY_VARIANT = {
  size: 0,
  unitId: "",
  contentTracked: false,
  weighMode: null,
  tareWeight: null,
  tareWeightUnit: null,
  densityFactor: null,
  barcode: null,
} as const;

export function ItemFormSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const categories = useCategories();
  const units = useUnits();
  const createItem = useCreateItem();
  const unitSystem = useUnitSystem();
  // New variants default their tare-weight unit to the signed-in user's
  // preferred unit system (Settings → Display); it's just a starting point —
  // whoever tares the container can still pick g or oz explicitly.
  const emptyVariant = () => ({ ...EMPTY_VARIANT, tareWeightUnit: defaultWeighUnit(unitSystem) });

  const form = useForm<ItemCreate>({
    resolver: zodResolver(itemCreate),
    defaultValues: { name: "", categoryId: "", description: null, variants: [emptyVariant()] },
  });
  const variants = useFieldArray({ control: form.control, name: "variants" });

  useEffect(() => {
    if (open) form.reset({ name: "", categoryId: "", description: null, variants: [emptyVariant()] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form]);

  const categoryId = form.watch("categoryId");
  const category = categories.data?.find((c) => c.id === categoryId);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createItem.mutateAsync(values);
      toast.success(`Item "${created.name}" added — every client location can now price it`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the item");
    }
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>New Item</SheetTitle>
          <SheetDescription>
            Define the item once here; each client location prices it in its own catalog.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={onSubmit} className="space-y-5 px-4 pb-4">
          <div className="space-y-2">
            <Label htmlFor="item-name">Name</Label>
            <Input id="item-name" autoFocus {...form.register("name")} />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="item-category">Category</Label>
            <Select value={categoryId} onValueChange={(v) => form.setValue("categoryId", v, { shouldValidate: true })}>
              <SelectTrigger id="item-category">
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {(categories.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {c.productType}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.categoryId && (
              <p className="text-sm text-destructive">Choose a category</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="item-desc">Description (optional)</Label>
            <Input id="item-desc" {...form.register("description")} />
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>Sizes / Variants</Label>
                <p className="text-xs text-muted-foreground">
                  Each purchasable size — e.g. a 700 ml bottle and a 1 L bottle are two variants.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => variants.append(emptyVariant())}
              >
                <Plus className="size-4" /> Add Size
              </Button>
            </div>

            {variants.fields.map((field, i) => {
              const contentTracked = form.watch(`variants.${i}.contentTracked`);
              const weighMode = form.watch(`variants.${i}.weighMode`);
              const unitId = form.watch(`variants.${i}.unitId`);
              const unitIsMass = units.data?.find((u) => u.id === unitId)?.kind === "MASS";
              const netMode = !contentTracked && weighMode === "NET";
              const vErr = form.formState.errors.variants?.[i];
              return (
                <div key={field.id} className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-end gap-2">
                    <div className="w-28 space-y-1.5">
                      <Label className="text-xs">Size</Label>
                      <QuantityInput
                        className="tnum"
                        {...(vErr?.size ? { "aria-invalid": true } : {})}
                        {...form.register(`variants.${i}.size`, { valueAsNumber: true })}
                      />
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-xs">Unit</Label>
                      <Select
                        value={form.watch(`variants.${i}.unitId`)}
                        onValueChange={(v) => form.setValue(`variants.${i}.unitId`, v, { shouldValidate: true })}
                      >
                        <SelectTrigger aria-invalid={vErr?.unitId ? true : undefined}>
                          <SelectValue placeholder="Unit" />
                        </SelectTrigger>
                        <SelectContent>
                          {(units.data ?? []).map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name} · {u.kind.toLowerCase()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {variants.fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove size"
                        onClick={() => variants.remove(i)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                  {(vErr?.size || vErr?.unitId) && (
                    <p className="text-sm text-destructive">
                      {[vErr?.size && "Size must be greater than zero.", vErr?.unitId && "Pick a unit."]
                        .filter(Boolean)
                        .join(" ")}
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-4 border-t pt-3">
                    <div>
                      <p className="text-sm font-medium">Track Open Content</p>
                      <p className="text-xs text-muted-foreground">
                        On: partial amounts count as a fraction of this size (open bottles). Off: counted whole.
                      </p>
                    </div>
                    <Switch
                      checked={contentTracked}
                      onCheckedChange={(v) => {
                        form.setValue(`variants.${i}.contentTracked`, v);
                        if (v) form.setValue(`variants.${i}.weighMode`, null);
                      }}
                    />
                  </div>

                  {!contentTracked && unitIsMass && (
                    <div className="flex items-center justify-between gap-4 border-t pt-3">
                      <div>
                        <p className="text-sm font-medium">Weigh by Net Weight</p>
                        <p className="text-xs text-muted-foreground">
                          Kitchen counting: scale weight − empty weight = quantity in {units.data?.find((u) => u.id === unitId)?.name ?? "the unit"}. No density conversion.
                        </p>
                      </div>
                      <Switch
                        checked={netMode}
                        onCheckedChange={(v) => form.setValue(`variants.${i}.weighMode`, v ? "NET" : null)}
                      />
                    </div>
                  )}

                  {netMode && (
                    <div className="grid grid-cols-2 items-end gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Empty Weight</Label>
                        <QuantityInput
                          className="tnum"
                          placeholder="empty container (0 = none)"
                          {...form.register(`variants.${i}.tareWeight`, {
                            setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
                          })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Weight Unit</Label>
                        <Select
                          value={form.watch(`variants.${i}.tareWeightUnit`) ?? ""}
                          onValueChange={(v) =>
                            form.setValue(`variants.${i}.tareWeightUnit`, (v || null) as "g" | "oz" | null)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="g / oz" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="g">g</SelectItem>
                            <SelectItem value="oz">oz</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  {contentTracked && (
                    <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Empty Weight</Label>
                        <QuantityInput
                          className="tnum"
                          placeholder="empty container"
                          {...form.register(`variants.${i}.tareWeight`, {
                            setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
                          })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Weight Unit</Label>
                        <Select
                          value={form.watch(`variants.${i}.tareWeightUnit`) ?? ""}
                          onValueChange={(v) =>
                            form.setValue(`variants.${i}.tareWeightUnit`, (v || null) as "g" | "oz" | null)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="g / oz" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="g">g</SelectItem>
                            <SelectItem value="oz">oz</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2 space-y-1.5 sm:col-span-1">
                        <Label className="flex items-center gap-1 text-xs">
                          <Scale className="size-3" /> Liquid Weight
                        </Label>
                        <QuantityInput
                          className="tnum"
                          placeholder={
                            category?.defaultDensityFactor
                              ? `${category.defaultDensityFactor} (from ${category.name})`
                              : "ml per weight unit"
                          }
                          {...form.register(`variants.${i}.densityFactor`, {
                            setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
                          })}
                        />
                        <p className="text-xs text-muted-foreground">
                          Liquid Weight: ml of liquid per gram/oz of weight — converts a scale weight into remaining volume.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {form.formState.errors.variants?.root && (
              <p className="text-sm text-destructive">{form.formState.errors.variants.root.message}</p>
            )}
          </div>

          <SheetFooter className="px-0">
            <Button type="submit" disabled={createItem.isPending}>
              {createItem.isPending ? "Saving…" : "Save item"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** Weighing summary line for a variant row in the edit sheet. */
function weighSummary(v: ItemVariant): string {
  if (v.contentTracked) {
    return v.tareWeight != null
      ? `Open content · empty ${v.tareWeight} ${v.tareWeightUnit ?? "g"}`
      : "Open content · no bottle weight yet";
  }
  if (v.weighMode === "NET") return "Weighed by net weight";
  return "Counted whole";
}

/**
 * Edit an existing master item: name, category, and description via
 * `useUpdateItem`; per-variant bottle weight / Liquid Weight through the same
 * VariantQuickEditDialog the count screen uses. Sizes themselves stay fixed —
 * committed counts and purchases reference them.
 */
export function ItemEditSheet({
  item,
  onOpenChange,
}: {
  item: Item | null;
  onOpenChange: (open: boolean) => void;
}) {
  const categories = useCategories();
  const updateItem = useUpdateItem();
  // Track only the id and derive the variant from the live item, so the dialog
  // always shows fresh values after a save instead of a stale snapshot.
  const [quickEditId, setQuickEditId] = useState<string | null>(null);
  const quickEdit = item?.variants.find((v) => v.id === quickEditId) ?? null;

  const form = useForm<ItemUpdate>({
    resolver: zodResolver(itemUpdate),
    values: {
      name: item?.name ?? "",
      categoryId: item?.categoryId ?? "",
      description: item?.description ?? null,
    },
  });
  const categoryId = form.watch("categoryId");

  const onSubmit = form.handleSubmit(async (values) => {
    if (!item) return;
    try {
      await updateItem.mutateAsync({ id: item.id, ...values });
      toast.success(`Item "${values.name ?? item.name}" updated`);
      setQuickEditId(null);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the item");
    }
  });

  return (
    <Sheet
      open={item !== null}
      onOpenChange={(o) => {
        if (!o) setQuickEditId(null);
        onOpenChange(o);
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Edit Item</SheetTitle>
          <SheetDescription>
            Changes apply everywhere this item appears — every location's catalog and future counts.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={onSubmit} className="space-y-5 px-4 pb-4">
          <div className="space-y-2">
            <Label htmlFor="item-edit-name">Name</Label>
            <Input id="item-edit-name" autoFocus {...form.register("name")} />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="item-edit-category">Category</Label>
            <Select
              value={categoryId}
              onValueChange={(v) => form.setValue("categoryId", v, { shouldValidate: true, shouldDirty: true })}
            >
              <SelectTrigger id="item-edit-category">
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {(categories.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {c.productType}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="item-edit-desc">Description (optional)</Label>
            <Input id="item-edit-desc" {...form.register("description")} />
          </div>

          <Separator />

          <div className="space-y-3">
            <div>
              <Label>Sizes / Variants</Label>
              <p className="text-xs text-muted-foreground">
                Sizes are fixed once created; bottle weight and Liquid Weight can be corrected per size.
              </p>
            </div>
            {(item?.variants ?? []).map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-4 border-t pt-3">
                <div className="min-w-0">
                  <p className="tnum text-sm font-medium">{variantLabel(v)}</p>
                  <p className="text-xs text-muted-foreground">{weighSummary(v)}</p>
                </div>
                {(v.contentTracked || v.weighMode === "NET") && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setQuickEditId(v.id)}>
                    <Scale className="size-4" /> Bottle Weight
                  </Button>
                )}
              </div>
            ))}
          </div>

          <SheetFooter className="px-0">
            <Button type="submit" disabled={updateItem.isPending}>
              {updateItem.isPending ? "Saving…" : "Save changes"}
            </Button>
          </SheetFooter>
        </form>

        {item && quickEdit && (
          <VariantQuickEditDialog
            open
            onOpenChange={(o) => !o && setQuickEditId(null)}
            itemName={item.name}
            variant={quickEdit}
            categoryDefaultDensity={item.category.defaultDensityFactor}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
