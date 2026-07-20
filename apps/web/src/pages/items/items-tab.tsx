import { useState } from "react";
import { Package, Plus } from "lucide-react";
import { useItems } from "@/api/master";
import { variantLabel } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableLoading, TableEmpty } from "@/components/table-surface";
import { ItemFormSheet, ItemEditSheet } from "./item-form";

const ALL = "__all__";

export function ItemsTab({
  search,
  productType,
  formOpen,
  setFormOpen,
}: {
  search: string;
  productType: string;
  formOpen: boolean;
  setFormOpen: (open: boolean) => void;
}) {
  const items = useItems({ search: search || undefined, productType: productType === ALL ? undefined : productType });
  const [editingId, setEditingId] = useState<string | null>(null);
  // Derive from the live query so the sheet re-renders from fresh data after
  // a save (never a stale snapshot captured at click time).
  const editing = items.data?.find((i) => i.id === editingId) ?? null;
  const filtered = Boolean(search) || productType !== ALL;

  return (
    <>
      {items.isPending ? (
        <TableLoading rows={6} />
      ) : (items.data ?? []).length === 0 ? (
        <TableEmpty
          icon={Package}
          title={filtered ? "Nothing matches the current filter" : "No items yet"}
          description={
            filtered
              ? "Clear the search or type filter to see everything."
              : "Add your first item — it becomes available to every client location."
          }
          action={
            !filtered && (
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="size-4" /> New item
              </Button>
            )
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead>Item</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Sizes</TableHead>
              <TableHead className="text-right">Weighing</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.data!.map((item) => {
              const weighable = item.variants.some((v) => v.contentTracked);
              return (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-muted-foreground">{item.category.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{item.category.productType}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {item.variants.map((v) => (
                        <Badge key={v.id} variant="secondary" className="tnum font-normal">
                          {variantLabel(v)}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {weighable ? "Scale-ready" : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(item.id)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <ItemFormSheet open={formOpen} onOpenChange={setFormOpen} />
      <ItemEditSheet item={editing} onOpenChange={(open) => !open && setEditingId(null)} />
    </>
  );
}
