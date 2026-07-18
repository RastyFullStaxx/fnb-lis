import { AlertCircle, MapPin, Plus, Tag, X } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Package + Inventory modules picker ──────────────────────────────────────
// Shared by CreateClientDialog, CreateSubscriptionPanel, and SubscriptionPanel
// so a styling change in one place applies everywhere. Each field can be
// individually locked to a read-only display (used by SubscriptionPanel once
// a subscription is cancelled).

function ReadOnlyField({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-10 items-center rounded-md border border-input bg-muted/50 px-3 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function PackageAndModulesFields({
  modules,
  onModulesChange,
  billingCycle,
  onBillingCycleChange,
  maxEntities,
  onMaxEntitiesChange,
  locked = false,
  modulesLocked = false,
}: {
  /** Atomic modules the CLIENT is licensed for (the ceiling — Fix Plan §2.2), any non-empty subset of MODULE_TYPES. */
  modules: ModuleType[];
  onModulesChange: (v: ModuleType[]) => void;
  billingCycle: BillingCycle;
  onBillingCycleChange: (v: BillingCycle) => void;
  maxEntities: number;
  onMaxEntitiesChange: (v: number) => void;
  locked?: boolean;
  modulesLocked?: boolean;
}) {
  const toggleModule = (m: ModuleType, checked: boolean) => {
    if (checked) {
      if (!modules.includes(m)) onModulesChange([...modules, m]);
    } else {
      // Keep at least one module selected — an empty set isn't a valid package.
      if (modules.length > 1) onModulesChange(modules.filter((x) => x !== m));
    }
  };

  // There used to be a separate "Package" dropdown (Basic/Medium/One-Time)
  // here, settable independently of billing cycle and max locations. It
  // could drift from reality — e.g. badged "Basic" while actually licensed
  // for unlimited locations — because nothing kept them in sync. It's been
  // removed; the tier is now always computed from the two fields that
  // actually define it (see derivePackageType), shown below as a read-only
  // confirmation instead of a separately-set input.
  const tier = derivePackageType(billingCycle, maxEntities);

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Billing cycle</Label>
          {locked ? (
            <ReadOnlyField>{BILLING_CYCLE_LABELS[billingCycle] ?? billingCycle}</ReadOnlyField>
          ) : (
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
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="max-entities">Max locations</Label>
          {locked ? (
            <ReadOnlyField>{maxEntities === 0 ? "Unlimited" : maxEntities}</ReadOnlyField>
          ) : (
            <Input
              id="max-entities"
              type="number"
              min={0}
              step={1}
              value={maxEntities}
              onChange={(e) => onMaxEntitiesChange(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
              placeholder="0 = unlimited"
            />
          )}
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Tag className="size-3.5 shrink-0" />
        Resolves to the <strong className="font-medium text-foreground">{PACKAGE_LABELS[tier]}</strong> package
        {tier === "MEDIUM" && " (1–5 locations)"}
      </p>

      <div className="space-y-2">
        <Label>Inventory modules</Label>
        {modulesLocked ? (
          <ReadOnlyField>
            {modules.map((m) => MODULE_TYPE_LABELS[m] ?? m).join(" + ")}
          </ReadOnlyField>
        ) : (
          <div className="flex flex-wrap gap-4 rounded-md border border-input px-3 py-2.5">
            {MODULE_TYPES.map((m) => {
              const checked = modules.includes(m);
              return (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => toggleModule(m, v === true)}
                    // Prevent unchecking the last remaining module — a
                    // package must license at least one module (Fix Plan
                    // §2.2: this is the ceiling every location draws from).
                    disabled={checked && modules.length === 1}
                  />
                  {MODULE_TYPE_LABELS[m]}
                </label>
              );
            })}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Composable — select any combination this client is licensed for. Individual locations can then
          be narrowed to a subset of these (e.g. a "Main Bar" location using just Bar).
        </p>
      </div>
    </>
  );
}

// ── Negotiated price (Fix Plan §4 open question #2) ─────────────────────────
// Optional, per-client/per-deal — the Plan catalog itself carries no price.

export function NegotiatedPriceField({
  value,
  onChange,
  disabled = false,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="negotiated-price">Negotiated price (optional)</Label>
      {disabled ? (
        <ReadOnlyField>{value != null ? value.toLocaleString(undefined, { style: "currency", currency: "PHP" }) : "—"}</ReadOnlyField>
      ) : (
        <Input
          id="negotiated-price"
          type="number"
          min={0}
          step={0.01}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Number(e.target.value)))}
          placeholder="Not tracked here"
        />
      )}
      <p className="text-xs text-muted-foreground">
        Per-client deal price, if tracked in-system at all. The plan catalog itself has no fixed price.
      </p>
    </div>
  );
}

// ── Per-location modules picker ─────────────────────────────────────────────
// A location's own modules (Fix Plan §2.3 — the enforced reality) must stay
// a non-empty subset of its client's SubscriptionModule ceiling. `ceiling`
// narrows which checkboxes are even selectable; anything outside it is
// disabled rather than hidden, so it's clear the option exists at the
// subscription level but isn't available to assign here.

export function LocationModulesField({
  modules,
  onModulesChange,
  ceiling,
}: {
  modules: ModuleType[];
  onModulesChange: (v: ModuleType[]) => void;
  ceiling: readonly ModuleType[];
}) {
  const toggleModule = (m: ModuleType, checked: boolean) => {
    if (checked) {
      if (!modules.includes(m)) onModulesChange([...modules, m]);
    } else {
      if (modules.length > 1) onModulesChange(modules.filter((x) => x !== m));
    }
  };

  return (
    <div className="flex flex-wrap gap-4 rounded-md border border-input px-3 py-2.5">
      {MODULE_TYPES.map((m) => {
        const inCeiling = ceiling.includes(m);
        const checked = modules.includes(m);
        return (
          <label
            key={m}
            className={`flex items-center gap-2 text-sm ${inCeiling ? "" : "opacity-40"}`}
            title={inCeiling ? undefined : "Not in this client's subscription"}
          >
            <Checkbox
              checked={checked}
              onCheckedChange={(v) => toggleModule(m, v === true)}
              disabled={!inCeiling || (checked && modules.length === 1)}
            />
            {MODULE_TYPE_LABELS[m]}
          </label>
        );
      })}
    </div>
  );
}

// ── Locations block ──────────────────────────────────────────────────────────
// Shared by CreateClientDialog (local, not-yet-persisted names, removable
// chips) and ClientDetailBody (persisted locations, added immediately via
// API, not removable here). `onAdd` lets the caller decide how "add" behaves;
// everything else — chip rendering, the input, the limit banner — is shared.

export interface LocationChip {
  key: string;
  name: string;
  inactive?: boolean;
  onRemove?: () => void;
}

export function LocationsField({
  locations,
  newLocName,
  onNewLocNameChange,
  onAdd,
  adding = false,
  atLimit = false,
  limitMessage,
  helperText,
  inputId,
}: {
  locations: LocationChip[];
  newLocName: string;
  onNewLocNameChange: (v: string) => void;
  onAdd: () => void;
  adding?: boolean;
  atLimit?: boolean;
  limitMessage?: string;
  helperText?: string;
  inputId?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>Locations</Label>
      <div className="flex flex-wrap gap-2">
        {locations.map((loc) => (
          <span
            key={loc.key}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${
              loc.inactive ? "opacity-50 bg-muted/20" : "bg-muted/40"
            }`}
          >
            <MapPin className="size-3.5 text-muted-foreground" />
            {loc.name}
            {loc.inactive && <span className="text-xs text-muted-foreground">(inactive)</span>}
            {loc.onRemove && (
              <button
                type="button"
                onClick={loc.onRemove}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${loc.name}`}
              >
                <X className="size-3.5" />
              </button>
            )}
          </span>
        ))}
        {locations.length === 0 && (
          <p className="text-sm text-muted-foreground">No locations yet.</p>
        )}
      </div>
      {helperText && <p className="text-xs text-muted-foreground">{helperText}</p>}
      {atLimit ? (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0" />
          {limitMessage ?? "Location limit reached."}
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            id={inputId}
            placeholder="New location name…"
            value={newLocName}
            onChange={(e) => onNewLocNameChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onAdd())}
          />
          <Button type="button" variant="outline" onClick={onAdd} disabled={!newLocName.trim() || adding}>
            <Plus className="size-4" /> Add
          </Button>
        </div>
      )}
    </div>
  );
}
