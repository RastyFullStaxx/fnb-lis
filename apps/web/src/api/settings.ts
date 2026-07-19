import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
