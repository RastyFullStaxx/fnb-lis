import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Tags } from "lucide-react";
import { toast } from "sonner";
import { categoryUpsert, type CategoryUpsert } from "@fnb/core";
import { useCategories, useCreateCategory, useProductTypes, useUpdateCategory } from "@/api/master";
import type { Category } from "@/api/types";
import { ApiError } from "@/api/http";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableLoading, TableEmpty } from "@/components/table-surface";

export function CategoriesTab({
  createOpen,
  setCreateOpen,
}: {
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
}) {
  const categories = useCategories();
  const [editing, setEditing] = useState<Category | null>(null);

  return (
    <>
      {categories.isPending ? (
        <TableLoading />
      ) : (categories.data ?? []).length === 0 ? (
        <TableEmpty icon={Tags} title="No categories yet" description="Add a category to group items for reports and count sheets." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead>Category</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Liquid Weight (default)</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.data!.map((cat) => (
              <TableRow key={cat.id}>
                <TableCell className="font-medium">{cat.name}</TableCell>
                <TableCell className="text-muted-foreground">{cat.productType}</TableCell>
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
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();

  const form = useForm<CategoryUpsert>({
    resolver: zodResolver(categoryUpsert),
    values: {
      name: category?.name ?? "",
      productType: category?.productType ?? "",
      defaultDensityFactor: category?.defaultDensityFactor ?? null,
      sortOrder: category?.sortOrder ?? 0,
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (category) {
        await updateCategory.mutateAsync({ id: category.id, ...values });
        toast.success(`Category "${values.name}" updated`);
      } else {
        await createCategory.mutateAsync(values);
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
          <DialogTitle>{category ? "Edit category" : "New category"}</DialogTitle>
          <DialogDescription>
            The Liquid Weight formula (density factor) converts scale weight into remaining content —
            e.g. Vodka is 30.12 ml per oz.
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
            <Label>Product type</Label>
            <Select
              value={form.watch("productType")}
              onValueChange={(v) => form.setValue("productType", v, { shouldValidate: true })}
            >
              <SelectTrigger>
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
          <div className="space-y-2">
            <Label htmlFor="cat-density">Liquid Weight — default density factor (optional)</Label>
            <Input
              id="cat-density"
              type="number"
              step="any"
              min="0"
              className="tnum"
              placeholder="ml per weight unit"
              {...form.register("defaultDensityFactor", {
                setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
              })}
            />
            <p className="text-xs text-muted-foreground">
              Applied to items in this category that don't set their own Liquid Weight value.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createCategory.isPending || updateCategory.isPending}>
              {category ? "Save changes" : "Add category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
