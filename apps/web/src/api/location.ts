import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import type { LocationItemAttach, LocationItemUpdate, SupplierUpsert } from "@fnb/core";
import { api, post, put } from "./http";
import type { AvailableVariant, LocationItem, Supplier } from "./types";

/** The active location id from the /l/:locationId/* route. */
export function useLocationId(): string {
  const { locationId } = useParams();
  return locationId!;
}

const base = (locationId: string) => `/api/locations/${locationId}`;

export function useLocationItems(filters: { search?: string; missingPrices?: boolean } = {}) {
  const locationId = useLocationId();
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.missingPrices) params.set("missingPrices", "1");
  return useQuery({
    queryKey: ["locationItems", locationId, filters],
    queryFn: () => api<LocationItem[]>(`${base(locationId)}/location-items?${params}`),
  });
}

export function useAvailableVariants(filters: { search?: string; productType?: string }, enabled = true) {
  const locationId = useLocationId();
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.productType) params.set("productType", filters.productType);
  return useQuery({
    queryKey: ["availableVariants", locationId, filters],
    queryFn: () => api<AvailableVariant[]>(`${base(locationId)}/available-variants?${params}`),
    enabled,
  });
}

export function useAttachLocationItem() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LocationItemAttach) => post<LocationItem>(`${base(locationId)}/location-items`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["locationItems", locationId] });
      qc.invalidateQueries({ queryKey: ["availableVariants", locationId] });
    },
  });
}

export function useUpdateLocationItem() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: LocationItemUpdate & { id: string }) =>
      put<LocationItem>(`${base(locationId)}/location-items/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["locationItems", locationId] }),
  });
}

export function useCopyFromLocation() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceLocationId: string) =>
      post<{ copied: number; skipped: number }>(`${base(locationId)}/copy-from/${sourceLocationId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["locationItems", locationId] }),
  });
}

export function useSuppliers() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["suppliers", locationId],
    queryFn: () => api<Supplier[]>(`${base(locationId)}/suppliers`),
  });
}

export function useCreateSupplier() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SupplierUpsert) => post<Supplier>(`${base(locationId)}/suppliers`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers", locationId] }),
  });
}

export function useUpdateSupplier() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<SupplierUpsert> & { id: string }) =>
      put<Supplier>(`${base(locationId)}/suppliers/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers", locationId] }),
  });
}
