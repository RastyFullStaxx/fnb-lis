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
  useClearItemUnitDefault,
  useClearItemUnitPreference,
  useCompanyInfo,
  useCostBasis,
  useIncludeHiddenInReports,
  useItemUnitDefault,
  useItemUnitDefaults,
  useItemUnitPreference,
  useItemUnitPreferences,
  useSetItemUnitDefault,
  useSetItemUnitPreference,
  useUpdateCompanyInfo,
  useUpdateCostBasis,
  useUpdateIncludeHiddenInReports,
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
import { Switch } from "@/components/ui/switch";
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
  DialogTrigger,
} from "@/components/ui/dialog";

/** Same 8-value list the server accepts (itemDisplayUnitBody, routes/settings.ts). */
const ITEM_DISPLAY_UNITS: ItemDisplayUnit[] = ["ml", "L", "fl oz", "gal", "g", "kg", "oz", "lb"];

export function SettingsPage() {
  const me = useMe();
  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;

  return (
    <div>
      <PageHeader title="Settings" />
      {/* Flat sections split by hairlines, one surface, never stacked cards.
          Grouped, because the three tiers are not peers: see SettingsGroup. */}
      <div className="space-y-16">
        <SettingsGroup
          title="Your preferences"
          description="Only affect your own account. Nobody else sees a difference."
        >
          <DisplayPreferencesSection />
          <DevicePinSection />
        </SettingsGroup>

        <SettingsGroup
          title="Units"
          description="How quantities are displayed, from most specific to most general."
        >
          {can(role, "master.write") && <AdminItemUnitDefaultSection />}
          <StaffItemUnitSection />
          <StaffDefaultUnitSection />
        </SettingsGroup>

        <SettingsGroup
          title="Establishment settings"
          description="Shared by everyone at this establishment. Changes here move the figures in reports and exports."
        >
          <CostBasisSection />
          <VarianceThresholdSection />
          <IncludeHiddenInReportsSection />
          {/* Unlike Cost Basis / Variance Threshold above, this section never
              had a read-only mode — its GET is `master.write`-gated
              server-side too (routes/settings.ts `/company`), so a non-write
              role can't even load the data, let alone save it. Now that the
              Settings nav/route is open to every role (see lib/nav.ts), this
              has to move behind the same `can()` check as its establishment-
              admin siblings below instead of rendering unconditionally and
              hitting a 403 on load. */}
          {can(role, "master.write") && <CompanySection />}
          {can(role, "master.write") && <StorageAreasSection />}
          {can(role, "master.write") && <CatalogExportSection />}
          {can(role, "admin.manage") && <ProductTypesSection />}
        </SettingsGroup>
      </div>
    </div>
  );
}

/**
 * The three tiers of this page, told apart.
 *
 * Started as seven sections running down one hairline-divided list as visual
 * peers, which flattened distinctions that matter: **Inventory Cost Basis
 * restates every valuation figure**, **Variance Highlight Threshold changes
 * what the Full Audit flags on screen and in every download**, and — the
 * case that prompted this split — three separately-named "display unit"
 * settings (personal, personal per-item, establishment per-item) were spread
 * across two of those groups, so their precedence over one another had to be
 * inferred from paragraph text instead of position. Rendering an accounting
 * policy, a font control, and a three-level unit hierarchy identically
 * invites exactly the wrong click, or the wrong question about which setting
 * does what.
 *
 * Proximity now carries what identical styling erased: **Your preferences**
 * (personal, no one else affected), **Units** (a hybrid tier — mostly
 * personal, with one admin-gated establishment-wide row, kept together
 * because it's one hierarchy the eye should read as one ladder rather than
 * split by who each row affects), and **Establishment settings** (shared,
 * moves the figures in reports).
 *
 * Personal first: far more people change their text size than an
 * establishment's cost basis, and the section that should be reached by
 * accident least often should not be the one nearest the top. Units sits
 * between the two — it has both personal and shared rows — rather than
 * forcing it into one side or the other.
 */
function SettingsGroup({
  title,
  description,
  children,
  divider = false,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  /** Hairline above the group, marking a new tier rather than relying on
   * whitespace alone. Omitted on the first group, PageHeader already
   * separates it from the page title above. */
  divider?: boolean;
}) {
  return (
    <section className={divider ? "border-t pt-16" : undefined}>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-5 space-y-6 border-t pt-5">{children}</div>
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
      description="Applies to valuation columns only, variance is never affected."
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
          client rather than chosen per download.
        </p>
      </div>
    </SettingsSection>
  );
}

/**
 * Over/short highlight threshold (client req, 2026-07-21). An audit policy
 * saved per establishment, a bar and a fine-dining kitchen tolerate different
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
      description="How large an over/short must be, as a percent of usage, before the Full Audit highlights the row, on screen and in every download."
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
          A material short shows red, an over shows amber. Whole-unit items always highlight when off
          by a single unit, regardless of this percent. Default is 11%.
        </p>
        {!canEdit && (
          <p className="text-xs text-muted-foreground">Only managers and administrators can change this.</p>
        )}
      </div>
    </SettingsSection>
  );
}

/**
 * Include hidden items in reports (docs/clutter-in-reports-decision.md).
 * An audit-visibility policy saved per establishment, same tier as Cost
 * Basis and Variance Highlight Threshold above: whether a report row set
 * differs by who's viewing would let two people read different totals for
 * the same report, so this is a client-level setting, not a per-visit
 * toggle. Presentation only — Grand Total never moves either way, only
 * which rows are listed on the way to it.
 */
function IncludeHiddenInReportsSection() {
  const client = useCurrentClient();
  const clientId = client?.id ?? "";
  const saved = useIncludeHiddenInReports(clientId);
  const update = useUpdateIncludeHiddenInReports(clientId);
  const me = useMe();
  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;
  const canEdit = can(role, "master.write");

  const current = saved.data?.includeHiddenInReports ?? false;

  const change = async (next: boolean) => {
    try {
      await update.mutateAsync(next);
      toast.success(next ? "Hidden items will now show in reports" : "Hidden items are hidden from reports again");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save this setting");
    }
  };

  return (
    <SettingsSection
      title="Include Hidden Items In Reports"
      description="An item hidden from Local Database also drops off reports. Turn this on to show them anyway."
    >
      <div className="max-w-md space-y-2">
        {saved.isPending ? (
          <Skeleton className="h-9 w-16" />
        ) : (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="text-sm">Show hidden items in reports</div>
            <Switch
              checked={current}
              disabled={!canEdit || update.isPending}
              onCheckedChange={(v) => void change(v)}
            />
          </div>
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          A hidden item with real activity in the period still shows, badged{" "}
          <span className="whitespace-nowrap">"hidden · active"</span>. Only idle hidden items are
          affected.
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
 * bottles now (client decision 2026-07-25), so this is a copy of THEIR data,
 * handy for a spreadsheet or a backup, not a release of anything.
 */
function CatalogExportSection() {
  const locationId = useLocationId();

  return (
    <SettingsSection
      title="Local Database"
      description="Download this location's catalog: costs, prices, par levels, and the empty (tare) and liquid weights you have recorded."
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
    <section>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description ? (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * The PIN a person uses to sign in on the offline desktop, set from the browser
 * because that is where there is a keyboard and a network.
 *
 * Everyone sees this section, a STAFF member is precisely who stands at the bar
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

  // The form itself only exists inside the modal now; this is just whether
  // that modal is open.
  const [open, setOpen] = useState(false);

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
      toast.success(res.via === "recovery" ? "PIN reset, your administrator has been notified" : "Device PIN saved");
      reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the PIN");
    }
  };

  const remove = async () => {
    try {
      await clear.mutateAsync();
      toast.success("Device PIN removed, you can no longer sign in offline");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove the PIN");
    }
  };

  return (
    <SettingsSection
      title="Offline desktop PIN"
      description="Signs you in on the bar computer when there's no internet. It works on that computer only, it is not your password, and it can't be used to sign in here."
    >
      {status.isPending ? (
        <Skeleton className="h-9 w-56" />
      ) : (
        <div className="flex items-center gap-3">
          {hasPin && (
            <div className="flex items-center gap-2">
              <Badge variant="success">PIN set</Badge>
              <span className="text-sm text-muted-foreground">
                Recovery question: “{status.data?.recoveryQuestion}”
              </span>
            </div>
          )}

          <Dialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) reset();
            }}
          >
            <DialogTrigger asChild>
              <Button variant={hasPin ? "outline" : "default"}>{hasPin ? "Change PIN" : "Set PIN"}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{hasPin ? "Change offline desktop PIN" : "Set offline desktop PIN"}</DialogTitle>
                <DialogDescription>
                  Signs you in on the bar computer when there's no internet. It works on that computer only, it is
                  not your password, and it can't be used to sign in here.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pin-new">{hasPin ? "New PIN" : "PIN"}</Label>
                    <Input
                      id="pin-new"
                      name="fnb-device-pin-new"
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
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
                      name="fnb-device-pin-confirm"
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pin-question">Recovery question</Label>
                  <Input
                    id="pin-question"
                    name="fnb-device-pin-question"
                    autoComplete="off"
                    autoCorrect="off"
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
                  <Input
                    id="pin-answer"
                    name="fnb-device-pin-answer"
                    autoComplete="off"
                    autoCorrect="off"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                  />
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
                    name="fnb-device-pin-proof"
                    type="password"
                    autoComplete="new-password"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
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
                      {mode === "password"
                        ? "I forgot my password, use my recovery question"
                        : "Use my password instead"}
                    </button>
                  )}
                </div>
              </div>

              <DialogFooter className="sm:justify-between">
                {hasPin ? (
                  <Button variant="ghost" onClick={() => void remove()} disabled={clear.isPending}>
                    Remove
                  </Button>
                ) : (
                  <span />
                )}
                <Button onClick={() => void submit()} disabled={save.isPending || !pin || !proof}>
                  {hasPin ? "Change PIN" : "Set PIN"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
          <Label htmlFor="pref-unit-system">Scale Reading Unit</Label>
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
              <SelectItem value="metric">Metric (g)</SelectItem>
              <SelectItem value="imperial">Imperial (oz)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Starting unit when weighing an item on a scale. Separate from how quantities are
            displayed elsewhere, see "Units" below.
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}

/**
 * Your general fallback unit for volume/mass quantities (client req
 * 2026-07-31). Bottom rung of the "Units" ladder — applies to every item you
 * haven't set a personal override for, and is itself overridden by an
 * establishment item default. Was previously two of four fields inside
 * "Display" under "Your preferences," sharing a section with Text Size and a
 * separately-named "Preferred Unit of Measurement" metric/imperial toggle;
 * moved into its own "Units" group, alongside the item-level sections it has
 * a precedence relationship with, so the three no longer read as unrelated
 * settings that each happen to say "display unit."
 */
function StaffDefaultUnitSection() {
  const { preferences, setPreferences, isSaving } = usePreferencesContext();

  return (
    <SettingsSection
      title="Your default unit"
      description="Falls back to this unless a more specific unit is set below. Only changes your view; storage and calculations keep the item's own unit."
    >
      <div className="grid gap-4 sm:grid-cols-2 max-w-md">
        <div className="space-y-2">
          <Label htmlFor="pref-volume-unit">Volume</Label>
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
        </div>
        <div className="space-y-2">
          <Label htmlFor="pref-mass-unit">Mass</Label>
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
        </div>
      </div>
    </SettingsSection>
  );
}

/**
 * Staff's own per-item display-unit overrides (client req 2026-07-31,
 * docs/per-user-per-item-uom-plan.md). Second rung of the "Units" group,
 * between the establishment default above it and this user's general
 * default unit below it — a row here beats both for that one item (see
 * resolveDisplayUnit() in @fnb/core).
 *
 * Formerly "Per-item display units," living in "Your preferences" while its
 * establishment-wide counterpart lived across the page in "Establishment
 * settings" — same underlying concept, split by who it affects rather than
 * grouped by what it does. Renamed and moved next to that counterpart (see
 * the "Units" SettingsGroup in SettingsPage) so the three-level precedence
 * — establishment default → your item override → your general default —
 * reads as one ladder instead of three separately-named settings.
 *
 * Seeded from GET /item-unit-preferences (the "list mine" endpoint) so the
 * list survives navigating away and back, previously this only tracked
 * items added during the current visit, so the saved override kept working
 * everywhere else in the app while this list itself looked empty again.
 * Freshly-picked items not yet saved are kept in local state alongside the
 * server rows until the query refetches with them included.
 */
/** The id/name pair these two sections actually traffic in — both the
 *  server list endpoints (/item-unit-preferences, /item-unit-defaults) and
 *  the row components below only ever need this much, not a full Item. */
type ItemRef = { id: string; name: string };

function StaffItemUnitSection() {
  const saved = useItemUnitPreferences();
  const [localRows, setLocalRows] = useState<ItemRef[]>([]);
  const [picking, setPicking] = useState<Item | null>(null);

  const savedRows: ItemRef[] = (saved.data ?? []).map((r) => ({ id: r.itemId, name: r.itemName }));
  const savedIds = new Set(savedRows.map((r) => r.id));
  // Local-only rows are for an item just picked this visit, before its first
  // save lands in the server list above, once it does, drop the local copy
  // so a saved item is never shown twice.
  const rows = [...savedRows, ...localRows.filter((r) => !savedIds.has(r.id))];

  const addRow = (item: Item) => {
    setLocalRows((r) => (r.some((x) => x.id === item.id) || savedIds.has(item.id) ? r : [...r, { id: item.id, name: item.name }]));
    setPicking(null);
  };

  const removeRow = (itemId: string) => setLocalRows((r) => r.filter((x) => x.id !== itemId));

  return (
    <SettingsSection
      title="Your item overrides"
      description="Show specific items in a unit just for you, regardless of your default unit or the establishment default."
    >
      <div className="max-w-md space-y-4">
        {saved.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          rows.map((item) => <StaffItemUnitRow key={item.id} item={item} onRemove={() => removeRow(item.id)} />)
        )}

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
      </div>
    </SettingsSection>
  );
}

function StaffItemUnitRow({ item, onRemove }: { item: ItemRef; onRemove: () => void }) {
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

  // The X button used to only drop the row from local state, harmless when
  // the list was local-only, but now the list is seeded from the server this
  // row would just reappear on the next refetch if a saved unit were left in
  // place underneath it. Clear it first so removing a row actually removes
  // the override, same outcome as clicking Reset first and then removing.
  const removeRow = async () => {
    if (current) {
      try {
        await clear.mutateAsync();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Could not clear that unit");
        return;
      }
    }
    onRemove();
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
        onClick={() => void removeRow()}
        disabled={clear.isPending}
        aria-label={`Remove ${item.name} from this list`}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

/**
 * Admin/manager default per-item display unit (client req 2026-07-31,
 * docs/per-user-per-item-uom-plan.md). Most-specific rung of the "Units"
 * group's precedence ladder — placed first because it's the first thing
 * beaten by anything below it (a staff item override, then a staff general
 * default). Applies to every user of this client with no override of their
 * own for that item (see resolveDisplayUnit() in @fnb/core).
 *
 * Formerly "Per-item display unit defaults," living in "Establishment
 * settings" — correctly gated master.write, but physically separated from
 * its personal counterparts by Cost Basis and Variance Threshold, which made
 * the shared "display unit" naming across all three read as coincidence
 * rather than a stated hierarchy. Still master.write-gated (this changes
 * what everyone sees), just grouped by topic now — see the "Units"
 * SettingsGroup in SettingsPage, whose description notes the admin-only row.
 */
/**
 * Seeded from GET /item-unit-defaults, same fix and same reason as
 * StaffItemUnitSection above, this list previously only tracked items
 * added during the current visit, so it reset to empty on navigation while
 * each saved default kept applying underneath it.
 */
function AdminItemUnitDefaultSection() {
  const client = useCurrentClient();
  const clientId = client?.id ?? "";
  const saved = useItemUnitDefaults(clientId);
  const [localRows, setLocalRows] = useState<ItemRef[]>([]);
  const [picking, setPicking] = useState<Item | null>(null);

  const savedRows: ItemRef[] = (saved.data ?? []).map((r) => ({ id: r.itemId, name: r.itemName }));
  const savedIds = new Set(savedRows.map((r) => r.id));
  const rows = [...savedRows, ...localRows.filter((r) => !savedIds.has(r.id))];

  const addRow = (item: Item) => {
    setLocalRows((r) => (r.some((x) => x.id === item.id) || savedIds.has(item.id) ? r : [...r, { id: item.id, name: item.name }]));
    setPicking(null);
  };

  const removeRow = (itemId: string) => setLocalRows((r) => r.filter((x) => x.id !== itemId));

  return (
    <SettingsSection
      title="Establishment item defaults"
      description="Sets the unit specific items show in for everyone here, unless a staff member has set their own override below."
    >
      <div className="max-w-md space-y-4">
        {saved.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          rows.map((item) => (
            <AdminItemUnitDefaultRow key={item.id} item={item} onRemove={() => removeRow(item.id)} />
          ))
        )}

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
      </div>
    </SettingsSection>
  );
}

function AdminItemUnitDefaultRow({ item, onRemove }: { item: ItemRef; onRemove: () => void }) {
  const client = useCurrentClient();
  const clientId = client?.id ?? "";
  const saved = useItemUnitDefault(clientId, item.id);
  const set = useSetItemUnitDefault(clientId, item.id);
  const clear = useClearItemUnitDefault(clientId, item.id);

  const current = saved.data?.unit ?? null;

  const change = async (unit: ItemDisplayUnit) => {
    try {
      await set.mutateAsync(unit);
      toast.success(`Default display unit for ${item.name}: ${unit}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save that default");
    }
  };

  const reset = async () => {
    try {
      await clear.mutateAsync();
      toast.success(`${item.name} reset to item's own unit`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not clear that default");
    }
  };

  // Same fix as StaffItemUnitRow's removeRow above, for the same reason:
  // this list is seeded from the server (useItemUnitDefaults), so removing
  // only the local row leaves the saved ClientItemUnitDefault in place
  // underneath it and the row just comes back on the next refetch. Clear the
  // saved default first, then drop the row.
  const removeRow = async () => {
    if (current) {
      try {
        await clear.mutateAsync();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Could not clear that default");
        return;
      }
    }
    onRemove();
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
      {current && (
        <Button variant="ghost" size="sm" onClick={() => void reset()} disabled={clear.isPending}>
          Reset
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={() => void removeRow()}
        disabled={clear.isPending}
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

  // Save stays disabled until something actually changed, at most one enabled
  // primary shows on the page at a time.
  const saved = info.data;
  const isDirty = !!saved && (Object.keys(form) as (keyof CompanyInfo)[]).some((k) => form[k] !== saved[k]);

  const save = async () => {
    try {
      await update.mutateAsync(form);
      toast.success("Company info saved, it now brands this client's reports");
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
              placeholder="e.g. Confidential, prepared for internal audit use."
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
 * Storage areas: the columns on the printed count sheet.
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
      description="Where stock sits inside this establishment. Each one becomes a column on the printed count sheet, and counters tally them separately."
    >
      <div className="max-w-md space-y-3">
        {areas.isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : list.length === 0 ? null : (
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
          Archiving keeps every past count intact, an area still names where those bottles were
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
              // The only input on the page with no visible label, a placeholder
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
