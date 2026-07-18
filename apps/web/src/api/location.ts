import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import type { LocationItemAttach, LocationItemUpdate, MeClient, SupplierUpsert } from "@fnb/core";
import { api, post, put } from "./http";
import { useMe } from "./auth";
import type { AvailableVariant, LocationItem, Supplier } from "./types";

/** The active location id from the /l/:locationId/* route. */
export function useLocationId(): string {
  const { locationId } = useParams();
  return locationId!;
}

/** The client that owns the active location (from the cached /me payload). */
export function useCurrentClient(): (MeClient & { locationName?: string }) | undefined {
  const me = useMe();
  const locationId = useLocationId();
  return me.data?.clients.find((c) => c.locations.some((l) => l.id === locationId));
}

/**
 * The active location itself (from the cached /me payload) — use this, not
 * the client's subscription, when you need the modules that actually gate
 * this location's catalog (Fix Plan §2.3: the location's own set is the
 * enforced reality, the client's subscription is just the ceiling).
 */
export function useCurrentLocation() {
  const me = useMe();
  const locationId = useLocationId();
  return me.data?.clients.flatMap((c) => c.locations).find((l) => l.id === locationId);
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

/**
 * Master variants not yet in this location's catalog. The server already
 * restricts results to THIS LOCATION's own modules (Fix Plan §2.3) — this
 * hook doesn't need to (and can't) work around that; productType here is
 * just an additional narrowing within whatever the location's modules allow.
 */
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
      post<{ copied: number; skipped: number; skippedByModule: number }>(
        `${base(locationId)}/copy-from/${sourceLocationId}`,
      ),
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
