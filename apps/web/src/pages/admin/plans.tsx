import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Package, Pencil, Plus, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  BILLING_CYCLE_LABELS,
  BILLING_CYCLES,
  MODULE_TYPE_LABELS,
  MODULE_TYPES,
  PACKAGE_LABELS,
  derivePackageType,
  type BillingCycle,
  type ModuleType,
} from "@fnb/core";
import {
  useAdminPlans,
  useCreatePlan,
  useDeletePlan,
  useUpdatePlan,
  type AdminPlan,
} from "@/api/admin";
import { ApiError } from "@/api/http";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// The sellable catalog (Fix Plan Phase D §2.1) — sales composes new
// packaging combos (billing cycle, module set, max locations) here without
// an engineer redeploying code. No price field: pricing is per-client/deal,
// tracked (optionally) on the Subscription itself, not the Plan.

export function AdminPlansPage() {
  const plans = useAdminPlans();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminPlan | null>(null);
  const deletePlan = useDeletePlan();

  const sorted = [...(plans.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const handleDelete = async (plan: AdminPlan) => {
    try {
      await deletePlan.mutateAsync({ id: plan.id });
      toast.success(`Deleted plan "${plan.name}"`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete plan");
    }
  };

  return (
    <div>
      <PageHeader
        title="Plans"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New plan
          </Button>
        }
      />

      <p className="mb-4 text-sm text-muted-foreground">
        The sellable catalog — compose a new packaging combo here (billing cycle, modules, max locations) so it's
        ready to pick from when creating a client. No price lives here; pricing is per-client/per-deal.
      </p>

      {plans.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No plans yet"
          description="Create the first sellable plan — a billing cycle, a module set, and a max location count."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New plan
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {sorted.map((plan) => (
            <Card key={plan.id} className={!plan.isActive ? "opacity-60" : undefined}>
              <CardHeader className="!flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                  {plan.isActive ? (
                    <Badge variant="default" className="gap-1">
                      <CheckCircle2 className="size-3" /> Active
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-muted-foreground">
                      <XCircle className="size-3" /> Inactive
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">{BILLING_CYCLE_LABELS[plan.billingCycle as BillingCycle] ?? plan.billingCycle}</span>
                  <span className="text-xs text-muted-foreground">
                    {plan.modules.map((m) => MODULE_TYPE_LABELS[m as ModuleType] ?? m).join(" + ")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {plan.maxEntities === 0 ? "Unlimited locations" : `${plan.maxEntities} location${plan.maxEntities === 1 ? "" : "s"}`}
                  </span>
                  <Badge variant="outline" className="gap-1 text-muted-foreground">
                    {PACKAGE_LABELS[derivePackageType(plan.billingCycle as BillingCycle, plan.maxEntities)]}
                  </Badge>
                </div>
                <Button variant="ghost" size="sm" className="shrink-0 gap-1.5" onClick={() => setEditing(plan)}>
                  <Pencil className="size-3.5" /> Edit
                </Button>
              </CardHeader>
              <CardContent>
                <PlanUsageNote plan={plan} onDelete={() => handleDelete(plan)} deleting={deletePlan.isPending} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreatePlanDialog open={creating} onOpenChange={setCreating} />
      <EditPlanDialog plan={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

// Deleting only succeeds server-side once nothing references the plan
// (a Subscription's planId is kept for traceability) — surface that as a
// disabled-with-explanation state rather than letting the delete round-trip
// fail with no context.
function PlanUsageNote({ plan, onDelete, deleting }: { plan: AdminPlan; onDelete: () => void; deleting: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs text-muted-foreground">
        Editing this plan never changes existing clients already on it — their subscription fields were snapshotted
        at signup.
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-destructive hover:text-destructive"
        onClick={onDelete}
        disabled={deleting}
        title="Only works if no subscription currently references this plan — deactivate it instead if it's in use."
      >
        Delete
      </Button>
    </div>
  );
}

// ── Shared plan fields ───────────────────────────────────────────────────────

function PlanFields({
  name,
  onNameChange,
  billingCycle,
  onBillingCycleChange,
  modules,
  onModulesChange,
  maxEntities,
  onMaxEntitiesChange,
  isActive,
  onIsActiveChange,
}: {
  name: string;
  onNameChange: (v: string) => void;
  billingCycle: BillingCycle;
  onBillingCycleChange: (v: BillingCycle) => void;
  modules: ModuleType[];
  onModulesChange: (v: ModuleType[]) => void;
  maxEntities: number;
  onMaxEntitiesChange: (v: number) => void;
  isActive: boolean;
  onIsActiveChange: (v: boolean) => void;
}) {
  const toggleModule = (m: ModuleType, checked: boolean) => {
    if (checked) {
      if (!modules.includes(m)) onModulesChange([...modules, m]);
    } else {
      if (modules.length > 1) onModulesChange(modules.filter((x) => x !== m));
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="plan-name">Name</Label>
        <Input
          id="plan-name"
          autoFocus
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder='e.g. "Bar Only — Monthly"'
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Billing cycle</Label>
          <Select value={billingCycle} onValueChange={(v) => onBillingCycleChange(v as BillingCycle)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BILLING_CYCLES.map((bc) => (
                <SelectItem key={bc} value={bc}>
                  {BILLING_CYCLE_LABELS[bc]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="plan-max-entities">Max locations</Label>
          <Input
            id="plan-max-entities"
            type="number"
            min={0}
            step={1}
            value={maxEntities}
            onChange={(e) => onMaxEntitiesChange(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
            placeholder="0 = unlimited"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Inventory modules</Label>
        <div className="flex flex-wrap gap-4 rounded-md border border-input px-3 py-2.5">
          {MODULE_TYPES.map((m) => {
            const checked = modules.includes(m);
            return (
              <label key={m} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => toggleModule(m, v === true)}
                  disabled={checked && modules.length === 1}
                />
                {MODULE_TYPE_LABELS[m]}
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Composable — any combination. This becomes the ceiling a client on this plan is licensed for.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="text-sm">
          <div className="font-medium">Active</div>
          <p className="text-xs text-muted-foreground">Inactive plans stay usable by existing clients but drop out of the picker for new ones.</p>
        </div>
        <Switch checked={isActive} onCheckedChange={onIsActiveChange} />
      </div>
    </div>
  );
}

// ── Create ──────────────────────────────────────────────────────────────────

function CreatePlanDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreatePlan();
  const [name, setName] = useState("");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("MONTHLY");
  const [modules, setModules] = useState<ModuleType[]>(["BAR"]);
  const [maxEntities, setMaxEntities] = useState<number>(1);
  const [isActive, setIsActive] = useState(true);

  const reset = () => {
    setName("");
    setBillingCycle("MONTHLY");
    setModules(["BAR"]);
    setMaxEntities(1);
    setIsActive(true);
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  const submit = async () => {
    try {
      await create.mutateAsync({ name: name.trim(), billingCycle, modules, maxEntities, isActive });
      toast.success(`Plan "${name.trim()}" created`);
      close();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create plan");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New plan</DialogTitle>
          <DialogDescription>Compose a new sellable packaging combo for the catalog.</DialogDescription>
        </DialogHeader>
        <PlanFields
          name={name}
          onNameChange={setName}
          billingCycle={billingCycle}
          onBillingCycleChange={setBillingCycle}
          modules={modules}
          onModulesChange={setModules}
          maxEntities={maxEntities}
          onMaxEntitiesChange={setMaxEntities}
          isActive={isActive}
          onIsActiveChange={setIsActive}
        />
        <DialogFooter>
          <Button onClick={submit} disabled={!name.trim() || create.isPending}>
            Create plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit ────────────────────────────────────────────────────────────────────

function EditPlanDialog({ plan, onClose }: { plan: AdminPlan | null; onClose: () => void }) {
  const update = useUpdatePlan();
  const [name, setName] = useState("");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("MONTHLY");
  const [modules, setModules] = useState<ModuleType[]>(["BAR"]);
  const [maxEntities, setMaxEntities] = useState<number>(1);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (plan) {
      setName(plan.name);
      setBillingCycle(plan.billingCycle as BillingCycle);
      setModules(plan.modules as ModuleType[]);
      setMaxEntities(plan.maxEntities);
      setIsActive(plan.isActive);
    }
  }, [plan]);

  if (!plan) return null;

  const isDirty =
    name.trim() !== plan.name ||
    billingCycle !== plan.billingCycle ||
    maxEntities !== plan.maxEntities ||
    isActive !== plan.isActive ||
    JSON.stringify([...modules].sort()) !== JSON.stringify([...plan.modules].sort());

  const save = async () => {
    try {
      await update.mutateAsync({ id: plan.id, name: name.trim(), billingCycle, modules, maxEntities, isActive });
      toast.success(`Plan "${name.trim()}" updated`);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update plan");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{plan.name}</DialogTitle>
          <DialogDescription>
            Changes here never retroactively affect clients already on this plan — their subscription was
            snapshotted at signup.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <AlertCircle className="size-3.5 shrink-0" />
          Deactivating hides this plan from the picker for new clients but keeps it usable by anyone already on it.
        </div>
        <PlanFields
          name={name}
          onNameChange={setName}
          billingCycle={billingCycle}
          onBillingCycleChange={setBillingCycle}
          modules={modules}
          onModulesChange={setModules}
          maxEntities={maxEntities}
          onMaxEntitiesChange={setMaxEntities}
          isActive={isActive}
          onIsActiveChange={setIsActive}
        />
        <DialogFooter>
          <Button onClick={save} disabled={!isDirty || !name.trim() || update.isPending}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
