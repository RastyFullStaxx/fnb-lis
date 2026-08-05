import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Tags } from "lucide-react";
import { toast } from "sonner";
import { categoryUpsert, type CategoryUpsert } from "@fnb/core";
import { useAddIndustryOption, useCategories, useCreateCategory, useIndustryOptions, useProductTypes, useUpdateCategory } from "@/api/master";
import type { Category } from "@/api/types";
import { ApiError } from "@/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuantityInput } from "@/components/quantity-input";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableEmpty, TableFailure, TableLoading, ToolbarSearch, queryFailed } from "@/components/table-surface";

/** Sentinel for the "Other" branch in the Industry select — same convention as AssetDetailsEdit. */
const OTHER = "__other__";

export function CategoriesTab({
  createOpen,
  setCreateOpen,
}: {
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
}) {
  const categories = useCategories();
  const [editing, setEditing] = useState<Category | null>(null);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  // The page toolbar's search only filters the Items tab, so 48 categories had
  // to be found by eye.
  const rows = (categories.data ?? []).filter(
    (c) => !q || c.name.toLowerCase().includes(q) || c.productType.toLowerCase().includes(q),
  );

  return (
    <>
      {(categories.data ?? []).length > 0 && (
        <div className="mb-3">
          <ToolbarSearch value={query} onChange={setQuery} placeholder="Find a category…" label="Search" />
        </div>
      )}
      {queryFailed(categories) ? (
        <TableFailure query={categories} title="Couldn't load categories" />
      ) : categories.isPending ? (
        <TableLoading />
      ) : (categories.data ?? []).length === 0 ? (
        <TableEmpty
          icon={Tags}
          title="No categories yet"
          description="Add a category to group items for reports and count sheets."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> New Category
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead>Category</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead className="text-right">Liquid Weight (default)</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((cat) => (
              <TableRow key={cat.id}>
                <TableCell className="font-medium">{cat.name}</TableCell>
                <TableCell className="text-muted-foreground">{cat.productType}</TableCell>
                <TableCell className="text-muted-foreground">{cat.industry ?? "—"}</TableCell>
                <TableCell className="tnum text-right">
                  {cat.defaultDensityFactor ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="tnum text-right">{cat._count?.items ?? 0}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(cat)}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <CategoryDialog
        open={createOpen || editing !== null}
        category={editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditing(null);
          }
        }}
      />
    </>
  );
}

function CategoryDialog({
  open,
  category,
  onOpenChange,
}: {
  open: boolean;
  category: Category | null;
  onOpenChange: (open: boolean) => void;
}) {
  const productTypes = useProductTypes();
  const industryOptions = useIndustryOptions();
  const addIndustryOption = useAddIndustryOption();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();

  const [industry, setIndustry] = useState("");
  const [industryOther, setIndustryOther] = useState("");

  const form = useForm<CategoryUpsert>({
    resolver: zodResolver(categoryUpsert),
    values: {
      name: category?.name ?? "",
      productType: category?.productType ?? "",
      defaultDensityFactor: category?.defaultDensityFactor ?? null,
      sortOrder: category?.sortOrder ?? 0,
      industry: category?.industry ?? null,
    },
  });

  const productType = form.watch("productType");
  const isAsset = productType === "Asset";

  // Re-seed Industry from the category every time the dialog opens (same
  // convention as AssetDetailsEdit) so reopening never shows stale values.
  useEffect(() => {
    if (!open) return;
    const knownIndustries = industryOptions.data?.industryOptions ?? [];
    if (category?.industry && !knownIndustries.includes(category.industry)) {
      setIndustry(OTHER);
      setIndustryOther(category.industry);
    } else {
      setIndustry(category?.industry ?? "");
      setIndustryOther("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category?.id]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const payload = {
        ...values,
        industry: isAsset ? (industry === OTHER ? industryOther.trim() || null : industry || null) : null,
      };
      if (category) {
        await updateCategory.mutateAsync({ id: category.id, ...payload });
        toast.success(`Category "${values.name}" updated`);
      } else {
        await createCategory.mutateAsync(payload);
        toast.success(`Category "${values.name}" added`);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the category");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{category ? "Edit Category" : "New Category"}</DialogTitle>
          <DialogDescription>
            {isAsset
              ? "Asset categories group equipment for the register — no weighing is involved."
              // Deliberately no fixed example: the number is millilitres per ONE
              // unit of whatever the bottle's empty weight is recorded in, so a
              // hard-coded "Vodka is 30.12 ml per oz" was flatly wrong the moment
              // the demo catalog moved to grams and the field started showing
              // 1.0625. Stating the relationship survives either unit.
              : "Liquid Weight (density factor) turns a scale reading into remaining content: millilitres per unit of whatever the bottle's empty weight is recorded in — per gram if the empty weight is in grams."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cat-name">Name</Label>
            <Input id="cat-name" autoFocus {...form.register("name")} />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="cat-type">Product Type</Label>
            <Select
              value={form.watch("productType")}
              onValueChange={(v) => form.setValue("productType", v, { shouldValidate: true })}
            >
              <SelectTrigger id="cat-type">
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
            {form.formState.errors.productType && (
              <p className="text-sm text-destructive">Choose a product type</p>
            )}
          </div>

          {isAsset && (
            <div className="space-y-2">
              <Label htmlFor="cat-industry">Industry</Label>
              <Select value={industry} onValueChange={setIndustry}>
                <SelectTrigger id="cat-industry">
                  <SelectValue placeholder="Select industry" />
                </SelectTrigger>
                <SelectContent>
                  {(industryOptions.data?.industryOptions ?? []).map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER}>Other…</SelectItem>
                </SelectContent>
              </Select>
              {industry === OTHER && (
                <div className="flex items-center gap-1.5">
                  <Input
                    placeholder="Describe industry"
                    value={industryOther}
                    onChange={(e) => setIndustryOther(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={!industryOther.trim() || addIndustryOption.isPending}
                    onClick={async () => {
                      const value = industryOther.trim();
                      if (!value) return;
                      try {
                        await addIndustryOption.mutateAsync(value);
                        setIndustry(value);
                        toast.success(`"${value}" added to Industry options`);
                      } catch (err) {
                        toast.error(err instanceof ApiError ? err.message : "Could not add industry option");
                      }
                    }}
                  >
                    Add
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                What vertical this category of asset serves — e.g. Dental, Warehouse, Bar &amp; Restaurant. Shared by every asset in this category.
              </p>
            </div>
          )}
          {/* Density converts a scale reading into remaining liquid. An Asset
              category has nothing to weigh, so the field and its explainer were
              pure noise on the Audio System / Furniture dialogs. */}
          {!isAsset && (
          <div className="space-y-2">
            <Label htmlFor="cat-density">Liquid Weight — default density factor (optional)</Label>
            <QuantityInput
              id="cat-density"
              className="tnum"
              placeholder="ml per weight unit"
              {...form.register("defaultDensityFactor", {
                setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
              })}
            />
            <p className="text-xs text-muted-foreground">
              Applied to items in this category that don't set their own Liquid Weight value.
              Spirits sit near 1.06 ml per gram; syrups are lower because they are denser.
            </p>
          </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={createCategory.isPending || updateCategory.isPending}>
              {category ? "Save Changes" : "Add Category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
