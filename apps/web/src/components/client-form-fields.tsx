import { useEffect, useState } from "react";
import { MapPin, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  BILLING_CYCLE_LABELS,
  BILLING_CYCLES,
  LOCATION_KIND_LABELS,
  LOCATION_KINDS,
  MODULE_TYPE_LABELS,
  MODULE_TYPES,
  PACKAGE_LABELS,
  PACKAGE_MAX_USERS,
  REPORT_METADATA,
  REPORT_SLUGS,
  derivePackageType,
  type BillingCycle,
  type ModuleType,
  type PackageType,
  type ReportSlug,
} from "@fnb/core";
import { ApiError } from "@/api/http";
import { useUpdateSubscriptionReports } from "@/api/admin";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { QuantityInput } from "@/components/quantity-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  maxUsers,
  onMaxUsersChange,
  maxDevices,
  onMaxDevicesChange,
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
  /** Max user accounts (client req 2026-07-21); 0 = no cap saved. */
  maxUsers: number;
  onMaxUsersChange: (v: number) => void;
  /** Offline desktop computers this client may register; 0 = unlimited. */
  maxDevices: number;
  onMaxDevicesChange: (v: number) => void;
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

  const tier = derivePackageType(billingCycle, maxEntities, maxUsers);
  const isStandalone = billingCycle === "STANDALONE";

  // Picking a monthly tier sets its user cap (Basic 1 / Medium 5 / Full 10) —
  // the tier IS the cap (client req 2026-07-21). Locations follow along so a
  // 1-user Basic can't hold 5 locations.
  const handleTierChange = (next: PackageType) => {
    onMaxUsersChange(PACKAGE_MAX_USERS[next]);
    if (next === "BASIC") onMaxEntitiesChange(1);
    else if (maxEntities < 2) onMaxEntitiesChange(2);
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Billing Cycle</Label>
          {locked ? (
            <ReadOnlyField>{BILLING_CYCLE_LABELS[billingCycle] ?? billingCycle}</ReadOnlyField>
          ) : (
            <Select
              value={billingCycle}
              onValueChange={(v) => {
                const next = v as BillingCycle;
                onBillingCycleChange(next);
                if (next === "MONTHLY" && billingCycle === "STANDALONE") {
                  onMaxEntitiesChange(1);
                }
              }}
            >
              <SelectTrigger>
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
          <Label htmlFor="package-tier">Package</Label>
          {locked ? (
            <ReadOnlyField>{PACKAGE_LABELS[tier]}</ReadOnlyField>
          ) : isStandalone ? (
            <ReadOnlyField>{PACKAGE_LABELS.ONE_TIME}</ReadOnlyField>
          ) : (
            <Select value={tier} onValueChange={(v) => handleTierChange(v as PackageType)}>
              <SelectTrigger id="package-tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BASIC">Basic — 1 user</SelectItem>
                <SelectItem value="MEDIUM">Medium — up to 5 users</SelectItem>
                <SelectItem value="FULL">Full — up to 10 users</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {!locked && (
        <>
          <div className={isStandalone ? "grid grid-cols-2 gap-3" : ""}>
            {isStandalone && (
              // Standalone: the owner sets his own ceiling so user accounts can't
              // be generated without his knowledge (client req 2026-07-21).
              <div className="space-y-2">
                <Label htmlFor="max-users">Max Users</Label>
                <QuantityInput
                  id="max-users"
                  className="tnum"
                  value={String(maxUsers || "")}
                  placeholder="e.g. 5"
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    onMaxUsersChange(e.target.value === "" || !Number.isFinite(n) ? 0 : Math.max(0, Math.trunc(n)));
                  }}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="max-devices">Max Computers</Label>
              <QuantityInput
                id="max-devices"
                className="tnum"
                value={String(maxDevices || "")}
                placeholder="e.g. 1"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onMaxDevicesChange(e.target.value === "" || !Number.isFinite(n) ? 1 : Math.max(1, Math.trunc(n)));
                }}
              />
            </div>
          </div>

          {(isStandalone || tier !== "BASIC") && (
            <div className="space-y-2">
              <Label htmlFor="max-entities">Max Locations</Label>
              <QuantityInput
                id="max-entities"
                className="tnum"
                value={String(maxEntities || "")}
                placeholder="e.g. 2"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onMaxEntitiesChange(e.target.value === "" || !Number.isFinite(n) ? 0 : Math.max(0, Math.trunc(n)));
                }}
              />
            </div>
          )}
        </>
      )}

      <div className="space-y-2">
        <Label>Inventory Modules</Label>
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
          Locations can be narrowed to a subset of these.
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
  // Local text state: parsing to a number on every keystroke would clobber an
  // in-progress decimal ("12." re-rendering as "12" makes ₱12.50 untypeable
  // in a controlled text input). The parsed value commits on every change,
  // but the FIELD shows what was typed until it loses focus.
  const [text, setText] = useState(value != null ? String(value) : "");
  useEffect(() => {
    // External resets (switching clients) re-sync the field.
    setText(value != null ? String(value) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value == null ? "" : String(value)]);

  return (
    <div className="space-y-2">
      <Label htmlFor="negotiated-price">Negotiated price (optional)</Label>
      {disabled ? (
        <ReadOnlyField>{value != null ? value.toLocaleString(undefined, { style: "currency", currency: "PHP" }) : "—"}</ReadOnlyField>
      ) : (
        <QuantityInput
          id="negotiated-price"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const parsed = Number(e.target.value);
            onChange(e.target.value === "" || !Number.isFinite(parsed) ? null : Math.max(0, parsed));
          }}
          onBlur={() => setText(value != null ? String(value) : "")}
          placeholder="Not tracked here"
        />
      )}
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

function LocationModulesPopover({
  modules,
  ceiling,
  onChange,
}: {
  modules: ModuleType[];
  ceiling: readonly ModuleType[];
  onChange: (v: ModuleType[]) => void;
}) {
  const toggleModule = (m: ModuleType, checked: boolean) => {
    if (checked) {
      if (!modules.includes(m)) onChange([...modules, m]);
    } else {
      if (modules.length > 1) onChange(modules.filter((x) => x !== m));
    }
  };

  const label =
    modules.length === 0
      ? "No modules"
      : modules.map((m) => MODULE_TYPE_LABELS[m] ?? m).join(" + ");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-6 shrink-0 gap-1 rounded-md px-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="end">
        <p className="mb-2 text-xs font-semibold">Modules</p>
        <div className="flex flex-col gap-2">
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
      </PopoverContent>
    </Popover>
  );
}

export interface LocationChip {
  key: string;
  name: string;
  /** MAIN | SATELLITE | STOCKROOM | null — grouping label (client req #13). */
  kind?: string | null;
  /** When present, the chip shows a compact kind selector (persisted locations only). */
  onKindChange?: (kind: string | null) => void;
  /** This location's OWN modules (Fix Plan §2.3) — must stay a subset of `moduleCeiling`. */
  modules?: ModuleType[];
  /** The client's licensed modules — bounds what can be picked for this location. */
  moduleCeiling?: readonly ModuleType[];
  /** When present (with `modules`/`moduleCeiling`), the chip shows a compact module picker. */
  onModulesChange?: (modules: ModuleType[]) => void;
  inactive?: boolean;
  onRemove?: () => void;
}

// ── Subscription reports checklist — where it lives (Phase 5.3.2) ───────────
// Decision: Option A, a separate dialog, opened from a button/link on
// ClientDetailBody next to the Locations block — not a section inside
// ManageClientDialog.
//
// Why: ManageClientDialog is a `sm:max-w-lg`, already-scrolling dialog
// (Name + Subscription + Locations + Actions stacked in it), built around one
// shared `save()` / `isDirty` covering name + subscription together
// (ClientDetailBody, apps/web/src/pages/admin/clients.tsx). The reports
// checklist is 21 checkboxes across 5 group headers (REPORT_METADATA,
// @fnb/core) — a flat addition at that count pushes the dialog well past a
// comfortable scroll length. It also already has its own endpoint
// (`PUT /clients/:id/subscription/reports`, Phase 5.2) and will have its own
// dirty state, so folding it into the shared Save would either break the
// "one Save" model or require restructuring ClientDetailBody around two
// independent save cycles. A focused sub-dialog for a big-enough sub-task
// costs less than that restructuring and keeps ManageClientDialog's existing
// height and single-Save model untouched.
//
// This fixes the component boundary for Phase 5.3.3: a new
// `SubscriptionReportsDialog` component, opened imperatively (open/onClose
// props, same shape as ManageClientDialog itself) from a "Manage Reports"
// trigger placed beside the Locations block in ClientDetailBody. It owns its
// own checked-slugs state, its own dirty check, and its own Save button —
// none of it routes through ClientDetailBody's `save()` / `isDirty`.
//
// Phase 5.3.3 builds the component itself: grouping, checkboxes, local dirty
// state. Phase 5.3.4 wires the actual save call
// (`useUpdateSubscriptionReports()`); Phase 5.3.5 adds the entry point and
// the no-subscription / cancelled-subscription guards. Until 5.3.4 lands,
// `onSave` is a plain callback prop the caller supplies — this component
// doesn't know or care whether that callback hits the network yet.

/** REPORT_SLUGS grouped by REPORT_METADATA's `group`, in REPORT_SLUGS' own
 * order — so the checklist's section order matches the report hub's
 * SECTIONS order (both ultimately sourced from the same place, Phase 5.3.1),
 * without hardcoding a second group-order list here that could drift. */
function groupedReportSlugs(): Array<{ group: string; slugs: ReportSlug[] }> {
  const order: string[] = [];
  const bySlug = new Map<string, ReportSlug[]>();
  for (const slug of REPORT_SLUGS) {
    const { group } = REPORT_METADATA[slug];
    if (!bySlug.has(group)) {
      bySlug.set(group, []);
      order.push(group);
    }
    bySlug.get(group)!.push(slug);
  }
  return order.map((group) => ({ group, slugs: bySlug.get(group)! }));
}

const REPORT_GROUPS = groupedReportSlugs();

/** Sorted-array equality for the dirty check — same
 * `JSON.stringify([...x].sort())` comparison `ClientDetailBody` already uses
 * for the modules array (Phase 5.3.3 spec). */
function sameSlugSet(a: readonly string[], b: readonly string[]): boolean {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

export function SubscriptionReportsChecklist({
  enabledSlugs,
  onChange,
}: {
  enabledSlugs: ReportSlug[];
  onChange: (v: ReportSlug[]) => void;
}) {
  const toggle = (slug: ReportSlug, checked: boolean) => {
    if (checked) {
      if (!enabledSlugs.includes(slug)) onChange([...enabledSlugs, slug]);
    } else {
      onChange(enabledSlugs.filter((s) => s !== slug));
    }
  };

  return (
    <div className="space-y-5">
      {REPORT_GROUPS.map(({ group, slugs }) => (
        <div key={group} className="space-y-2">
          <p className="text-sm font-semibold">{group}</p>
          <div className="space-y-1.5">
            {slugs.map((slug) => {
              const checked = enabledSlugs.includes(slug);
              return (
                <label key={slug} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={checked} onCheckedChange={(v) => toggle(slug, v === true)} />
                  {REPORT_METADATA[slug].label}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SubscriptionReportsDialog({
  open,
  onClose,
  clientName,
  currentSlugs,
  onSave,
  saving = false,
}: {
  open: boolean;
  onClose: () => void;
  clientName: string;
  /** The subscription's currently-saved SubscriptionReport slugs. */
  currentSlugs: readonly string[];
  /** Called with the full desired slug list on Save (Phase 5.3.4 wires the
   * actual `PUT /clients/:id/subscription/reports` call here). */
  onSave: (slugs: ReportSlug[]) => void | Promise<void>;
  saving?: boolean;
}) {
  const [checked, setChecked] = useState<ReportSlug[]>(currentSlugs as ReportSlug[]);

  // Re-sync when the dialog opens for a (possibly different) client, or when
  // the saved set changes underneath it (e.g. a fresh refetch after save) —
  // same external-reset pattern NegotiatedPriceField already uses above.
  const currentKey = [...currentSlugs].sort().join(",");
  useEffect(() => {
    if (open) setChecked(currentSlugs as ReportSlug[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentKey]);

  const isDirty = !sameSlugSet(checked, currentSlugs);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Reports — {clientName}</DialogTitle>
        </DialogHeader>

        <SubscriptionReportsChecklist enabledSlugs={checked} onChange={setChecked} />

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => onSave(checked)} disabled={!isDirty || saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Phase 5.3.4 — wires SubscriptionReportsDialog's onSave to the actual
// PUT /clients/:id/subscription/reports call via useUpdateSubscriptionReports().
// Kept separate from SubscriptionReportsDialog itself so that component stays
// a plain, network-agnostic props-in/callback-out shell (5.3.3's design);
// this wrapper is what 5.3.5's entry point should actually render.
//
// On success the dialog is left open (per 5.3.4 spec) — an admin adjusting
// reports may want to immediately confirm the checklist reflects what was
// just saved — so there is no onClose() call in the success path here.
export function ConnectedSubscriptionReportsDialog({
  open,
  onClose,
  clientId,
  clientName,
  currentSlugs,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
  currentSlugs: readonly string[];
}) {
  const updateReports = useUpdateSubscriptionReports();

  return (
    <SubscriptionReportsDialog
      open={open}
      onClose={onClose}
      clientName={clientName}
      currentSlugs={currentSlugs}
      saving={updateReports.isPending}
      onSave={(reportSlugs) =>
        updateReports.mutate(
          { clientId, reportSlugs },
          {
            onSuccess: () => toast.success(`Enabled reports updated for "${clientName}"`),
            onError: (err) =>
              toast.error(err instanceof ApiError ? err.message : "Could not update enabled reports"),
          },
        )
      }
    />
  );
}

const KIND_NONE = "__none__";

function KindSelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <Select value={value ?? KIND_NONE} onValueChange={(v) => onChange(v === KIND_NONE ? null : v)}>
      <SelectTrigger
        size="sm"
        className="h-6 gap-1 border-0 bg-transparent px-1 text-[10px] uppercase tracking-wide text-muted-foreground shadow-none hover:text-foreground"
        aria-label="Location kind"
      >
        <SelectValue placeholder="No Label" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={KIND_NONE}>No Label</SelectItem>
        {LOCATION_KINDS.map((k) => (
          <SelectItem key={k} value={k}>
            {LOCATION_KIND_LABELS[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
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
      <div className="flex flex-col gap-2">
        {locations.map((loc) => (
          <span
            key={loc.key}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${
              loc.inactive ? "opacity-50 bg-muted/20" : "bg-muted/40"
            }`}
          >
            <MapPin className="size-3.5 text-muted-foreground shrink-0" />
            <span className="flex-1 min-w-0 truncate">{loc.name}</span>
            {loc.onKindChange && (
              <span className="shrink-0 w-auto">
                <KindSelect value={loc.kind ?? null} onChange={loc.onKindChange} />
              </span>
            )}
            {loc.onModulesChange && loc.modules && loc.moduleCeiling && (
              <LocationModulesPopover
                modules={loc.modules}
                ceiling={loc.moduleCeiling}
                onChange={loc.onModulesChange}
              />
            )}
            {loc.inactive && <span className="text-xs text-muted-foreground shrink-0">(inactive)</span>}
            {loc.onRemove && (
              <button
                type="button"
                onClick={loc.onRemove}
                className="text-muted-foreground hover:text-foreground shrink-0"
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
      {/* At the limit the add control disappeared and `limitMessage` — which the
          callers do pass — was destructured and then never rendered, so the user
          got no input, no button and no reason. Say why, and what to change. */}
      {atLimit && limitMessage && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{limitMessage}</p>
      )}
      {!atLimit && (
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
