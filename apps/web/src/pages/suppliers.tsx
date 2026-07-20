import { useState } from "react";
import { useSearchParams } from "react-router";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Truck } from "lucide-react";
import { toast } from "sonner";
import {
  PAYMENT_TERMS,
  PAYMENT_TERMS_LABELS,
  supplierUpsert,
  type PaymentTerms,
  type SupplierUpsert,
} from "@fnb/core";
import { useCreateSupplier, useSuppliers, useUpdateSupplier } from "@/api/location";
import type { Supplier } from "@/api/types";
import { ApiError } from "@/api/http";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, ToolbarSearch } from "@/components/table-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

/** Radix Select has no empty-string value, so "not set" needs a sentinel. */
const NO_TERMS = "__none__";

export function SuppliersPage() {
  const suppliers = useSuppliers();
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  // ?q= seeds the search — the command palette deep-links here with it.
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState("ALL");

  const q = search.trim().toLowerCase();
  const filtered = (suppliers.data ?? []).filter((s) => {
    const matchesStatus = status === "ALL" || (status === "ACTIVE" ? s.isActive : !s.isActive);
    const matchesSearch =
      !q || s.name.toLowerCase().includes(q) || (s.contactInfo ?? "").toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Suppliers"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New Supplier
          </Button>
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarSearch value={search} onChange={setSearch} placeholder="Search suppliers…" />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-36 bg-background" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      >
        {suppliers.isPending ? (
          <TableLoading />
        ) : filtered.length === 0 ? (
          <TableEmpty
            icon={Truck}
            title={(suppliers.data ?? []).length === 0 ? "No suppliers yet" : "Nothing matches the current filter"}
            description={
              (suppliers.data ?? []).length === 0
                ? "Add the vendors this client buys from."
                : "Clear the search or status filter to see everything."
            }
            action={
              (suppliers.data ?? []).length === 0 && (
                <Button onClick={() => setCreating(true)}>
                  <Plus className="size-4" /> New Supplier
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Supplier</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Terms</TableHead>
                <TableHead className="text-right">Status</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground" title={s.contactPerson || s.contactInfo || undefined}>
                    {s.contactPerson || s.contactInfo || "—"}
                  </TableCell>
                  <TableCell className="tnum text-muted-foreground">{s.phone || "—"}</TableCell>
                  <TableCell>
                    {s.paymentTerms ? (
                      <Badge variant="outline">{PAYMENT_TERMS_LABELS[s.paymentTerms]}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
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
        )}
      </TableSurface>

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
      contactPerson: supplier?.contactPerson ?? null,
      phone: supplier?.phone ?? null,
      email: supplier?.email ?? null,
      address: supplier?.address ?? null,
      paymentTerms: supplier?.paymentTerms ?? null,
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
          <DialogTitle>{supplier ? "Edit Supplier" : "New Supplier"}</DialogTitle>
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
          {/* Structured contact + terms (client req 2026-07-20) — these print
              on the Purchase report so buyers know who to call and when
              payment falls due. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sup-person">Contact Person</Label>
              <Input id="sup-person" {...form.register("contactPerson")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sup-phone">Phone</Label>
              <Input id="sup-phone" inputMode="tel" {...form.register("phone")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sup-email">Email</Label>
              <Input id="sup-email" inputMode="email" {...form.register("email")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sup-terms">Payment Terms</Label>
              <Controller
                control={form.control}
                name="paymentTerms"
                render={({ field }) => (
                  <Select
                    value={field.value ?? NO_TERMS}
                    onValueChange={(v) => field.onChange(v === NO_TERMS ? null : (v as PaymentTerms))}
                  >
                    <SelectTrigger id="sup-terms">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TERMS}>Not set</SelectItem>
                      {PAYMENT_TERMS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {PAYMENT_TERMS_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sup-address">Address</Label>
            <Input id="sup-address" {...form.register("address")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sup-contact">Notes (optional)</Label>
            <Textarea id="sup-contact" rows={2} {...form.register("contactInfo")} />
          </div>
          {supplier && (
            <div className="flex items-center justify-between gap-4 border-t pt-4">
              <div className="space-y-1">
                <Label htmlFor="sup-active">Active</Label>
                <p className="text-xs text-muted-foreground">
                  Inactive suppliers are hidden from purchase entry; their past deliveries stay on record.
                </p>
              </div>
              <Switch
                id="sup-active"
                checked={form.watch("isActive") ?? true}
                onCheckedChange={(v) => form.setValue("isActive", v, { shouldDirty: true })}
              />
            </div>
          )}
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
