import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import type { LocationItemAttach, LocationItemSchedule, LocationItemUpdate, MeClient, SupplierUpsert } from "@fnb/core";
import { api, del, post, put } from "./http";
import { useMe } from "./auth";
import type { AvailableVariant, ClutterCandidateReport, FifoBatch, LocationItem, Supplier } from "./types";

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

export function useLocationItems(filters: { search?: string; missingPrices?: boolean; includeInactive?: boolean } = {}) {
  const locationId = useLocationId();
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.missingPrices) params.set("missingPrices", "1");
  // Show Hidden toggle (clutter-item-removal plan, Phase 4.1) — the server
  // already accepts this on GET /location-items, no route change needed.
  if (filters.includeInactive) params.set("includeInactive", "1");
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
      api<{ trailingAverage: number | null; trailingFullQty: number | null }>(`${base(locationId)}/location-items/${locationItemId}/trailing-average`),
    enabled: locationItemId != null,
  });
}

/**
 * Open perishable batches for an item, oldest expiry first — the count
 * screen's FIFO worklist (expiry-date-plan.md, phases doc Phase 4.2). Same
 * shape as useTrailingAverage above: one fetch per picked item, `null`/empty
 * while nothing is picked rather than showing stale data from the last item.
 */
export function useFifoBatches(locationItemId: string | null) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["fifoBatches", locationId, locationItemId],
    queryFn: () =>
      api<{ batches: FifoBatch[] }>(`${base(locationId)}/location-items/${locationItemId}/fifo-batches`),
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

/**
 * Set or clear an item's expected movement window (clutter-item-removal
 * plan, Phase 4 of the server work in commit 103f048). Same shape as
 * useUpdateLocationItem above — a schedule change is still a catalog edit
 * on this one row, just its own route so gating it on master.write doesn't
 * also open cost, retail, and weights to that permission.
 */
export function useUpdateLocationItemSchedule() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: LocationItemSchedule & { id: string }) =>
      put<LocationItem>(`${base(locationId)}/location-items/${id}/schedule`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["locationItems", locationId] });
      // A schedule change can move an item in or out of the clutter list.
      void qc.invalidateQueries({ queryKey: ["clutterCandidates", locationId] });
    },
  });
}

/**
 * Hide/restore a catalog row (clutter-item-removal plan, Phase 2 of the
 * server work in commit 103f048). Both flip LocationItem.isActive; hide can
 * be refused by the server (open count, live recipe, unreceived transfer),
 * which surfaces as an ApiError the caller displays as is — no client-side
 * retry, the person just clears the blocker first.
 */
export function useHideLocationItem() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => post<LocationItem>(`${base(locationId)}/location-items/${id}/hide`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["locationItems", locationId] });
      // A hidden row drops off the candidates list too, same underlying row.
      void qc.invalidateQueries({ queryKey: ["clutterCandidates", locationId] });
    },
  });
}

export function useRestoreLocationItem() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => post<LocationItem>(`${base(locationId)}/location-items/${id}/restore`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["locationItems", locationId] });
    },
  });
}

/**
 * System-suggested removal candidates (clutter-item-removal plan, Phase 3
 * of the server work in commit 103f048). Deliberately kept in this file
 * rather than api/reports.ts: the route sits under /location-items, not
 * /reports, and approving a candidate mutates the catalog — it is a catalog
 * tool, not a read-only report, so it doesn't belong with the report hooks.
 */
export function useClutterCandidatesReport() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["clutterCandidates", locationId],
    queryFn: () => api<ClutterCandidateReport>(`${base(locationId)}/location-items/clutter-candidates`),
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
