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

export function useUpdateProductTypes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productTypes: string[]) =>
      put<{ productTypes: string[] }>("/api/master/product-types", { productTypes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["productTypes"] }),
  });
}
