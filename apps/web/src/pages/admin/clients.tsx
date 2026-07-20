import { useState } from "react";
import {
  AlertCircle,
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
  MODULE_TYPE_LABELS,
  PACKAGE_LABELS,
  PACKAGE_DEFAULT_MAX_ENTITIES,
  PACKAGE_DEFAULT_BILLING_CYCLE,
  type BillingCycle,
  type ModuleType,
  type PackageType,
} from "@fnb/core";
import { PackageAndModulesFields, LocationsField, NegotiatedPriceField } from "@/components/client-form-fields";
import {
  deriveAccessState,
  daysUntilDue,
  useAddLocation,
  useAdminClients,
  useUpdateLocation,
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
import { TableEmpty, TableLoading, TableSurface } from "@/components/table-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function today(): string {
  // Local calendar date, not toISOString() (UTC) — for a UTC+8 user near
  // midnight the UTC date is still "yesterday".
  return formatLocalDate(new Date());
}

/** Timestamps display as YYYY-MM-DD, matching business dates everywhere else. */
function localDate(iso: string): string {
  return formatLocalDate(new Date(iso));
}

function AccessStateBadge({ sub }: { sub: AdminSubscription }) {
  if (sub.status === "CANCELLED") return <Badge variant="destructive">Cancelled</Badge>;
  if (sub.status === "SUSPENDED") return <Badge variant="outline">Suspended</Badge>;
  if (sub.status === "TRIAL") return <Badge variant="secondary">Trial</Badge>;

  if (sub.billingCycle !== "MONTHLY") {
    return sub.paid
      ? <Badge variant="default">Active</Badge>
      : <Badge variant="outline" className="text-warning-text border-warning-text/40">Unpaid</Badge>;
  }

  const state = deriveAccessState(sub);
  if (state === "ACTIVE") return <Badge variant="default">Active</Badge>;
  if (state === "VIEW_ONLY") return <Badge variant="destructive">View-only</Badge>;
  return <Badge variant="outline" className="text-warning-text border-warning-text/40">Grace Period</Badge>;
}

function DueBadge({ sub }: { sub: AdminSubscription }) {
  if (sub.billingCycle !== "MONTHLY") return null;
  if (sub.status === "CANCELLED" || sub.status === "SUSPENDED") return null;

  const state = deriveAccessState(sub);
  if (state === "ACTIVE") return null; // Paid and current — no noise

  const days = daysUntilDue(sub);
  if (days > 0) {
    return (
      <span className="text-xs text-warning-text font-medium">
        Due in {days}d
      </span>
    );
  }
  if (days === 0) {
    return <span className="text-xs text-warning-text font-medium">Due Today</span>;
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
  const [managingId, setManagingId] = useState<string | null>(null);
  // Derive the managed client from the live query — never a snapshot — so
  // mark-paid / add-location / save re-render the open dialog with fresh data.
  const managing = clients.data?.find((c) => c.id === managingId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Clients"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New Client
          </Button>
        }
      />

      <TableSurface>
        {clients.isPending ? (
          <TableLoading rows={4} />
        ) : (clients.data ?? []).length === 0 ? (
          <TableEmpty
            icon={Building2}
            title="No clients yet"
            description="Create the first client to start onboarding locations and users."
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" /> New Client
              </Button>
            }
          />
        ) : (
          <div className="divide-y">
            {clients.data!.map((client) => {
              const sub = client.subscription;
              const activeLocations = client.locations.filter((l) => l.status === "ACTIVE").length;
              const atLimit = sub && sub.maxEntities > 0 && activeLocations >= sub.maxEntities;

              return (
                <section
                  key={client.id}
                  className={client.status !== "ACTIVE" ? "px-4 py-4 opacity-60" : "px-4 py-4"}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold">{client.name}</h2>
                      {client.status !== "ACTIVE" && <Badge variant="outline">Archived</Badge>}
                      {sub && <AccessStateBadge sub={sub} />}
                    </div>
                    <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setManagingId(client.id)}>
                      Manage
                    </Button>
                  </div>
                  <div className="mt-2 space-y-3">
                    {/* One restrained meta line — package, modules, users, location count/limit,
                        due date all read as plain text at the same weight, separated by middots,
                        instead of a row of competing badges. */}
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                      {sub ? (
                        <>
                          <span className="font-medium text-foreground">
                            {PACKAGE_LABELS[sub.packageType as PackageType] ?? sub.packageType}
                          </span>
                          <span>·</span>
                          <span>{sub.modules.map((m) => MODULE_TYPE_LABELS[m as ModuleType] ?? m).join(" + ")}</span>
                          <span>·</span>
                          <span className={atLimit ? "text-destructive font-medium" : undefined}>
                            {sub.maxEntities === 0
                              ? "Unlimited locations"
                              : `${activeLocations}/${sub.maxEntities} locations`}
                          </span>
                        </>
                      ) : (
                        <span>No package</span>
                      )}
                      <span>·</span>
                      <span>
                        {client.access.length} user{client.access.length === 1 ? "" : "s"}
                      </span>
                      {sub && <DueBadge sub={sub} />}
                    </div>

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
                          {loc.modules.length > 0 && (
                            <span className="text-xs text-muted-foreground">
                              ({loc.modules.map((m) => MODULE_TYPE_LABELS[m as ModuleType] ?? m).join("+")})
                            </span>
                          )}
                          {loc.status !== "ACTIVE" && (
                            <span className="text-xs text-muted-foreground">(inactive)</span>
                          )}
                        </span>
                      ))}
                      {client.locations.length === 0 && (
                        <p className="text-sm text-muted-foreground">No locations yet.</p>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </TableSurface>

      <CreateClientDialog open={creating} onOpenChange={setCreating} />
      <ManageClientDialog client={managing} onClose={() => setManagingId(null)} />
    </div>
  );
}

// ── Create Client ───────────────────────────────────────────────────────────
// One form: name, locations, and subscription package are all filled in on
// the same screen (mirrors Manage's layout). Nothing is created until
// "Create Client" is clicked, which submits everything together to
// POST /clients/full — one atomic transaction on the server.

function CreateClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const createFull = useCreateFullClient();

  const [name, setName] = useState("");
  const [extraLocations, setExtraLocations] = useState<string[]>([]);
  const [newLocName, setNewLocName] = useState("");
  const [modules, setModules] = useState<ModuleType[]>(["BAR"]);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(PACKAGE_DEFAULT_BILLING_CYCLE.BASIC);
  const [maxEntities, setMaxEntities] = useState<number>(PACKAGE_DEFAULT_MAX_ENTITIES.BASIC);
  const [negotiatedPrice, setNegotiatedPrice] = useState<number | null>(null);

  const totalLocations = 1 + extraLocations.length; // "Main" + extras
  const atLimit = maxEntities > 0 && totalLocations >= maxEntities;

  const reset = () => {
    setName("");
    setExtraLocations([]);
    setNewLocName("");
    setModules(["BAR"]);
    setBillingCycle(PACKAGE_DEFAULT_BILLING_CYCLE.BASIC);
    setMaxEntities(PACKAGE_DEFAULT_MAX_ENTITIES.BASIC);
    setNegotiatedPrice(null);
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
          billingCycle,
          modules,
          maxEntities,
          negotiatedPrice,
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
          <DialogTitle>New Client</DialogTitle>
        </DialogHeader>

        {/* ── Name ── */}
        <div className="space-y-2">
          <Label htmlFor="client-name">Client Name</Label>
          <Input
            id="client-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* ── Subscription (Billing + Max locations + Inventory modules) — package tier is shown, computed from these, not set separately ── */}
        <PackageAndModulesFields
          modules={modules}
          onModulesChange={setModules}
          billingCycle={billingCycle}
          onBillingCycleChange={setBillingCycle}
          maxEntities={maxEntities}
          onMaxEntitiesChange={setMaxEntities}
        />

        <NegotiatedPriceField value={negotiatedPrice} onChange={setNegotiatedPrice} />

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
          limitMessage={`Location limit reached (${maxEntities} max). Raise "Max locations" to add more.`}
          helperText={'"Main" is created automatically for every client.'}
        />

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || createFull.isPending}>
            Create Client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Manage Client dialog (rename + locations + subscription all in one) ──────
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
          <DialogTitle>Manage Client</DialogTitle>
        </DialogHeader>
        <ClientDetailBody client={client} />
      </DialogContent>
    </Dialog>
  );
}

function ClientDetailBody({ client }: { client: AdminClient }) {
  const updateClient = useUpdateClient();
  const updateSub = useUpdateSubscription();
  const addLocation = useAddLocation();
  const updateLocation = useUpdateLocation();
  const markPaid = useMarkPaid();
  const unmarkPaid = useUnmarkPaid();
  const [name, setName] = useState(client.name);
  const [newLocName, setNewLocName] = useState("");
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const sub = client.subscription;
  const activeLocations = client.locations.filter((l) => l.status === "ACTIVE").length;

  // Subscription fields live here now (not inside SubscriptionPanel) so a
  // single Save button can cover name + subscription together.
  const [modules, setModules] = useState<ModuleType[]>((sub?.modules as ModuleType[]) ?? ["BAR"]);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>((sub?.billingCycle as BillingCycle) ?? "MONTHLY");
  const [maxEntities, setMaxEntities] = useState<number>(sub?.maxEntities ?? 1);
  const [negotiatedPrice, setNegotiatedPrice] = useState<number | null>(sub?.negotiatedPrice ?? null);

  // Uses the live, not-yet-saved maxEntities (same as CreateClientDialog) so
  // picking Basic in the tier dropdown immediately hides "Add location",
  // even before Save is clicked.
  const atLimit = maxEntities > 0 && activeLocations >= maxEntities;

  const nameDirty = name.trim() !== "" && name.trim() !== client.name;
  const subDirty =
    !!sub &&
    (JSON.stringify([...modules].sort()) !== JSON.stringify([...sub.modules].sort()) ||
      billingCycle !== sub.billingCycle ||
      maxEntities !== sub.maxEntities ||
      negotiatedPrice !== sub.negotiatedPrice);
  const isDirty = nameDirty || subDirty;

  // Narrowing the module set here can cascade: the server drops any
  // LocationModule row outside the new set (Fix Plan §2.3 — a location's
  // modules must stay a subset of this ceiling), so warn before that happens.
  const narrowing =
    !!sub && (modules.length < sub.modules.length || sub.modules.some((m) => !modules.includes(m as ModuleType)));

  const saving = updateClient.isPending || updateSub.isPending;

  const save = async () => {
    try {
      if (nameDirty) {
        await updateClient.mutateAsync({ id: client.id, name: name.trim() });
      }
      if (subDirty && sub) {
        await updateSub.mutateAsync({ id: sub.id, billingCycle, modules, maxEntities, negotiatedPrice });
      }
      toast.success("Client updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save changes");
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

  const handleMarkPaid = async () => {
    if (!sub) return;
    try {
      await markPaid.mutateAsync({ id: sub.id });
      toast.success("Marked as paid");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not mark as paid");
    }
  };

  const handleUnmarkPaid = async () => {
    if (!sub) return;
    try {
      await unmarkPaid.mutateAsync({ id: sub.id });
      toast.success("Payment mark reversed");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not reverse payment");
    }
  };

  const cancelled = sub?.status === "CANCELLED";
  // The paid flag alone lies after a monthly rollover (paid=true from LAST
  // period while THIS period is unpaid) — gate the chip and the Mark-as-paid
  // button on whether the CURRENT period is actually covered.
  const currentPeriodPaid = sub
    ? sub.billingCycle !== "MONTHLY" || sub.status === "SUSPENDED"
      ? sub.paid
      : deriveAccessState(sub) === "ACTIVE"
    : false;

  return (
    <div className="space-y-5">
      {/* ── Name ── */}
      <div className="space-y-2">
        <Label htmlFor="manage-name">Client Name</Label>
        <Input
          id="manage-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* ── Subscription ── */}
      {sub ? (
        <SubscriptionPanel
          sub={sub}
          modules={modules}
          onModulesChange={setModules}
          billingCycle={billingCycle}
          onBillingCycleChange={setBillingCycle}
          maxEntities={maxEntities}
          onMaxEntitiesChange={setMaxEntities}
          negotiatedPrice={negotiatedPrice}
          onNegotiatedPriceChange={setNegotiatedPrice}
          narrowing={narrowing}
        />
      ) : (
        <CreateSubscriptionPanel clientId={client.id} />
      )}

      {/* ── Locations ── */}
      <LocationsField
        inputId="manage-loc"
        locations={client.locations.map((loc) => ({
          key: loc.id,
          name: loc.name,
          kind: loc.kind,
          onKindChange: (kind: string | null) =>
            updateLocation
              .mutateAsync({ locationId: loc.id, kind })
              .then(() => toast.success(`"${loc.name}" labeled ${kind ? kind.toLowerCase() : "none"}`))
              .catch((err) => toast.error(err instanceof ApiError ? err.message : "Could not update location")),
          inactive: loc.status !== "ACTIVE",
        }))}
        newLocName={newLocName}
        onNewLocNameChange={setNewLocName}
        onAdd={addLoc}
        adding={addLocation.isPending}
        atLimit={!!atLimit}
      />

      {/* ── Actions: paid status on its own line, then Mark as Paid / Cancel
          (left) + Save (right) together on one row. ── */}
      {sub && !cancelled && (
        <div className="space-y-2 pt-1">
          {currentPeriodPaid && (
            <div className="flex items-center gap-1.5 rounded-md bg-success/10 border border-success/30 px-3 py-1.5 text-xs text-success w-fit">
              <CheckCircle2 className="size-3.5" />
              Paid
              {sub.lastPaidAt && <span>· {localDate(sub.lastPaidAt)}</span>}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {!currentPeriodPaid ? (
                <Button size="sm" className="gap-1.5" onClick={handleMarkPaid} disabled={markPaid.isPending}>
                  <CheckCircle2 className="size-4" />
                  Mark as Paid
                </Button>
              ) : (
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
              )}
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={() => setCancelConfirmOpen(true)}
              >
                <XCircle className="size-4" />
                Cancel Subscription
              </Button>
            </div>
            <Button onClick={save} disabled={!isDirty || saving} size="sm">
              Save
            </Button>
          </div>
        </div>
      )}

      {/* No subscription yet, or cancelled — just Save for name/locations. */}
      {(!sub || cancelled) && (
        <div className="flex justify-end pt-1">
          <Button onClick={save} disabled={!isDirty || saving} size="sm">
            Save
          </Button>
        </div>
      )}

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
  modules,
  onModulesChange,
  billingCycle,
  onBillingCycleChange,
  maxEntities,
  onMaxEntitiesChange,
  negotiatedPrice,
  onNegotiatedPriceChange,
  narrowing,
}: {
  sub: AdminSubscription;
  modules: ModuleType[];
  onModulesChange: (v: ModuleType[]) => void;
  billingCycle: BillingCycle;
  onBillingCycleChange: (v: BillingCycle) => void;
  maxEntities: number;
  onMaxEntitiesChange: (v: number) => void;
  negotiatedPrice: number | null;
  onNegotiatedPriceChange: (v: number | null) => void;
  narrowing: boolean;
}) {
  const cancelled = sub.status === "CANCELLED";
  const accessState = sub.status === "CANCELLED" || sub.status === "SUSPENDED"
    ? null
    : deriveAccessState(sub);
  const days = sub.billingCycle === "MONTHLY" ? daysUntilDue(sub) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>Subscription</Label>
        {!cancelled && <AccessStateBadge sub={sub} />}
      </div>

      {/* One status line — the badge above is the at-a-glance signal; this is
          the only place the explanation appears, so the two never repeat the
          same fact in different words. */}
      {!cancelled && accessState === "VIEW_ONLY" && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0" />
          Overdue by more than 7 days — mark as paid to restore access.
        </div>
      )}
      {!cancelled && accessState === "GRACE" && sub.billingCycle === "MONTHLY" && days !== null && (
        <div className="flex items-center gap-2 rounded-md bg-warning/10 border border-warning-text/30 px-3 py-2 text-xs text-warning-text">
          <CalendarDays className="size-3.5 shrink-0" />
          {days > 0
            ? `Payment due in ${days} day${days === 1 ? "" : "s"}.`
            : days === 0
              ? "Payment is due today."
              : `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} past due — within grace window.`}
        </div>
      )}

      <PackageAndModulesFields
        modules={modules}
        onModulesChange={onModulesChange}
        billingCycle={billingCycle}
        onBillingCycleChange={onBillingCycleChange}
        maxEntities={maxEntities}
        onMaxEntitiesChange={onMaxEntitiesChange}
        locked={cancelled}
        modulesLocked={cancelled}
      />
      {narrowing && (
        <div className="flex items-center gap-2 rounded-md bg-warning/10 border border-warning-text/30 px-3 py-2 text-xs text-warning-text">
          <AlertCircle className="size-3.5 shrink-0" />
          Removing a module here also removes it from any location currently assigned it.
        </div>
      )}

      <NegotiatedPriceField value={negotiatedPrice} onChange={onNegotiatedPriceChange} disabled={cancelled} />

      {/* Meta only — paid status, mark-paid, cancel, and save all now live
          together in the single action row at the bottom of ClientDetailBody. */}
      <div className="text-xs text-muted-foreground flex gap-3 pt-1">
        <span className="flex items-center gap-1">
          <CalendarDays className="size-3.5" /> Started {sub.startDate}
        </span>
        {sub.endDate && <span>Ends {sub.endDate}</span>}
        {cancelled && (
          <span>
            Cancelled{sub.cancelledAt ? ` ${localDate(sub.cancelledAt as unknown as string)}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Create Subscription panel (shown when client has none) ──────────────────

function CreateSubscriptionPanel({ clientId, onDone }: { clientId: string; onDone?: () => void }) {
  const create = useCreateSubscription();

  const [modules, setModules] = useState<ModuleType[]>(["BAR"]);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(PACKAGE_DEFAULT_BILLING_CYCLE.BASIC);
  const [maxEntities, setMaxEntities] = useState<number>(PACKAGE_DEFAULT_MAX_ENTITIES.BASIC);
  const [negotiatedPrice, setNegotiatedPrice] = useState<number | null>(null);

  const submit = async () => {
    try {
      await create.mutateAsync({
        clientId,
        billingCycle,
        modules,
        maxEntities,
        negotiatedPrice,
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
        modules={modules}
        onModulesChange={setModules}
        billingCycle={billingCycle}
        onBillingCycleChange={setBillingCycle}
        maxEntities={maxEntities}
        onMaxEntitiesChange={setMaxEntities}
      />

      <NegotiatedPriceField value={negotiatedPrice} onChange={setNegotiatedPrice} />

      <div className="flex justify-end">
        <Button onClick={submit} disabled={create.isPending} size="sm">
          Create Subscription
        </Button>
      </div>
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
          <AlertDialogTitle>Cancel Subscription?</AlertDialogTitle>
          <AlertDialogDescription>
            This will cancel the {PACKAGE_LABELS[sub.packageType as PackageType] ?? sub.packageType} subscription
            for <strong>{clientName}</strong>. The client's access will be affected. This action is recorded in the activity log.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go Back</AlertDialogCancel>
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
