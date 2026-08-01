import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CostBasis } from "@fnb/core";
import { api, del, put } from "./http";

export interface CompanyInfo {
  legalName: string;
  address: string;
  phone: string;
  email: string;
  reportFooter: string;
}

export function useCompanyInfo(clientId: string) {
  return useQuery({
    queryKey: ["settings", "company", clientId],
    queryFn: () => api<CompanyInfo>(`/api/settings/company?clientId=${clientId}`),
    enabled: Boolean(clientId),
  });
}

export function useUpdateCompanyInfo(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CompanyInfo) => put<CompanyInfo>(`/api/settings/company?clientId=${clientId}`, body),
    onSuccess: (data) => qc.setQueryData(["settings", "company", clientId], data),
  });
}

/**
 * Inventory cost basis — an accounting policy stored per client, applied to
 * valuation reports only (see @fnb/core COST_BASES). Changing it restates
 * every stock-value figure, so it lives in Settings, not on a report toolbar.
 */
export function useCostBasis(clientId: string) {
  return useQuery({
    queryKey: ["settings", "cost-basis", clientId],
    queryFn: () => api<{ costBasis: CostBasis }>(`/api/settings/cost-basis?clientId=${clientId}`),
    enabled: Boolean(clientId),
  });
}

export function useUpdateCostBasis(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (costBasis: CostBasis) =>
      put<{ costBasis: CostBasis }>(`/api/settings/cost-basis?clientId=${clientId}`, { costBasis }),
    onSuccess: (data) => {
      qc.setQueryData(["settings", "cost-basis", clientId], data);
      // Every valuation figure on screen just changed.
      void qc.invalidateQueries({ queryKey: ["report"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-trends"] });
    },
  });
}

/**
 * Over/short highlight threshold (%) — an audit policy saved per establishment
 * (client req 2026-07-21). Read by the Full Audit to decide which rows light
 * up; writing is restricted to managers/admins. Presentation only.
 */
export function useVarianceThreshold(clientId: string) {
  return useQuery({
    queryKey: ["settings", "variance-threshold", clientId],
    queryFn: () =>
      api<{ varianceThresholdPct: number }>(`/api/settings/variance-threshold?clientId=${clientId}`),
    enabled: Boolean(clientId),
  });
}

export function useUpdateVarianceThreshold(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (varianceThresholdPct: number) =>
      put<{ varianceThresholdPct: number }>(`/api/settings/variance-threshold?clientId=${clientId}`, {
        varianceThresholdPct,
      }),
    onSuccess: (data) =>
      qc.setQueryData(["settings", "variance-threshold", clientId], data),
  });
}

export interface UserPreferences {
  fontSize: "default" | "large" | "x-large";
  unitSystem: "metric" | "imperial";
  /**
   * Client req 2026-07-31: per-user display unit, independent of anyone
   * else's. Mirrors the server's userPreferences (routes/settings.ts).
   * Values match the units already seeded in seed.ts.
   */
  preferredVolumeUnit: "ml" | "L" | "fl oz" | "gal";
  preferredMassUnit: "g" | "kg" | "oz" | "lb";
  /**
   * Phase 46.4.2: ISO timestamp of this user's last Activity page visit.
   * Optional — undefined until they've opened Activity at least once since
   * this field shipped. Written from apps/web/src/pages/admin/activity.tsx
   * by reading the full object out of usePreferencesContext() and writing
   * it back with only this field changed, the same pattern settings.tsx
   * already uses for fontSize/unitSystem — PUT /settings/preferences
   * replaces the whole row, there is no partial-update path.
   */
  activityViewedAt?: string;
}

// "large" (18px) is the starting size per client req #1 — mirrors the server default.
export const DEFAULT_PREFERENCES: UserPreferences = {
  fontSize: "large",
  unitSystem: "metric",
  preferredVolumeUnit: "ml",
  preferredMassUnit: "g",
};

export function usePreferences(enabled = true) {
  return useQuery({
    queryKey: ["settings", "preferences"],
    queryFn: () => api<UserPreferences>("/api/settings/preferences"),
    staleTime: 5 * 60 * 1000,
    enabled,
    retry: false,
  });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UserPreferences) => put<UserPreferences>("/api/settings/preferences", body),
    onSuccess: (data) => qc.setQueryData(["settings", "preferences"], data),
  });
}

/**
 * Per-item display unit (client req 2026-07-31, docs/per-user-per-item-uom-plan.md).
 * Same 8-value list as preferredVolumeUnit/preferredMassUnit, not split by kind — a
 * single per-item field can hold either a VOLUME or MASS unit depending on the item.
 * Mirrors itemDisplayUnitBody in apps/server/src/routes/settings.ts.
 */
export type ItemDisplayUnit = "ml" | "L" | "fl oz" | "gal" | "g" | "kg" | "oz" | "lb";

/**
 * Staff's own override for one item — requireAuth only, no permission needed
 * (own choice, affects nobody else). Resolver order: this beats the admin
 * default, which beats the staff's general preferredVolumeUnit/preferredMassUnit.
 */
export function useItemUnitPreference(itemId: string) {
  return useQuery({
    queryKey: ["settings", "item-unit-preference", itemId],
    queryFn: () => api<{ unit: ItemDisplayUnit | null }>(`/api/settings/item-unit-preference/${itemId}`),
    enabled: Boolean(itemId),
  });
}

export function useSetItemUnitPreference(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (unit: ItemDisplayUnit) =>
      put<{ unit: ItemDisplayUnit }>(`/api/settings/item-unit-preference/${itemId}`, { unit }),
    onSuccess: (data) => qc.setQueryData(["settings", "item-unit-preference", itemId], data),
  });
}

export function useClearItemUnitPreference(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => del<{ ok: true }>(`/api/settings/item-unit-preference/${itemId}`),
    onSuccess: () => qc.setQueryData(["settings", "item-unit-preference", itemId], { unit: null }),
  });
}

/**
 * Admin/manager default for one item — gated master.write, applies to every
 * user of this client who has no UserItemUnitPreference of their own for the
 * same item. Same tier as cost-basis / variance-threshold above.
 */
export function useItemUnitDefault(clientId: string, itemId: string) {
  return useQuery({
    queryKey: ["settings", "item-unit-default", clientId, itemId],
    queryFn: () =>
      api<{ unit: ItemDisplayUnit | null }>(
        `/api/settings/item-unit-default/${itemId}?clientId=${clientId}`,
      ),
    enabled: Boolean(clientId) && Boolean(itemId),
  });
}

export function useSetItemUnitDefault(clientId: string, itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (unit: ItemDisplayUnit) =>
      put<{ unit: ItemDisplayUnit }>(
        `/api/settings/item-unit-default/${itemId}?clientId=${clientId}`,
        { unit },
      ),
    onSuccess: (data) => qc.setQueryData(["settings", "item-unit-default", clientId, itemId], data),
  });
}

/**
 * Batch resolve — levels 1 & 2 (staff override, admin default) for many
 * items in one request (client req 2026-07-31, docs/per-user-per-item-uom-plan.md).
 * Every screen that actually renders quantities for a page of items (count
 * session, recipe builder/detail) needs this, not the one-item-at-a-time
 * GETs above, which exist for the Settings page's own list. Levels 3/4
 * (general preferredVolumeUnit/preferredMassUnit, item's own unit) are
 * folded in by the caller via resolveDisplayUnit() (@fnb/core), because that
 * step needs each item variant's unit KIND, which the caller already has
 * loaded locally.
 */
export interface ItemDisplayUnitLevels {
  staffOverride: ItemDisplayUnit | null;
  adminDefault: ItemDisplayUnit | null;
}

export function useItemDisplayUnits(clientId: string, itemIds: string[]) {
  // Stable, order-independent key so adding/removing lines in a different
  // order (or re-rendering with the same set) doesn't refetch unnecessarily.
  const sortedIds = [...new Set(itemIds)].sort();
  return useQuery({
    queryKey: ["settings", "item-display-units", clientId, sortedIds],
    queryFn: () =>
      api<Record<string, ItemDisplayUnitLevels>>(
        `/api/settings/item-display-units?clientId=${clientId}&itemIds=${sortedIds.join(",")}`,
      ),
    enabled: Boolean(clientId) && sortedIds.length > 0,
  });
}

export function useUpdateProductTypes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productTypes: string[]) =>
      put<{ productTypes: string[] }>("/api/master/product-types", { productTypes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["productTypes"] }),
  });
}

