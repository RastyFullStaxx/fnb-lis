import { createContext, useContext, useEffect, type ReactNode } from "react";
import {
  DEFAULT_PREFERENCES,
  usePreferences,
  useUpdatePreferences,
  type UserPreferences,
} from "@/api/settings";
import { useMe } from "@/api/auth";

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
