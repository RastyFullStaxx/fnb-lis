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
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { ItemFormSheet } from "./item-form";

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

  return (
    <div className="space-y-4">
      {items.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : (items.data ?? []).length === 0 ? (
        <EmptyState
          icon={Package}
          title={search ? "No items match your search" : "The master catalog is empty"}
          description={search ? "Try a different name." : "Add your first item — it becomes available to every client location."}
          action={
            !search && (
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="size-4" /> New item
              </Button>
            )
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Sizes</TableHead>
                <TableHead className="text-right">Weighing</TableHead>
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
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ItemFormSheet open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
