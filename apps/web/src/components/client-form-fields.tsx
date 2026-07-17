import { AlertCircle, MapPin, Plus, X } from "lucide-react";
import {
  BILLING_CYCLE_SHORT_LABELS,
  INVENTORY_MODULE_LABELS,
  INVENTORY_MODULES,
  PACKAGE_BILLING_CYCLE,
  PACKAGE_LABELS,
  PACKAGE_MAX_ENTITIES,
  PACKAGE_TYPES,
  type InventoryModule,
  type PackageType,
} from "@fnb/core";
import { Button } from "@/components/ui/button";
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
  packageType,
  onPackageTypeChange,
  inventoryModules,
  onInventoryModulesChange,
  packageLocked = false,
  modulesLocked = false,
}: {
  packageType: PackageType;
  onPackageTypeChange: (v: PackageType) => void;
  inventoryModules: InventoryModule;
  onInventoryModulesChange: (v: InventoryModule) => void;
  packageLocked?: boolean;
  modulesLocked?: boolean;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label>Package</Label>
        {packageLocked ? (
          <ReadOnlyField>{PACKAGE_LABELS[packageType] ?? packageType}</ReadOnlyField>
        ) : (
          <Select value={packageType} onValueChange={(v) => onPackageTypeChange(v as PackageType)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PACKAGE_TYPES.map((p) => (
                <SelectItem key={p} value={p}>
                  <span className="font-medium">{PACKAGE_LABELS[p]}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {BILLING_CYCLE_SHORT_LABELS[PACKAGE_BILLING_CYCLE[p]]}
                    {" · "}
                    {PACKAGE_MAX_ENTITIES[p] === 0 ? "Unlimited" : `≤${PACKAGE_MAX_ENTITIES[p]}`}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-2">
        <Label>Inventory modules</Label>
        {modulesLocked ? (
          <ReadOnlyField>
            {INVENTORY_MODULE_LABELS[inventoryModules] ?? inventoryModules}
          </ReadOnlyField>
        ) : (
          <Select
            value={inventoryModules}
            onValueChange={(v) => onInventoryModulesChange(v as InventoryModule)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INVENTORY_MODULES.map((m) => (
                <SelectItem key={m} value={m}>
                  {INVENTORY_MODULE_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </>
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
