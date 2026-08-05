import { useEffect, useState } from "react";
import { Download, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  can,
  COST_BASES,
  COST_BASIS_LABELS,
  PIN_LENGTH,
  validatePin,
  type CostBasis,
  type Role,
} from "@fnb/core";
import { useClearDevicePin, useDevicePin, useMe, useSetDevicePin } from "@/api/auth";
import { useAreaMutations, useAreas, useCurrentClient, useLocationId } from "@/api/location";
import { useProductTypes } from "@/api/master";
import {
  useClearItemUnitPreference,
  useCompanyInfo,
  useCostBasis,
  useItemUnitDefault,
  useItemUnitPreference,
  useSetItemUnitDefault,
  useSetItemUnitPreference,
  useUpdateCompanyInfo,
  useUpdateCostBasis,
  useUpdateProductTypes,
  useUpdateVarianceThreshold,
  useVarianceThreshold,
  type CompanyInfo,
  type ItemDisplayUnit,
} from "@/api/settings";
import { usePreferencesContext } from "@/lib/preferences";
import { ApiError } from "@/api/http";
import { PageHeader } from "@/components/page-header";
import { ItemOnlyCombobox } from "@/components/item-only-combobox";
import type { Item } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Same 8-value list the server accepts (itemDisplayUnitBody, routes/settings.ts). */
const ITEM_DISPLAY_UNITS: ItemDisplayUnit[] = ["ml", "L", "fl oz", "gal", "g", "kg", "oz", "lb"];

export function SettingsPage() {
  const me = useMe();
  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;

  return (
    <div>
      <PageHeader title="Settings" />
      {/* Flat sections split by hairlines — one surface, never stacked cards.
          Grouped, because the two halves are not peers: see SettingsGroup. */}
      <div className="space-y-10">
        <SettingsGroup
          title="Your preferences"
          description="Only affect your own account. Nobody else sees a difference."
        >
          <DisplayPreferencesSection />
          <StaffItemUnitSection />
          <DevicePinSection />
        </SettingsGroup>

        <SettingsGroup
          title="Establishment settings"
          description="Shared by everyone at this establishment. Changes here move the figures in reports and exports."
        >
          <CompanySection />
          <CostBasisSection />
          <VarianceThresholdSection />
          {can(role, "master.write") && <AdminItemUnitDefaultSection />}
          {can(role, "master.write") && <StorageAreasSection />}
          {can(role, "master.write") && <CatalogExportSection />}
          {can(role, "admin.manage") && <ProductTypesSection />}
        </SettingsGroup>
      </div>
    </div>
  );
}

/**
 * The two halves of this page, told apart.
 *
 * Seven sections used to run down one hairline-divided list as visual peers,
 * and two of them are not peers with the rest: **Inventory Cost Basis restates
 * every valuation figure** and **Variance Highlight Threshold changes what the
 * Full Audit flags on screen and in every download** — for the whole client.
 * Text Size changes nothing but your own browser. Rendering an accounting
 * policy and a font control identically invites exactly the wrong click.
 *
 * Proximity carries the distinction that identical styling erased, and the
 * subheads say the consequence in words rather than relying on someone
 * inferring it from position. It also chunks seven sections into two groups,
 * which is the difference between scanning a list and reading one.
 *
 * Personal first: far more people change their text size than an establishment's
 * cost basis, and the section that should be reached by accident least often
 * should not be the one nearest the top.
 */
function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
      <div className="mt-5 divide-y border-t pt-1">{children}</div>
    </section>
  );
}

/**
 * Inventory cost basis (client req, 2026-07-20). An accounting policy, not a
 * view toggle: it is saved per client and restates every valuation figure, so
 * changing it is confirmed and written to the activity log.
 */
function CostBasisSection() {
  const client = useCurrentClient();
  const clientId = client?.id ?? "";
  const saved = useCostBasis(clientId);
  const update = useUpdateCostBasis(clientId);
  const me = useMe();
  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;
  const canEdit = can(role, "master.write");

  const current = saved.data?.costBasis ?? "PRICE";

  const change = async (next: CostBasis) => {
    if (next === current) return;
    try {
      await update.mutateAsync(next);
      toast.success(`Cost basis set to ${COST_BASIS_LABELS[next]}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the cost basis");
    }
  };

  return (
    <SettingsSection
      title="Inventory Cost Basis"
      description="Applies to valuation columns only — variance is never affected."
    >
      <div className="max-w-md space-y-2">
        <Label htmlFor="cost-basis">Basis</Label>
        {saved.isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <Select value={current} onValueChange={(v) => void change(v as CostBasis)} disabled={!canEdit || update.isPending}>
            <SelectTrigger id="cost-basis">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COST_BASES.map((b) => (
                <SelectItem key={b} value={b}>
                  {COST_BASIS_LABELS[b]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          {current === "AVERAGE"
            ? "Weighted average: (opening stock value + purchases value) ÷ total units, as of each report's date."
            : "Purchase price: the cost recorded on the count line when the stock was counted."}
        </p>
        {!canEdit && (
          <p className="text-xs text-muted-foreground">Only managers and administrators can change this.</p>
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          Accounting standards expect one basis applied consistently, so this is saved for the whole
          client rather than chosen per download. Exports name the basis in the file and in the header.
        </p>
      </div>
    </SettingsSection>
  );
}

/**
 * Over/short highlight threshold (client req, 2026-07-21). An audit policy
 * saved per establishment — a bar and a fine-dining kitchen tolerate different
 * variance. Presentation only; never touches the reconciliation math.
 */
function VarianceThresholdSection() {
  const client = useCurrentClient();
  const clientId = client?.id ?? "";
  const saved = useVarianceThreshold(clientId);
  const update = useUpdateVarianceThreshold(clientId);
  const me = useMe();
  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;
  const canEdit = can(role, "master.write");

  const [value, setValue] = useState("");
  useEffect(() => {
    if (saved.data) setValue(String(saved.data.varianceThresholdPct));
  }, [saved.data]);

  const parsed = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
  const isDirty = !!saved.data && valid && parsed !== saved.data.varianceThresholdPct;

  const save = async () => {
    if (!valid) return;
    try {
      await update.mutateAsync(parsed);
      toast.success(`Variance highlight threshold set to ${parsed}%`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the threshold");
    }
  };

  return (
    <SettingsSection
      title="Variance Highlight Threshold"
      description="How large an over/short must be, as a percent of usage, before the Full Audit highlights the row — on screen and in every download."
    >
      <div className="max-w-md space-y-2">
        <Label htmlFor="variance-threshold">Threshold</Label>
        {saved.isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <div className="flex items-center gap-2">
            <Input
              id="variance-threshold"
              type="number"
              min={0}
              max={100}
              step={0.5}
              inputMode="decimal"
              className="tnum max-w-[7rem]"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && isDirty && void save()}
              disabled={!canEdit || update.isPending}
            />
            <span className="text-sm text-muted-foreground">%</span>
            <Button onClick={() => void save()} disabled={!canEdit || !isDirty || update.isPending}>
              Save Threshold
            </Button>
          </div>
        )}
        {value.trim() !== "" && !valid && (
          <p className="text-xs text-destructive">Enter a percent between 0 and 100.</p>
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          A material short shows red, an over shows amber. Whole-unit items (e.g. bottles sold whole)
          always highlight when off by a single unit, regardless of this percent. Default is 11%.
        </p>
        {!canEdit && (
          <p className="text-xs text-muted-foreground">Only managers and administrators can change this.</p>
        )}
      </div>
    </SettingsSection>
  );
}

/**
 * The client's own catalog, weights included, as a file. They weigh their own
 * bottles now (client decision 2026-07-25), so this is a copy of THEIR data —
 * handy for a spreadsheet or a backup, not a release of anything.
 */
function CatalogExportSection() {
  const locationId = useLocationId();

  return (
    <SettingsSection
      title="Local Database"
      description="Download this location's catalog — costs, prices, par levels, and the empty (tare) and liquid weights you have recorded."
    >
      <Button variant="outline" size="sm" asChild>
        <a href={`/api/locations/${locationId}/location-items/export`}>
          <Download className="size-4" /> Download catalog (CSV)
        </a>
      </Button>
    </SettingsSection>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-6 first:pt-0 last:pb-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * The PIN a person uses to sign in on the offline desktop, set from the browser
 * because that is where there is a keyboard and a network.
 *
 * Everyone sees this section — a STAFF member is precisely who stands at the bar
 * PC at 2am, so gating it by role would lock out its main audience.
 *
 * It is deliberately NOT presented as "a shorter password". The copy says where
 * it works and where it does not, because a person told to "set a PIN" will
 * otherwise reuse their password digits and assume it protects the same things.
 */
function DevicePinSection() {
  const status = useDevicePin();
  const save = useSetDevicePin();
  const clear = useClearDevicePin();

  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  // Which proof authorises the change: the password normally, the recovery
  // answer when the PIN has been forgotten.
  const [mode, setMode] = useState<"password" | "recovery">("password");
  const [proof, setProof] = useState("");

  const hasPin = status.data?.hasPin ?? false;
  const pinProblem = pin ? validatePin(pin) : null;

  const reset = () => {
    setPin("");
    setConfirm("");
    setQuestion("");
    setAnswer("");
    setProof("");
    setMode("password");
  };

  const submit = async () => {
    if (pinProblem) return toast.error(pinProblem);
    if (pin !== confirm) return toast.error("The two PINs don't match");
    try {
      const res = await save.mutateAsync({
        pin,
        recoveryQuestion: question.trim(),
        recoveryAnswer: answer.trim(),
        ...(mode === "password" ? { currentPassword: proof } : { currentRecoveryAnswer: proof }),
      });
      toast.success(res.via === "recovery" ? "PIN reset — your administrator has been notified" : "Device PIN saved");
      reset();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the PIN");
    }
  };

  const remove = async () => {
    try {
      await clear.mutateAsync();
      toast.success("Device PIN removed — you can no longer sign in offline");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove the PIN");
    }
  };

  return (
    <SettingsSection
      title="Offline desktop PIN"
      description="Signs you in on the bar computer when there's no internet. It works on that computer only — it is not your password, and it can't be used to sign in here."
    >
      {status.isPending ? (
        <Skeleton className="h-9 w-56" />
      ) : (
        <div className="max-w-md space-y-4">
          {hasPin && (
            <div className="flex items-center gap-2">
              <Badge variant="success">PIN set</Badge>
              <span className="text-sm text-muted-foreground">
                Recovery question: “{status.data?.recoveryQuestion}”
              </span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pin-new">{hasPin ? "New PIN" : "PIN"}</Label>
              <Input
                id="pin-new"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="6 digits"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
              />
              {pinProblem && <p className="text-xs text-destructive">{pinProblem}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="pin-confirm">Confirm PIN</Label>
              <Input
                id="pin-confirm"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pin-question">Recovery question</Label>
            <Input
              id="pin-question"
              placeholder="e.g. What was the name of my first bar?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            {/* Write-your-own rather than a canned list: "mother's maiden name"
                is the weakest link in every design that ships one. */}
            <p className="text-xs text-muted-foreground">
              Only used if you forget your PIN with no internet. Pick something nobody at work could guess.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pin-answer">Answer</Label>
            <Input id="pin-answer" autoComplete="off" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pin-proof">
              {mode === "password" ? "Confirm with your password" : "Answer your current recovery question"}
            </Label>
            {mode === "recovery" && status.data?.recoveryQuestion && (
              <p className="text-sm text-muted-foreground">“{status.data.recoveryQuestion}”</p>
            )}
            <Input
              id="pin-proof"
              type="password"
              autoComplete="off"
              value={proof}
              onChange={(e) => setProof(e.target.value)}
            />
            {hasPin && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline underline-offset-2"
                onClick={() => {
                  setMode(mode === "password" ? "recovery" : "password");
                  setProof("");
                }}
              >
                {mode === "password" ? "I forgot my password — use my recovery question" : "Use my password instead"}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={() => void submit()} disabled={save.isPending || !pin || !proof}>
              {hasPin ? "Change PIN" : "Set PIN"}
            </Button>
            {hasPin && (
              <Button variant="ghost" onClick={() => void remove()} disabled={clear.isPending}>
                Remove
              </Button>
            )}
          </div>
        </div>
      )}
    </SettingsSection>
  );
}

function DisplayPreferencesSection() {
  const { preferences, setPreferences, isSaving } = usePreferencesContext();

  return (
    <SettingsSection title="Display">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pref-font-size">Text Size</Label>
          <Select
            value={preferences.fontSize}
            onValueChange={(v) =>
              setPreferences({ ...preferences, fontSize: v as typeof preferences.fontSize })
            }
            disabled={isSaving}
          >
            <SelectTrigger id="pref-font-size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Small</SelectItem>
              <SelectItem value="large">Medium</SelectItem>
              <SelectItem value="x-large">Large</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pref-unit-system">Preferred Unit of Measurement</Label>
          <Select
            value={preferences.unitSystem}
            onValueChange={(v) =>
              setPreferences({ ...preferences, unitSystem: v as typeof preferences.unitSystem })
            }
            disabled={isSaving}
          >
            <SelectTrigger id="pref-unit-system">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="metric">Metric (g / kg)</SelectItem>
              <SelectItem value="imperial">Imperial (oz / lb)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pref-volume-unit">Volume Display Unit</Label>
          <Select
            value={preferences.preferredVolumeUnit}
            onValueChange={(v) =>
              setPreferences({ ...preferences, preferredVolumeUnit: v as typeof preferences.preferredVolumeUnit })
            }
            disabled={isSaving}
          >
            <SelectTrigger id="pref-volume-unit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ml">mL</SelectItem>
              <SelectItem value="L">L</SelectItem>
              <SelectItem value="fl oz">fl oz</SelectItem>
              <SelectItem value="gal">gal</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Only changes how you see it. Storage and calculations keep the item's own unit.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pref-mass-unit">Mass Display Unit</Label>
          <Select
            value={preferences.preferredMassUnit}
            onValueChange={(v) =>
              setPreferences({ ...preferences, preferredMassUnit: v as typeof preferences.preferredMassUnit })
            }
            disabled={isSaving}
          >
            <SelectTrigger id="pref-mass-unit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="g">g</SelectItem>
              <SelectItem value="kg">kg</SelectItem>
              <SelectItem value="oz">oz</SelectItem>
              <SelectItem value="lb">lb</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Only changes how you see it. Storage and calculations keep the item's own unit.
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}

/**
 * Staff's own per-item display-unit overrides (client req 2026-07-31,
 * docs/per-user-per-item-uom-plan.md). Direct sibling of the volume/mass
 * pickers above — same helper-text convention, own choice, requireAuth only.
 * A row here beats the admin default and this user's general
 * preferredVolumeUnit/preferredMassUnit for that one item (see
 * resolveDisplayUnit() in @fnb/core).
 *
 * There's no "list my overrides" endpoint (Phase 3 only ships per-item
 * GET/PUT/DELETE), so this keeps an in-memory list of items the user has
 * chosen to customize this session and fetches/saves each one individually —
 * same shape as the admin default section below.
 */
function StaffItemUnitSection() {
  const [rows, setRows] = useState<Item[]>([]);
  const [picking, setPicking] = useState<Item | null>(null);

  const addRow = (item: Item) => {
    setRows((r) => (r.some((x) => x.id === item.id) ? r : [...r, item]));
    setPicking(null);
  };

  const removeRow = (itemId: string) => setRows((r) => r.filter((x) => x.id !== itemId));

  return (
    <SettingsSection
      title="Per-item display units"
      description="Show a specific item in its own unit, just for you — overrides both your general preference above and any default your manager has set."
    >
      <div className="max-w-md space-y-4">
        {rows.map((item) => (
          <StaffItemUnitRow key={item.id} item={item} onRemove={() => removeRow(item.id)} />
        ))}

        <div className="space-y-2">
          <Label htmlFor="unit-add-item">Add an item</Label>
          <ItemOnlyCombobox
            id="unit-add-item"
            value={picking}
            onSelect={addRow}
            exclude={rows.map((r) => r.id)}
            placeholder="Search items…"
          />
        </div>

        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No items customized yet. Pick one above to set a unit just for you.
          </p>
        )}
      </div>
    </SettingsSection>
  );
}

function StaffItemUnitRow({ item, onRemove }: { item: Item; onRemove: () => void }) {
  const saved = useItemUnitPreference(item.id);
  const set = useSetItemUnitPreference(item.id);
  const clear = useClearItemUnitPreference(item.id);

  const current = saved.data?.unit ?? null;

  const change = async (unit: ItemDisplayUnit) => {
    try {
      await set.mutateAsync(unit);
      toast.success(`${item.name} now shows in ${unit} for you`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save that unit");
    }
  };

  const reset = async () => {
    try {
      await clear.mutateAsync();
      toast.success(`${item.name} reset to your general preference`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not clear that unit");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 truncate text-sm">{item.name}</span>
      {saved.isPending ? (
        <Skeleton className="h-9 w-28" />
      ) : (
        <Select value={current ?? undefined} onValueChange={(v) => void change(v as ItemDisplayUnit)} disabled={set.isPending}>
          <SelectTrigger className="w-28" aria-label={`Display unit for ${item.name}`}>
            <SelectValue placeholder="Default" />
          </SelectTrigger>
          <SelectContent>
            {ITEM_DISPLAY_UNITS.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {current && (
        <Button variant="ghost" size="sm" onClick={() => void reset()} disabled={clear.isPending}>
          Reset
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={onRemove}
        aria-label={`Remove ${item.name} from this list`}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

/**
 * Admin/manager default per-item display unit (client req 2026-07-31,
 * docs/per-user-per-item-uom-plan.md). Same shape as Inventory Cost Basis and
 * Variance Highlight Threshold above it — an establishment policy set once,
 * gated master.write. Applies to every user of this client with no override
 * of their own for that item (see resolveDisplayUnit() in @fnb/core).
 */
function AdminItemUnitDefaultSection() {
  const [rows, setRows] = useState<Item[]>([]);
  const [picking, setPicking] = useState<Item | null>(null);

  const addRow = (item: Item) => {
    setRows((r) => (r.some((x) => x.id === item.id) ? r : [...r, item]));
    setPicking(null);
  };

  const removeRow = (itemId: string) => setRows((r) => r.filter((x) => x.id !== itemId));

  return (
    <SettingsSection
      title="Per-item display unit defaults"
      description="Set the unit an item shows in by default, for everyone at this establishment who hasn't picked their own unit for it."
    >
      <div className="max-w-md space-y-4">
        {rows.map((item) => (
          <AdminItemUnitDefaultRow key={item.id} item={item} onRemove={() => removeRow(item.id)} />
        ))}

        <div className="space-y-2">
          <Label htmlFor="client-unit-add-item">Add an item</Label>
          <ItemOnlyCombobox
            id="client-unit-add-item"
            value={picking}
            onSelect={addRow}
            exclude={rows.map((r) => r.id)}
            placeholder="Search items…"
          />
        </div>

        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No item defaults set yet. Pick one above to set a default unit for everyone.
          </p>
        )}
      </div>
    </SettingsSection>
  );
}

function AdminItemUnitDefaultRow({ item, onRemove }: { item: Item; onRemove: () => void }) {
  const client = useCurrentClient();
  const clientId = client?.id ?? "";
  const saved = useItemUnitDefault(clientId, item.id);
  const set = useSetItemUnitDefault(clientId, item.id);

  const current = saved.data?.unit ?? null;

  const change = async (unit: ItemDisplayUnit) => {
    try {
      await set.mutateAsync(unit);
      toast.success(`Default display unit for ${item.name}: ${unit}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save that default");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 truncate text-sm">{item.name}</span>
      {saved.isPending ? (
        <Skeleton className="h-9 w-28" />
      ) : (
        <Select value={current ?? undefined} onValueChange={(v) => void change(v as ItemDisplayUnit)} disabled={set.isPending}>
          <SelectTrigger className="w-28" aria-label={`Default display unit for ${item.name}`}>
            <SelectValue placeholder="Item's own" />
          </SelectTrigger>
          <SelectContent>
            {ITEM_DISPLAY_UNITS.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={onRemove}
        aria-label={`Remove ${item.name} from this list`}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function CompanySection() {
  const client = useCurrentClient();
  const info = useCompanyInfo(client?.id ?? "");
  const update = useUpdateCompanyInfo(client?.id ?? "");
  const [form, setForm] = useState<CompanyInfo>({
    legalName: "",
    address: "",
    phone: "",
    email: "",
    reportFooter: "",
  });

  useEffect(() => {
    if (info.data) setForm(info.data);
  }, [info.data]);

  const set = (k: keyof CompanyInfo) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Save stays disabled until something actually changed — at most one enabled
  // primary shows on the page at a time.
  const saved = info.data;
  const isDirty = !!saved && (Object.keys(form) as (keyof CompanyInfo)[]).some((k) => form[k] !== saved[k]);

  const save = async () => {
    try {
      await update.mutateAsync(form);
      toast.success("Company info saved — it now brands this client's reports");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save");
    }
  };

  return (
    <SettingsSection
      title="Company Information"
      description="Appears on printed and exported reports."
    >
      {info.isPending ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="legalName">Legal Name</Label>
              <Input id="legalName" value={form.legalName} onChange={set("legalName")} placeholder={client?.name} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={form.phone} onChange={set("phone")} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input id="address" value={form.address} onChange={set("address")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cemail">Email</Label>
            <Input id="cemail" type="email" value={form.email} onChange={set("email")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="footer">Report Footer Note</Label>
            <Textarea
              id="footer"
              rows={2}
              value={form.reportFooter}
              onChange={set("reportFooter")}
              placeholder="e.g. Confidential — prepared for internal audit use."
            />
          </div>
          <Button onClick={save} disabled={update.isPending || !client || !isDirty}>
            Save Company Info
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}

/**
 * Storage areas — the columns on the printed count sheet.
 *
 * Lives under Establishment settings because it changes the paper every
 * counter in the building works from, not one person's screen.
 *
 * Saves per action rather than as a batch with a Save button: each area is an
 * independent row the server already validates on its own, and a half-typed
 * list sitting unsaved while somebody prints the sheet is the failure worth
 * avoiding here.
 */
function StorageAreasSection() {
  const areas = useAreas();
  const { create, archive } = useAreaMutations();
  const [draft, setDraft] = useState("");
  const me = useMe();
  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;
  const canEdit = can(role, "master.write");

  const add = async () => {
    const name = draft.trim();
    if (!name) return;
    try {
      await create.mutateAsync({ name });
      setDraft("");
      toast.success(`Added "${name}"`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add the area");
    }
  };

  const list = areas.data ?? [];

  return (
    <SettingsSection
      title="Storage Areas"
      description="Where stock sits inside this establishment — the bar, the lounge, the stock room. Each one becomes a column on the printed count sheet, and counters tally them separately."
    >
      <div className="max-w-md space-y-3">
        {areas.isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No areas yet. The count sheet prints one tally column, which suits an establishment that
            keeps its stock in one place.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {list.map((a) => (
              <li key={a.id} className="flex items-center gap-2 px-3 py-2">
                <span className="text-sm">{a.name}</span>
                {canEdit && (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => {
                      void archive
                        .mutateAsync(a.id)
                        .then(() => toast.success(`Archived "${a.name}"`))
                        .catch((err) =>
                          toast.error(err instanceof ApiError ? err.message : "Could not archive"),
                        );
                    }}
                  >
                    <X className="size-3.5" />
                    <span className="sr-only">Archive {a.name}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void add())}
              placeholder="Add an area…"
              aria-label="Add a storage area"
              className="max-w-xs"
            />
            <Button size="sm" variant="outline" onClick={() => void add()} disabled={create.isPending}>
              <Plus className="size-4" /> Add
            </Button>
          </div>
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          Archiving keeps every past count intact — an area still names where those bottles were
          counted; it just stops appearing on new sheets.
        </p>
      </div>
    </SettingsSection>
  );
}

function ProductTypesSection() {
  const types = useProductTypes();
  const update = useUpdateProductTypes();
  const [list, setList] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (types.data) setList(types.data.productTypes);
  }, [types.data]);

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (list.some((t) => t.toLowerCase() === v.toLowerCase())) {
      toast.warning(`"${v}" is already in the list`);
      return;
    }
    setList((l) => [...l, v]);
    setDraft("");
  };

  const remove = (t: string) => setList((l) => l.filter((x) => x !== t));

  const savedTypes = types.data?.productTypes;
  const isDirty =
    !!savedTypes && (list.length !== savedTypes.length || list.some((t, i) => t !== savedTypes[i]));

  const save = async () => {
    try {
      await update.mutateAsync(list);
      toast.success("Product types updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save product types");
    }
  };

  return (
    <SettingsSection
      title="Product Types"
      description="Editing here is global across all clients."
    >
      {types.isPending ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-7 w-28" />
          </div>
          <Skeleton className="h-9 w-full max-w-xs" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {list.map((t) => (
              <Badge key={t} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1 text-sm">
                {t}
                <button
                  type="button"
                  onClick={() => remove(t)}
                  className="relative -my-1.5 grid size-6 place-items-center rounded-md before:absolute before:-inset-1.5 hover:bg-background/60"
                  aria-label={`Remove ${t}`}
                >
                  <X className="size-3.5" />
                </button>
              </Badge>
            ))}
            {list.length === 0 && <p className="text-sm text-muted-foreground">No product types yet.</p>}
          </div>
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
              placeholder="Add a product type…"
              // The only input on the page with no visible label — a placeholder
              // is not one, and it disappears the moment anyone types.
              aria-label="Add a product type"
              className="max-w-xs"
            />
            <Button type="button" variant="outline" onClick={add}>
              <Plus className="size-4" /> Add
            </Button>
          </div>
          <Button onClick={save} disabled={update.isPending || !isDirty}>
            Save Product Types
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}
