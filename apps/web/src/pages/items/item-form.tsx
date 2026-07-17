import { useEffect } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Scale, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { itemCreate, type ItemCreate } from "@fnb/core";
import { useCategories, useCreateItem, useUnits } from "@/api/master";
import { defaultWeighUnit, useUnitSystem } from "@/lib/preferences";
import { ApiError } from "@/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      toast.success(`Item "${created.name}" added to the master catalog`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the item");
    }
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>New item</SheetTitle>
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
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={(v) => form.setValue("categoryId", v, { shouldValidate: true })}>
              <SelectTrigger>
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
                <Label>Sizes / variants</Label>
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
                <Plus className="size-4" /> Add size
              </Button>
            </div>

            {variants.fields.map((field, i) => {
              const contentTracked = form.watch(`variants.${i}.contentTracked`);
              return (
                <div key={field.id} className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-end gap-2">
                    <div className="w-28 space-y-1.5">
                      <Label className="text-xs">Size</Label>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        className="tnum"
                        {...form.register(`variants.${i}.size`, { valueAsNumber: true })}
                      />
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-xs">Unit</Label>
                      <Select
                        value={form.watch(`variants.${i}.unitId`)}
                        onValueChange={(v) => form.setValue(`variants.${i}.unitId`, v, { shouldValidate: true })}
                      >
                        <SelectTrigger>
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

                  <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">Track open content</p>
                      <p className="text-xs text-muted-foreground">
                        On: partial amounts count as a fraction of this size (open bottles). Off: counted whole.
                      </p>
                    </div>
                    <Switch
                      checked={contentTracked}
                      onCheckedChange={(v) => form.setValue(`variants.${i}.contentTracked`, v)}
                    />
                  </div>

                  {contentTracked && (
                    <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Tare weight</Label>
                        <Input
                          type="number"
                          step="any"
                          min="0"
                          className="tnum"
                          placeholder="empty container"
                          {...form.register(`variants.${i}.tareWeight`, {
                            setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
                          })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Tare unit</Label>
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
                        <Input
                          type="number"
                          step="any"
                          min="0"
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
                        <p className="text-[11px] leading-tight text-muted-foreground">
                          Density factor: ml of liquid per gram/oz of weight — converts a scale reading
                          into remaining volume.
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
