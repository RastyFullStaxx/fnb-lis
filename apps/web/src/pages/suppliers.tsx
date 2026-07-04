import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Truck } from "lucide-react";
import { toast } from "sonner";
import { supplierUpsert, type SupplierUpsert } from "@fnb/core";
import { useCreateSupplier, useSuppliers, useUpdateSupplier } from "@/api/location";
import type { Supplier } from "@/api/types";
import { ApiError } from "@/api/http";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

export function SuppliersPage() {
  const suppliers = useSuppliers();
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Shared across this client's locations — attach them to purchases for supplier reports."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New supplier
          </Button>
        }
      />

      {suppliers.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (suppliers.data ?? []).length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No suppliers yet"
          description="Add the vendors this client buys from."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New supplier
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Supplier</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Status</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.data!.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">
                    {s.contactInfo || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={s.isActive ? "secondary" : "outline"}>
                      {s.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <SupplierDialog
        open={creating || editing !== null}
        supplier={editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
      />
    </div>
  );
}

function SupplierDialog({
  open,
  supplier,
  onOpenChange,
}: {
  open: boolean;
  supplier: Supplier | null;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateSupplier();
  const update = useUpdateSupplier();

  const form = useForm<SupplierUpsert>({
    resolver: zodResolver(supplierUpsert),
    values: {
      name: supplier?.name ?? "",
      contactInfo: supplier?.contactInfo ?? null,
      isActive: supplier?.isActive ?? true,
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (supplier) {
        await update.mutateAsync({ id: supplier.id, ...values });
        toast.success(`Supplier "${values.name}" updated`);
      } else {
        await create.mutateAsync(values);
        toast.success(`Supplier "${values.name}" added`);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the supplier");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{supplier ? "Edit supplier" : "New supplier"}</DialogTitle>
          <DialogDescription>Name plus any contact details worth keeping at hand.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sup-name">Name</Label>
            <Input id="sup-name" autoFocus {...form.register("name")} />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="sup-contact">Contact info (optional)</Label>
            <Textarea id="sup-contact" rows={3} {...form.register("contactInfo")} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || update.isPending}>
              {supplier ? "Save changes" : "Add supplier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
