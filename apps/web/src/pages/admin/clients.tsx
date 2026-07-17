import { useState } from "react";
import {
  AlertCircle,
  BadgeCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  MapPin,
  Package,
  Plus,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  INVENTORY_MODULE_LABELS,
  PACKAGE_LABELS,
  PACKAGE_MAX_ENTITIES,
  PACKAGE_BILLING_CYCLE,
  BILLING_CYCLE_LABELS,
  type BillingCycle,
  type InventoryModule,
  type PackageType,
} from "@fnb/core";
import { PackageAndModulesFields, LocationsField } from "@/components/client-form-fields";
import {
  deriveAccessState,
  daysUntilDue,
  useAddLocation,
  useAdminClients,
  useCancelSubscription,
  useCreateFullClient,
  useCreateSubscription,
  useMarkPaid,
  useUnmarkPaid,
  useUpdateClient,
  useUpdateSubscription,
  type AdminClient,
  type AdminSubscription,
} from "@/api/admin";
import { ApiError } from "@/api/http";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ── Access state helpers ────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function AccessStateBadge({ sub }: { sub: AdminSubscription }) {
  if (sub.status === "CANCELLED") return <Badge variant="destructive">Cancelled</Badge>;
  if (sub.status === "SUSPENDED") return <Badge variant="outline">Suspended</Badge>;
  if (sub.status === "TRIAL") return <Badge variant="secondary">Trial</Badge>;

  if (sub.billingCycle !== "MONTHLY") {
    return sub.paid
      ? <Badge variant="default">Active</Badge>
      : <Badge variant="outline" className="text-amber-600 border-amber-400">Unpaid</Badge>;
  }

  const state = deriveAccessState(sub);
  if (state === "ACTIVE") return <Badge variant="default">Active</Badge>;
  if (state === "VIEW_ONLY") return <Badge variant="destructive">View-only</Badge>;
  return <Badge variant="outline" className="text-amber-600 border-amber-400">Grace period</Badge>;
}

function DueBadge({ sub }: { sub: AdminSubscription }) {
  if (sub.billingCycle !== "MONTHLY") return null;
  if (sub.status === "CANCELLED" || sub.status === "SUSPENDED") return null;

  const state = deriveAccessState(sub);
  if (state === "ACTIVE") return null; // Paid and current — no noise

  const days = daysUntilDue(sub);
  if (days > 0) {
    return (
      <span className="text-xs text-amber-600 font-medium">
        Due in {days}d
      </span>
    );
  }
  const overdue = Math.abs(days);
  return (
    <span className="text-xs text-destructive font-medium">
      Overdue {overdue}d
    </span>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export function AdminClientsPage() {
  const clients = useAdminClients();
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<AdminClient | null>(null);

  return (
    <div>
      <PageHeader
        title="Clients"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New client
          </Button>
        }
      />

      {clients.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (clients.data ?? []).length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No clients yet"
          description="Create the first client to start onboarding locations and users."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New client
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {clients.data!.map((client) => {
            const sub = client.subscription;
            const activeLocations = client.locations.filter((l) => l.status === "ACTIVE").length;
            const atLimit = sub && sub.maxEntities > 0 && activeLocations >= sub.maxEntities;

            return (
              <Card key={client.id} className={client.status !== "ACTIVE" ? "opacity-60" : undefined}>
                <CardHeader className="!flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-base">{client.name}</CardTitle>
                    {client.status !== "ACTIVE" && <Badge variant="outline">Archived</Badge>}
                    {sub ? (
                      <>
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          <BadgeCheck className="size-3" />
                          {PACKAGE_LABELS[sub.packageType as PackageType] ?? sub.packageType}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {INVENTORY_MODULE_LABELS[sub.inventoryModules as InventoryModule] ?? sub.inventoryModules}
                        </span>
                        <AccessStateBadge sub={sub} />
                        <DueBadge sub={sub} />
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        <Package className="size-3" />
                        No package
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {client.access.length} user{client.access.length === 1 ? "" : "s"}
                    </span>
                    {sub && sub.maxEntities > 0 && (
                      <span className={`text-xs ${atLimit ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {activeLocations}/{sub.maxEntities} locations
                      </span>
                    )}
                    {sub && sub.maxEntities === 0 && (
                      <span className="text-xs text-green-600">Unlimited locations</span>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setManaging(client)}>
                    Manage
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {atLimit && (
                    <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      <AlertCircle className="size-3.5 shrink-0" />
                      Location limit reached for <strong>{PACKAGE_LABELS[sub!.packageType as PackageType]}</strong>. Upgrade to add more.
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {client.locations.map((loc) => (
                      <span
                        key={loc.id}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${
                          loc.status !== "ACTIVE" ? "opacity-50 bg-muted/20" : "bg-muted/40"
                        }`}
                      >
                        <MapPin className="size-3.5 text-muted-foreground" />
                        {loc.name}
                        {loc.status !== "ACTIVE" && (
                          <span className="text-xs text-muted-foreground">(inactive)</span>
                        )}
                      </span>
                    ))}
                    {client.locations.length === 0 && (
                      <p className="text-sm text-muted-foreground">No locations yet.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateClientDialog open={creating} onOpenChange={setCreating} />
      <ManageClientDialog client={managing} onClose={() => setManaging(null)} />
    </div>
  );
}

// ── Create client ───────────────────────────────────────────────────────────
// One form: name, locations, and subscription package are all filled in on
// the same screen (mirrors Manage's layout). Nothing is created until
// "Create client" is clicked, which submits everything together to
// POST /clients/full — one atomic transaction on the server.

function CreateClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const createFull = useCreateFullClient();

  const [name, setName] = useState("");
  const [extraLocations, setExtraLocations] = useState<string[]>([]);
  const [newLocName, setNewLocName] = useState("");
  const [packageType, setPackageType] = useState<PackageType>("BASIC");
  const [inventoryModules, setInventoryModules] = useState<InventoryModule>("BAR");
  const billingCycle = PACKAGE_BILLING_CYCLE[packageType];

  const maxEntities = PACKAGE_MAX_ENTITIES[packageType];
  const totalLocations = 1 + extraLocations.length; // "Main" + extras
  const atLimit = maxEntities > 0 && totalLocations >= maxEntities;

  const reset = () => {
    setName("");
    setExtraLocations([]);
    setNewLocName("");
    setPackageType("BASIC");
    setInventoryModules("BAR");
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  const addLoc = () => {
    const trimmed = newLocName.trim();
    if (!trimmed || atLimit) return;
    setExtraLocations((prev) => [...prev, trimmed]);
    setNewLocName("");
  };

  const removeLoc = (index: number) => {
    setExtraLocations((prev) => prev.filter((_, i) => i !== index));
  };

  const submit = async () => {
    try {
      const client = await createFull.mutateAsync({
        name: name.trim(),
        extraLocationNames: extraLocations,
        subscription: {
          packageType,
          billingCycle,
          inventoryModules,
          startDate: today(),
          endDate: null,
          note: null,
        },
      });
      toast.success(`Client "${client.name}" created — remember to mark the subscription as paid once payment is received.`);
      close();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create the client");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New client</DialogTitle>
          <DialogDescription>Set up the client, its locations, and subscription together.</DialogDescription>
        </DialogHeader>

        {/* ── Name ── */}
        <div className="space-y-2">
          <Label htmlFor="client-name">Client name</Label>
          <Input
            id="client-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* ── Subscription (Package + Inventory modules) ── */}
        <PackageAndModulesFields
          packageType={packageType}
          onPackageTypeChange={setPackageType}
          inventoryModules={inventoryModules}
          onInventoryModulesChange={setInventoryModules}
        />

        {/* ── Locations ── */}
        <LocationsField
          inputId="new-client-loc"
          locations={[
            { key: "main", name: "Main" },
            ...extraLocations.map((loc, i) => ({
              key: `${loc}-${i}`,
              name: loc,
              onRemove: () => removeLoc(i),
            })),
          ]}
          newLocName={newLocName}
          onNewLocNameChange={setNewLocName}
          onAdd={addLoc}
          atLimit={atLimit}
          limitMessage={`Location limit reached (${maxEntities} max for ${PACKAGE_LABELS[packageType]}). Choose a bigger package to add more.`}
          helperText={'"Main" is created automatically for every client.'}
        />

        <DialogFooter>
          <Button onClick={submit} disabled={!name.trim() || createFull.isPending}>
            Create client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Manage client dialog (rename + locations + subscription all in one) ──────
//
// ClientDetailBody is the single source of truth for the "name + locations +
// subscription" body. Both Manage and New Client (once the client exists)
// render this exact component, so the two dialogs can never drift apart.

function ManageClientDialog({ client, onClose }: { client: AdminClient | null; onClose: () => void }) {
  if (!client) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{client.name}</DialogTitle>
          <DialogDescription>Manage name, locations, and subscription.</DialogDescription>
        </DialogHeader>
        <ClientDetailBody client={client} />
      </DialogContent>
    </Dialog>
  );
}

function ClientDetailBody({ client }: { client: AdminClient }) {
  const update = useUpdateClient();
  const addLocation = useAddLocation();
  const [name, setName] = useState(client.name);
  const [newLocName, setNewLocName] = useState("");
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const sub = client.subscription;
  const activeLocations = client.locations.filter((l) => l.status === "ACTIVE").length;
  const atLimit = sub && sub.maxEntities > 0 && activeLocations >= sub.maxEntities;

  const saveName = async () => {
    if (!name.trim() || name.trim() === client.name) return;
    try {
      await update.mutateAsync({ id: client.id, name: name.trim() });
      toast.success("Client renamed");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not rename");
    }
  };

  const addLoc = async () => {
    if (!newLocName.trim()) return;
    try {
      await addLocation.mutateAsync({ clientId: client.id, name: newLocName.trim() });
      toast.success(`Location "${newLocName.trim()}" added`);
      setNewLocName("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add location");
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Name ── */}
      <div className="space-y-2">
        <Label htmlFor="manage-name">Client name</Label>
        <div className="flex gap-2">
          <Input
            id="manage-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveName()}
          />
          <Button
            variant="outline"
            onClick={saveName}
            disabled={!name.trim() || name.trim() === client.name || update.isPending}
          >
            Save
          </Button>
        </div>
      </div>

      {/* ── Subscription ── */}
      {sub ? (
        <SubscriptionPanel sub={sub} onCancelRequest={() => setCancelConfirmOpen(true)} />
      ) : (
        <CreateSubscriptionPanel clientId={client.id} />
      )}

      {/* ── Locations ── */}
      <LocationsField
        inputId="manage-loc"
        locations={client.locations.map((loc) => ({
          key: loc.id,
          name: loc.name,
          inactive: loc.status !== "ACTIVE",
        }))}
        newLocName={newLocName}
        onNewLocNameChange={setNewLocName}
        onAdd={addLoc}
        adding={addLocation.isPending}
        atLimit={!!atLimit}
        limitMessage={`Location limit reached (${sub?.maxEntities} max). Upgrade to add more.`}
      />

      {sub && (
        <CancelSubscriptionDialog
          open={cancelConfirmOpen}
          onOpenChange={setCancelConfirmOpen}
          sub={sub}
          clientName={client.name}
        />
      )}
    </div>
  );
}

// ── Subscription panel (shown when client already has one) ──────────────────

function SubscriptionPanel({
  sub,
  onCancelRequest,
}: {
  sub: AdminSubscription;
  onCancelRequest: () => void;
}) {
  const update = useUpdateSubscription();
  const markPaid = useMarkPaid();
  const unmarkPaid = useUnmarkPaid();

  const [packageType, setPackageType] = useState<PackageType>(sub.packageType as PackageType);
  const [inventoryModules, setInventoryModules] = useState<InventoryModule>(sub.inventoryModules as InventoryModule);
  const billingCycle = PACKAGE_BILLING_CYCLE[packageType];

  const isDirty =
    packageType !== sub.packageType || inventoryModules !== sub.inventoryModules;

  const save = async () => {
    try {
      await update.mutateAsync({ id: sub.id, packageType, billingCycle, inventoryModules });
      toast.success("Subscription updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update subscription");
    }
  };

  const handleMarkPaid = async () => {
    try {
      await markPaid.mutateAsync({ id: sub.id });
      toast.success("Marked as paid");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not mark as paid");
    }
  };

  const handleUnmarkPaid = async () => {
    try {
      await unmarkPaid.mutateAsync({ id: sub.id });
      toast.success("Payment mark reversed");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not reverse payment");
    }
  };

  const cancelled = sub.status === "CANCELLED";
  const accessState = sub.status === "CANCELLED" || sub.status === "SUSPENDED"
    ? null
    : deriveAccessState(sub);
  const days = sub.billingCycle === "MONTHLY" ? daysUntilDue(sub) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>Subscription</Label>
        <div className="flex items-center gap-2">
          <AccessStateBadge sub={sub} />
          {days !== null && <DueBadge sub={sub} />}
        </div>
      </div>

      {/* Payment state banner */}
      {!cancelled && accessState === "VIEW_ONLY" && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0" />
          Client is in view-only mode — overdue by more than 7 days. Mark as paid to restore access.
        </div>
      )}
      {!cancelled && accessState === "GRACE" && sub.billingCycle === "MONTHLY" && (
        <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400">
          <CalendarDays className="size-3.5 shrink-0" />
          {days !== null && days >= 0
            ? `Payment due in ${days} day${days === 1 ? "" : "s"}.`
            : `${Math.abs(days ?? 0)} day${Math.abs(days ?? 0) === 1 ? "" : "s"} past due — within grace window.`}
        </div>
      )}

      {/* Mark paid / Unmark paid */}
      {!cancelled && (
        <div className="flex gap-2">
          {!sub.paid ? (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={handleMarkPaid}
              disabled={markPaid.isPending}
            >
              <CheckCircle2 className="size-4" />
              Mark as paid
            </Button>
          ) : (
            <>
              <div className="flex items-center gap-1.5 rounded-md bg-green-50 border border-green-200 px-3 py-1.5 text-xs text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400">
                <CheckCircle2 className="size-3.5" />
                Paid
                {sub.lastPaidAt && (
                  <span className="text-green-500">
                    · {new Date(sub.lastPaidAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={handleUnmarkPaid}
                disabled={unmarkPaid.isPending}
                title="Undo — reverse the mark-paid if it was clicked by mistake"
              >
                <RotateCcw className="size-3.5" />
                Undo
              </Button>
            </>
          )}
        </div>
      )}

      <PackageAndModulesFields
        packageType={packageType}
        onPackageTypeChange={setPackageType}
        inventoryModules={inventoryModules}
        onInventoryModulesChange={setInventoryModules}
        packageLocked={cancelled}
        modulesLocked={cancelled}
      />

      <div className="space-y-2">
        <Label>Billing</Label>
        <div className="flex h-10 items-center rounded-md border border-input bg-muted/50 px-3 text-sm text-muted-foreground">
          {BILLING_CYCLE_LABELS[billingCycle as BillingCycle] ?? billingCycle}
          <span className="ml-auto text-xs">By package</span>
        </div>
      </div>

      <div className="text-xs text-muted-foreground flex gap-4">
        <span className="flex items-center gap-1">
          <CalendarDays className="size-3.5" /> Started {sub.startDate}
        </span>
        {sub.endDate && <span>Ends {sub.endDate}</span>}
      </div>

      {!cancelled && (
        <div className="flex items-center justify-between pt-1">
          <Button
            onClick={save}
            disabled={!isDirty || update.isPending}
            size="sm"
          >
            Save changes
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={onCancelRequest}
          >
            <XCircle className="size-4" />
            Cancel subscription
          </Button>
        </div>
      )}

      {cancelled && (
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          This subscription was cancelled
          {sub.cancelledAt ? ` on ${new Date(sub.cancelledAt as unknown as string).toLocaleDateString()}` : ""}.
        </div>
      )}
    </div>
  );
}

// ── Create subscription panel (shown when client has none) ──────────────────

function CreateSubscriptionPanel({ clientId, onDone }: { clientId: string; onDone?: () => void }) {
  const create = useCreateSubscription();

  const [packageType, setPackageType] = useState<PackageType>("BASIC");
  const [inventoryModules, setInventoryModules] = useState<InventoryModule>("BAR");
  const billingCycle = PACKAGE_BILLING_CYCLE[packageType];

  const submit = async () => {
    try {
      await create.mutateAsync({
        clientId,
        packageType,
        billingCycle,
        inventoryModules,
        startDate: today(),
        endDate: null,
        note: null,
      });
      toast.success("Subscription created — remember to mark it as paid once payment is received.");
      onDone?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create subscription");
    }
  };

  return (
    <div className="space-y-4">
      <Label>Subscription</Label>
      <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
        <Package className="size-3.5 shrink-0" />
        No subscription yet. Assign one below.
      </div>

      <PackageAndModulesFields
        packageType={packageType}
        onPackageTypeChange={setPackageType}
        inventoryModules={inventoryModules}
        onInventoryModulesChange={setInventoryModules}
      />

      <Button onClick={submit} disabled={create.isPending} size="sm">
        Create subscription
      </Button>
    </div>
  );
}

// ── Cancel confirmation dialog ──────────────────────────────────────────────

function CancelSubscriptionDialog({
  open,
  onOpenChange,
  sub,
  clientName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sub: AdminSubscription;
  clientName: string;
}) {
  const cancel = useCancelSubscription();

  const confirm = async () => {
    try {
      await cancel.mutateAsync({ id: sub.id });
      toast.success(`Subscription for "${clientName}" cancelled`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not cancel subscription");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
          <AlertDialogDescription>
            This will cancel the {PACKAGE_LABELS[sub.packageType as PackageType] ?? sub.packageType} subscription
            for <strong>{clientName}</strong>. The client's access will be affected. This action is recorded in the activity log.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={confirm}
            disabled={cancel.isPending}
          >
            Yes, cancel subscription
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
