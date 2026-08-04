import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import type { LocationItemAttach, LocationItemUpdate, MeClient, SupplierUpsert } from "@fnb/core";
import { api, del, post, put } from "./http";
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
 * Trailing average of an item's recent weigh counts at this location — feeds
 * the live weigh preview's history-based outlier check
 * (docs/2026-08-01-weight-outlier-warning-plan.md, phases doc Phase 3/4).
 * `null` while disabled or before an item is picked, matching the server's
 * "no history yet" silence rather than showing a stale number.
 */
export function useTrailingAverage(locationItemId: string | null) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["trailingAverage", locationId, locationItemId],
    queryFn: () =>
      api<{ trailingAverage: number | null }>(`${base(locationId)}/location-items/${locationItemId}/trailing-average`),
    enabled: locationItemId != null,
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["locationItems", locationId] });
      // Saving a weight can clear a "Needs weight" item off the bell.
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
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

/**
 * Storage areas within this location — the columns on the paper count sheet.
 *
 * A location with none behaves exactly as before: pickers stay hidden, the
 * sheet keeps its single tally column, and every count line carries a null
 * area. Nothing here needs a feature flag for that reason.
 */
export interface LocationArea {
  id: string;
  locationId: string;
  name: string;
  sortOrder: number;
  status: string;
}

export function useAreas() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["areas", locationId],
    queryFn: () => api<LocationArea[]>(`${base(locationId)}/areas`),
    enabled: Boolean(locationId),
  });
}

export function useAreaMutations() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  const done = { onSuccess: () => qc.invalidateQueries({ queryKey: ["areas", locationId] }) };
  return {
    create: useMutation({
      mutationFn: (body: { name: string; sortOrder?: number }) =>
        post<LocationArea>(`${base(locationId)}/areas`, body),
      ...done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; name: string; sortOrder?: number }) =>
        put<LocationArea>(`${base(locationId)}/areas/${id}`, body),
      ...done,
    }),
    archive: useMutation({
      mutationFn: (id: string) => del<{ ok: true }>(`${base(locationId)}/areas/${id}`),
      ...done,
    }),
  };
}

/**
 * Bottle Keep — bottles a customer paid for and left to finish next visit.
 *
 * `dueForForfeit` and `daysLeft` are computed server-side against today, never
 * stored: "is it overdue" is a fact about the current date, and a stored flag
 * is wrong every morning until something rewrites it.
 */
export interface BottleKeep {
  id: string;
  customerName: string;
  customerContact: string | null;
  qty: number;
  remainingContent: number;
  keptDate: string;
  expiresOn: string;
  status: "ACTIVE" | "CLAIMED" | "FORFEITED" | "VOID";
  note: string | null;
  dueForForfeit: boolean;
  daysLeft: number;
  area: { id: string; name: string } | null;
  locationItem: LocationItem;
}

export interface BottleKeepReport {
  rows: BottleKeep[];
  byCustomer: Array<{ customerName: string; bottles: number; active: number; dueForForfeit: number }>;
  totals: { bottles: number; active: number; dueForForfeit: number };
}

export function useBottleKeeps(params: { status?: string; customer?: string } = {}) {
  const locationId = useLocationId();
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.customer) qs.set("customer", params.customer);
  return useQuery({
    queryKey: ["bottle-keeps", locationId, params.status ?? "", params.customer ?? ""],
    queryFn: () => api<BottleKeepReport>(`${base(locationId)}/bottle-keeps?${qs}`),
    enabled: Boolean(locationId),
  });
}

export function useBottleKeepMutations() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  // Forfeiting writes a Forfeit, so the purchases/forfeit lists and every report
  // reading them are stale the moment it succeeds.
  const done = {
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bottle-keeps", locationId] });
      void qc.invalidateQueries({ queryKey: ["forfeits", locationId] });
    },
  };
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        post<BottleKeep>(`${base(locationId)}/bottle-keeps`, body),
      ...done,
    }),
    claim: useMutation({
      mutationFn: (id: string) => post<BottleKeep>(`${base(locationId)}/bottle-keeps/${id}/claim`),
      ...done,
    }),
    forfeit: useMutation({
      mutationFn: (id: string) =>
        post<{ forfeitId: string }>(`${base(locationId)}/bottle-keeps/${id}/forfeit`),
      ...done,
    }),
  };
}
