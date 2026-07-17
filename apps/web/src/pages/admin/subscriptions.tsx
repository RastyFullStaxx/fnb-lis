import { useState } from "react";
import { BadgeCheck, Building2, CalendarDays, Package, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  PACKAGE_TYPES,
  BILLING_CYCLES,
  INVENTORY_MODULES,
  PACKAGE_LABELS,
  INVENTORY_MODULE_LABELS,
  BILLING_CYCLE_LABELS,
  PACKAGE_MAX_ENTITIES,
  type PackageType,
  type BillingCycle,
  type InventoryModule,
} from "@fnb/core";
import {
  useAdminClients,
  useAdminSubscriptions,
  useCreateSubscription,
  useUpdateSubscription,
  type AdminSubscriptionWithClient,
} from "@/api/admin";
import { ApiError } from "@/api/http";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, ToolbarSearch } from "@/components/table-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ACTIVE: "default",
  TRIAL: "secondary",
  SUSPENDED: "outline",
  CANCELLED: "destructive",
};

function packageBadgeVariant(pkg: string): "default" | "secondary" | "outline" {
  if (pkg === "ONE_TIME") return "default";
  if (pkg === "MEDIUM") return "secondary";
  return "outline";
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AdminSubscriptionsPage() {
  const subs = useAdminSubscriptions();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminSubscriptionWithClient | null>(null);
  const [search, setSearch] = useState("");
  const [pkgFilter, setPkgFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const q = search.trim().toLowerCase();
  const filtered = (subs.data ?? []).filter((s) => {
    const matchesPkg = pkgFilter === "ALL" || s.packageType === pkgFilter;
    const matchesStatus = statusFilter === "ALL" || s.status === statusFilter;
    const matchesSearch = !q || s.client.name.toLowerCase().includes(q);
    return matchesPkg && matchesStatus && matchesSearch;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Subscriptions & Packages"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New subscription
          </Button>
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarSearch value={search} onChange={setSearch} placeholder="Search client…" />
            <Select value={pkgFilter} onValueChange={setPkgFilter}>
              <SelectTrigger className="w-44 bg-background">
                <SelectValue placeholder="Package" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All packages</SelectItem>
                {PACKAGE_TYPES.map((p) => (
                  <SelectItem key={p} value={p}>{PACKAGE_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 bg-background">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="TRIAL">Trial</SelectItem>
                <SelectItem value="SUSPENDED">Suspended</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      >
        {subs.isPending ? (
          <TableLoading />
        ) : filtered.length === 0 ? (
          <TableEmpty
            icon={Package}
            title={(subs.data ?? []).length === 0 ? "No subscriptions yet" : "Nothing matches the filter"}
            description={
              (subs.data ?? []).length === 0
                ? "Assign packages to clients to track their access level."
                : "Clear filters to see all subscriptions."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Client</TableHead>
                <TableHead>Package</TableHead>
                <TableHead>Inventory Modules</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead>Entities</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.id} className={s.status === "CANCELLED" ? "opacity-60" : undefined}>
                  <TableCell>
                    <div className="flex items-center gap-1.5 font-medium">
                      <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                      {s.client.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={packageBadgeVariant(s.packageType)}>
                      {PACKAGE_LABELS[s.packageType as PackageType] ?? s.packageType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {INVENTORY_MODULE_LABELS[s.inventoryModules as InventoryModule] ?? s.inventoryModules}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {BILLING_CYCLE_LABELS[s.billingCycle as BillingCycle] ?? s.billingCycle}
                  </TableCell>
                  <TableCell className="text-sm">
                    {s.maxEntities === 0 ? (
                      <span className="text-green-600 font-medium">Unlimited</span>
                    ) : (
                      <span>{s.maxEntities}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <CalendarDays className="size-3.5" />
                      {s.startDate}
                      {s.endDate && <span> – {s.endDate}</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[s.status] ?? "outline"}>{s.status}</Badge>
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

      <CreateSubscriptionDialog open={creating} onOpenChange={setCreating} />
      {editing && <EditSubscriptionDialog sub={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ── Create dialog ──

function CreateSubscriptionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const clients = useAdminClients();
  const create = useCreateSubscription();

  const [clientId, setClientId] = useState("");
  const [packageType, setPackageType] = useState<PackageType>("BASIC");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("MONTHLY");
  const [inventoryModules, setInventoryModules] = useState<InventoryModule>("BAR");
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");

  const reset = () => {
    setClientId("");
    setPackageType("BASIC");
    setBillingCycle("MONTHLY");
    setInventoryModules("BAR");
    setStartDate(today());
    setEndDate("");
    setNote("");
  };

  const submit = async () => {
    try {
      const sub = await create.mutateAsync({
        clientId,
        packageType,
        billingCycle,
        inventoryModules,
        startDate,
        endDate: endDate || null,
        note: note || null,
      });
      toast.success(`Subscription created for ${sub.client.name}`);
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create subscription");
    }
  };

  const valid = clientId && startDate;

  // Filter out clients that already have a subscription
  const eligibleClients = (clients.data ?? []).filter((c) => !c.subscription && c.status === "ACTIVE");

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New subscription</DialogTitle>
          <DialogDescription>Assign a package and inventory modules to a client.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Client</Label>
              {clients.isPending ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a client…" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleClients.length === 0 ? (
                      <SelectItem value="__none__" disabled>All active clients have subscriptions</SelectItem>
                    ) : (
                      eligibleClients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label>Package</Label>
              <Select value={packageType} onValueChange={(v) => setPackageType(v as PackageType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PACKAGE_TYPES.map((p) => (
                    <SelectItem key={p} value={p}>
                      <div>
                        <span className="font-medium">{PACKAGE_LABELS[p]}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {PACKAGE_MAX_ENTITIES[p] === 0 ? "Unlimited entities" : `Up to ${PACKAGE_MAX_ENTITIES[p]} entities`}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Billing cycle</Label>
              <Select value={billingCycle} onValueChange={(v) => setBillingCycle(v as BillingCycle)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_CYCLES.map((b) => (
                    <SelectItem key={b} value={b}>{BILLING_CYCLE_LABELS[b]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Inventory modules</Label>
              <Select value={inventoryModules} onValueChange={(v) => setInventoryModules(v as InventoryModule)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVENTORY_MODULES.map((m) => (
                    <SelectItem key={m} value={m}>{INVENTORY_MODULE_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-date">End date (optional)</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                placeholder="No expiry"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sub-note">Note (optional)</Label>
            <Input
              id="sub-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Paid via bank transfer, ref #12345"
            />
          </div>

          {packageType && (
            <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
              <div className="flex items-center gap-1.5 font-medium">
                <BadgeCheck className="size-4 text-primary" />
                Package summary
              </div>
              <div className="text-muted-foreground">
                <span className="font-medium">{PACKAGE_LABELS[packageType]}</span>
                {" — "}
                {PACKAGE_MAX_ENTITIES[packageType] === 0
                  ? "Unlimited entities/locations"
                  : `Up to ${PACKAGE_MAX_ENTITIES[packageType]} entities/locations`}
              </div>
              <div className="text-muted-foreground">
                Modules: {INVENTORY_MODULE_LABELS[inventoryModules]}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={!valid || create.isPending}>
            Create subscription
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit dialog ──

function EditSubscriptionDialog({ sub, onClose }: { sub: AdminSubscriptionWithClient; onClose: () => void }) {
  const update = useUpdateSubscription();

  const [packageType, setPackageType] = useState<PackageType>(sub.packageType as PackageType);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(sub.billingCycle as BillingCycle);
  const [inventoryModules, setInventoryModules] = useState<InventoryModule>(sub.inventoryModules as InventoryModule);
  const [status, setStatus] = useState(sub.status);
  const [startDate, setStartDate] = useState(sub.startDate);
  const [endDate, setEndDate] = useState(sub.endDate ?? "");
  const [note, setNote] = useState(sub.note ?? "");

  const save = async () => {
    try {
      await update.mutateAsync({
        id: sub.id,
        packageType,
        billingCycle,
        inventoryModules,
        status,
        startDate,
        endDate: endDate || null,
        note: note || null,
      });
      toast.success("Subscription updated");
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update subscription");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit subscription — {sub.client.name}</DialogTitle>
          <DialogDescription>Update package, modules, billing cycle, or status.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Package</Label>
              <Select value={packageType} onValueChange={(v) => setPackageType(v as PackageType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PACKAGE_TYPES.map((p) => (
                    <SelectItem key={p} value={p}>
                      <span className="font-medium">{PACKAGE_LABELS[p]}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {PACKAGE_MAX_ENTITIES[p] === 0 ? "Unlimited" : `≤${PACKAGE_MAX_ENTITIES[p]}`}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="TRIAL">Trial</SelectItem>
                  <SelectItem value="SUSPENDED">Suspended</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Billing cycle</Label>
            <Select value={billingCycle} onValueChange={(v) => setBillingCycle(v as BillingCycle)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BILLING_CYCLES.map((b) => (
                  <SelectItem key={b} value={b}>{BILLING_CYCLE_LABELS[b]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Inventory modules</Label>
            <Select value={inventoryModules} onValueChange={(v) => setInventoryModules(v as InventoryModule)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVENTORY_MODULES.map((m) => (
                  <SelectItem key={m} value={m}>{INVENTORY_MODULE_LABELS[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit-start">Start date</Label>
              <Input id="edit-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-end">End date</Label>
              <Input id="edit-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-note">Note</Label>
            <Input id="edit-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={update.isPending}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
