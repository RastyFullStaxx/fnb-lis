import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CostBasis } from "@fnb/core";
import { api, put } from "./http";

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
}

// "large" (18px) is the starting size per client req #1 — mirrors the server default.
export const DEFAULT_PREFERENCES: UserPreferences = { fontSize: "large", unitSystem: "metric" };

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

export function useUpdateProductTypes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productTypes: string[]) =>
      put<{ productTypes: string[] }>("/api/master/product-types", { productTypes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["productTypes"] }),
  });
}
