import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Scale, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { can, itemCreate, itemUpdate, type ItemCreate, type ItemUpdate, type Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useCategories, useCreateItem, useProductTypes, useUnits, useUpdateItem } from "@/api/master";
import { variantLabel, type Item, type ItemVariant } from "@/api/types";
import { defaultWeighUnit, useUnitSystem } from "@/lib/preferences";
import { ApiError } from "@/api/http";
import { VariantQuickEditDialog } from "@/components/variant-quick-edit";
import { BrandModelEditDialog } from "@/components/brand-model-edit";
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
  brand: null,
  model: null,
} as const;

export function ItemFormSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const categories = useCategories();
  const productTypes = useProductTypes();
  const units = useUnits();
  // The tare / liquid-weight library is LIS's own data — a client manager runs
  // his catalog but never edits the weights (client decision 2026-07-25). The
  // server rejects it too; this just stops offering a field that would 403.
  const me = useMe();
  const canEditWeights = can((me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role, "weights.manage");
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

  // Category list is long, so Type narrows it first — Category stays empty
  // and disabled until a Type is picked, then only shows categories of that type.
  const [selectedType, setSelectedType] = useState<string>("");

  useEffect(() => {
    if (open) {
      form.reset({ name: "", categoryId: "", description: null, variants: [emptyVariant()] });
      setSelectedType("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form]);

  const categoryId = form.watch("categoryId");
  const category = categories.data?.find((c) => c.id === categoryId);
  const categoriesForType = (categories.data ?? []).filter((c) => c.productType === selectedType);

  // The server answers 409 SIMILAR_ITEM when a new name looks like a typo of an
  // existing one. Hold the message here and let the user decide — banning the
  // save outright would block legitimate siblings ("Absolut Citron").
  const [similarWarning, setSimilarWarning] = useState<string | null>(null);

  const submit = async (values: ItemCreate, confirmSimilar = false) => {
    try {
      const created = await createItem.mutateAsync({ ...values, ...(confirmSimilar ? { confirmSimilar: true } : {}) });
      toast.success(`Item "${created.name}" added — every client location can now price it`);
      setSimilarWarning(null);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "SIMILAR_ITEM") {
        setSimilarWarning(err.message);
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "Could not save the item");
    }
  };

  const onSubmit = form.handleSubmit((values) => submit(values));

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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="item-type">Type</Label>
              <Select
                value={selectedType}
                onValueChange={(v) => {
                  setSelectedType(v);
                  // Changing Type invalidates whatever Category was picked under the old Type.
                  form.setValue("categoryId", "", { shouldValidate: true });
                }}
              >
                <SelectTrigger id="item-type">
                  <SelectValue placeholder="Choose a type" />
                </SelectTrigger>
                <SelectContent>
                  {(productTypes.data?.productTypes ?? []).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="item-category">Category</Label>
              <Select
                value={categoryId}
                onValueChange={(v) => form.setValue("categoryId", v, { shouldValidate: true })}
                disabled={!selectedType}
              >
                <SelectTrigger id="item-category">
                  <SelectValue placeholder={selectedType ? "Choose a category" : "Choose a type first"} />
                </SelectTrigger>
                <SelectContent>
                  {categoriesForType.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              const isAsset = category?.productType === "Asset";
              const vErr = form.formState.errors.variants?.[i];
              return (
                <div key={field.id} className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-start gap-2">
                    <div className="grid flex-1 grid-cols-2 items-start gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Size</Label>
                        <QuantityInput
                          className="tnum"
                          {...(vErr?.size ? { "aria-invalid": true } : {})}
                          {...form.register(`variants.${i}.size`, { valueAsNumber: true })}
                        />
                      </div>
                      <div className="space-y-1.5">
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
                    </div>
                    {variants.fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-6"
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

                  {isAsset && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Brand</Label>
                        <Input
                          placeholder="e.g. Samsung"
                          {...form.register(`variants.${i}.brand`, {
                            setValueAs: (v) => (v === "" ? null : v),
                          })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Model</Label>
                        <Input
                          placeholder="e.g. RT38"
                          {...form.register(`variants.${i}.model`, {
                            setValueAs: (v) => (v === "" ? null : v),
                          })}
                        />
                      </div>
                    </div>
                  )}

                  {!isAsset && (
                    <>
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

                      {netMode && canEditWeights && (
                        <div className="grid grid-cols-2 items-start gap-2">
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

                      {(contentTracked || netMode) && !canEditWeights && (
                        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                          Empty weight and Liquid Weight are maintained by your LIS
                          administrator. Save this item and it will appear under
                          Needs Attention for them to complete.
                        </p>
                      )}

                      {contentTracked && canEditWeights && (
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 items-start gap-2">
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
                          </div>
                          <div className="grid grid-cols-2 items-start gap-2">
                            <div className="space-y-1.5">
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
                            </div>
                            <p className="self-center text-xs text-muted-foreground">
                              Liquid Weight: ml of liquid per gram/oz of weight — converts a scale weight into remaining volume.
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {form.formState.errors.variants?.root && (
              <p className="text-sm text-destructive">{form.formState.errors.variants.root.message}</p>
            )}
          </div>

          {similarWarning && (
            // A typo splits one product's history across two master items and
            // nothing downstream ever reconciles them — worth one deliberate
            // confirmation before it happens.
            <div className="space-y-2 rounded-md bg-warning/10 p-3">
              <p className="text-sm text-foreground">{similarWarning}</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={createItem.isPending}
                  onClick={() => void submit(form.getValues(), true)}
                >
                  Yes, it's a different item — create it
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSimilarWarning(null)}>
                  Let me fix the name
                </Button>
              </div>
            </div>
          )}

          <SheetFooter className="px-0">
            <Button type="submit" disabled={createItem.isPending}>
              {createItem.isPending ? "Saving…" : "Save Item"}
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
  const productTypes = useProductTypes();
  const updateItem = useUpdateItem();
  // Track only the id and derive the variant from the live item, so the dialog
  // always shows fresh values after a save instead of a stale snapshot.
  const [quickEditId, setQuickEditId] = useState<string | null>(null);
  const quickEdit = item?.variants.find((v) => v.id === quickEditId) ?? null;
  // Same pattern, second dialog: Brand/Model edit target (Asset rows only).
  const [brandEditId, setBrandEditId] = useState<string | null>(null);
  const brandEdit = item?.variants.find((v) => v.id === brandEditId) ?? null;

  const form = useForm<ItemUpdate>({
    resolver: zodResolver(itemUpdate),
    values: {
      name: item?.name ?? "",
      categoryId: item?.categoryId ?? "",
      description: item?.description ?? null,
    },
  });
  const categoryId = form.watch("categoryId");

  // Type starts pre-filled from the item's existing category (so the field
  // isn't blank on open) but the user can still switch it to move categories.
  const [selectedType, setSelectedType] = useState<string>("");
  const [typeTouched, setTypeTouched] = useState(false);
  useEffect(() => {
    if (item && !typeTouched) setSelectedType(item.category.productType);
  }, [item, typeTouched]);
  useEffect(() => {
    if (!item) {
      setSelectedType("");
      setTypeTouched(false);
    }
  }, [item]);
  const categoriesForType = (categories.data ?? []).filter((c) => c.productType === selectedType);

  const onSubmit = form.handleSubmit(async (values) => {
    if (!item) return;
    try {
      await updateItem.mutateAsync({ id: item.id, ...values });
      toast.success(`Item "${values.name ?? item.name}" updated`);
      setQuickEditId(null);
      setBrandEditId(null);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the item");
    }
  });

  return (
    <Sheet
      open={item !== null}
      onOpenChange={(o) => {
        if (!o) {
          setQuickEditId(null);
          setBrandEditId(null);
        }
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="item-edit-type">Type</Label>
              <Select
                value={selectedType}
                onValueChange={(v) => {
                  setTypeTouched(true);
                  setSelectedType(v);
                  // Switching Type off the item's original one clears Category,
                  // since the old category no longer belongs to this Type's list.
                  if (v !== item?.category.productType) {
                    form.setValue("categoryId", "", { shouldValidate: true, shouldDirty: true });
                  }
                }}
              >
                <SelectTrigger id="item-edit-type">
                  <SelectValue placeholder="Choose a type" />
                </SelectTrigger>
                <SelectContent>
                  {(productTypes.data?.productTypes ?? []).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="item-edit-category">Category</Label>
              <Select
                value={categoryId}
                onValueChange={(v) => form.setValue("categoryId", v, { shouldValidate: true, shouldDirty: true })}
                disabled={!selectedType}
              >
                <SelectTrigger id="item-edit-category">
                  <SelectValue placeholder={selectedType ? "Choose a category" : "Choose a type first"} />
                </SelectTrigger>
                <SelectContent>
                  {categoriesForType.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
                {item?.category.productType === "Asset"
                  ? "Sizes are fixed once created; Brand/Model can be corrected per size."
                  : "Sizes are fixed once created; bottle weight and Liquid Weight can be corrected per size."}
              </p>
            </div>
            {(item?.variants ?? []).map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-4 border-t pt-3">
                <div className="min-w-0">
                  <p className="tnum text-sm font-medium">{variantLabel(v)}</p>
                  <p className="text-xs text-muted-foreground">
                    {item?.category.productType === "Asset"
                      ? [v.brand, v.model].filter(Boolean).join(" · ") || "No brand/model set"
                      : weighSummary(v)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {(v.contentTracked || v.weighMode === "NET") && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setQuickEditId(v.id)}>
                      <Scale className="size-4" /> Bottle Weight
                    </Button>
                  )}
                  {item?.category.productType === "Asset" && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setBrandEditId(v.id)}>
                      <Tag className="size-4" /> Brand/Model
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <SheetFooter className="px-0">
            <Button type="submit" disabled={updateItem.isPending}>
              {updateItem.isPending ? "Saving…" : "Save Changes"}
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
        {item && brandEdit && (
          <BrandModelEditDialog
            open
            onOpenChange={(o) => !o && setBrandEditId(null)}
            itemName={item.name}
            variant={brandEdit}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
