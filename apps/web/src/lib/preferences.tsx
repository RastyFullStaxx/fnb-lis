import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { preferredUnitDef, resolveDisplayUnit, type UnitDef, type UnitKind } from "@fnb/core";
import {
  DEFAULT_PREFERENCES,
  useItemDisplayUnits,
  usePreferences,
  useUpdatePreferences,
  type UserPreferences,
} from "@/api/settings";
import { useMe } from "@/api/auth";
import { useCurrentClient } from "@/api/location";

/**
 * App-wide access to the signed-in user's display preferences (font size,
 * unit system). Backed by /api/settings/preferences (per-user, server-side —
 * see routes/settings.ts). Font size is applied to <html data-font-size=…>
 * the moment it loads/changes; index.css scales rem sizing off that attribute,
 * so every component using Tailwind's text-* / spacing utilities scales with it.
 */

interface PreferencesContextValue {
  preferences: UserPreferences;
  setPreferences: (next: UserPreferences) => void;
  isSaving: boolean;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const query = usePreferences(!me.isError);
  const update = useUpdatePreferences();
  const preferences = query.data ?? DEFAULT_PREFERENCES;

  useEffect(() => {
    document.documentElement.setAttribute("data-font-size", preferences.fontSize);
  }, [preferences.fontSize]);

  const setPreferences = (next: UserPreferences) => {
    update.mutate(next);
  };

  return (
    <PreferencesContext.Provider value={{ preferences, setPreferences, isSaving: update.isPending }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferencesContext(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferencesContext must be used within PreferencesProvider");
  return ctx;
}

/** Convenience: just the unit system, for components that only need it. */
export function useUnitSystem(): "metric" | "imperial" {
  return usePreferencesContext().preferences.unitSystem;
}

/** Given the unit system, the natural weigh unit for scale readings. */
export function defaultWeighUnit(unitSystem: "metric" | "imperial"): "g" | "oz" {
  return unitSystem === "imperial" ? "oz" : "g";
}

/**
 * Client req 2026-07-31: the signed-in user's own display unit for a given
 * kind, as a ready UnitDef for `convert()`. Returns null for COUNT (no
 * display preference applies — count items stay raw counts, same as
 * `openEquivalent` treats `contentTracked = false` items) or if the stored
 * preference string is somehow not one of the known units.
 */
export function usePreferredUnit(kind: UnitKind): UnitDef | null {
  const { preferences } = usePreferencesContext();
  if (kind === "COUNT") return null;
  const name = kind === "VOLUME" ? preferences.preferredVolumeUnit : preferences.preferredMassUnit;
  return preferredUnitDef(name);
}

/**
 * Client req 2026-07-31 (docs/per-user-per-item-uom-plan.md): the unit to
 * actually display a quantity in for one item, walking all four resolution
 * levels via resolveDisplayUnit() (@fnb/core) — staff's own override for
 * this item, then the admin's default for this item, then this user's
 * general preferredVolumeUnit/preferredMassUnit, then the item's own unit.
 *
 * This is the piece that was missing: resolveDisplayUnit() existed and was
 * correctly exported, but nothing called it — every screen that renders a
 * quantity (counts/session.tsx, recipes/detail.tsx, recipes/builder.tsx)
 * only ever read level 3 via usePreferredUnit(kind), so a manager's
 * per-item default or a staffer's own per-item override had no effect
 * anywhere they'd actually see a number. This hook is the replacement:
 * pass every itemId a screen will render, get back a lookup function that
 * folds in all four levels for any of them.
 *
 * Batches ALL items in one request (useItemDisplayUnits) rather than one
 * request per row — a count session or recipe can have dozens of lines.
 */
export function useItemDisplayUnit(itemIds: string[]): {
  isPending: boolean;
  resolve: (itemId: string | undefined, itemUnit: UnitDef | null | undefined) => UnitDef | null;
} {
  const client = useCurrentClient();
  const clientId = client?.id ?? "";
  const preferredVolume = usePreferredUnit("VOLUME");
  const preferredMass = usePreferredUnit("MASS");
  const levels = useItemDisplayUnits(clientId, itemIds);

  const resolve = useMemo(() => {
    return (itemId: string | undefined, itemUnit: UnitDef | null | undefined): UnitDef | null => {
      if (!itemUnit) return null;
      const staffPreference = itemUnit.kind === "MASS" ? preferredMass : itemUnit.kind === "VOLUME" ? preferredVolume : null;
      const itemLevels = itemId ? levels.data?.[itemId] : undefined;
      const { unit } = resolveDisplayUnit(
        {
          staffOverride: itemLevels?.staffOverride ?? null,
          adminDefault: itemLevels?.adminDefault ?? null,
          staffPreference: staffPreference?.name ?? null,
        },
        itemUnit.name,
      );
      // resolveDisplayUnit() returns a plain unit name — turn it back into a
      // UnitDef for convert(). A staffOverride/adminDefault of the wrong kind
      // for this item (e.g. "kg" saved before a category change made this a
      // VOLUME item) falls back to the item's own unit rather than throwing
      // in convert()'s kind-mismatch guard.
      const resolved = preferredUnitDef(unit);
      return resolved && resolved.kind === itemUnit.kind ? resolved : itemUnit;
    };
  }, [levels.data, preferredVolume, preferredMass]);

  return { isPending: levels.isPending, resolve };
}
