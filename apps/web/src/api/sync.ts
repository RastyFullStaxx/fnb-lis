import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "./http";
import { useLocationId } from "./location";

/**
 * Two-way-sync visibility (docs/sync-and-data-lifecycle.md §7).
 *
 * Everything here reads state that only exists once an offline desktop is
 * registered. On a browser-only establishment the device list is empty, nothing
 * is stale and there are no duplicates — so every consumer below renders
 * nothing rather than an empty-state panel about a feature the client does not
 * use.
 */

const base = (locationId: string) => `/api/locations/${locationId}`;

export interface SyncDevice {
  id: string;
  name: string;
  locationId: string | null;
  lastSyncAt: string | null;
  lastSeenAt: string | null;
  /** No push within a shift — a report built right now may be missing its work. */
  stale: boolean;
}

export interface SyncStatus {
  devices: SyncDevice[];
  anyStale: boolean;
  checkedAt: string;
}

export function useSyncStatus() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["sync-status", locationId],
    queryFn: () => api<SyncStatus>(`${base(locationId)}/sync/status`),
    // A device that syncs while someone stares at a report should stop being
    // reported as stale without a manual refresh.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** Maps originDeviceId → machine name, for the "owned elsewhere" labels. */
export function useDeviceNames(): (id: string | null | undefined) => string | null {
  const status = useSyncStatus();
  return (id) => {
    if (!id) return null;
    return status.data?.devices.find((d) => d.id === id)?.name ?? "another computer";
  };
}

export interface DuplicateGroup {
  kind: "SALE" | "PURCHASE";
  businessDate: string;
  itemName: string;
  qty: number;
  records: Array<{
    id: string;
    createdAt: string;
    createdByName: string;
    /** Null = recorded in the web app; otherwise the machine's name. */
    source: string | null;
  }>;
}

export function useSuspectedDuplicates(from?: string) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["sync-duplicates", locationId, from],
    queryFn: () =>
      api<{ groups: DuplicateGroup[] }>(`${base(locationId)}/sync/duplicates${from ? `?from=${from}` : ""}`),
  });
}

/**
 * Free a draft stranded on a machine that is never coming back. ADMIN/OWNER
 * only — the server enforces `devices.manage`.
 */
export function useReleaseDraft() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entity, id, reason }: { entity: string; id: string; reason: string }) =>
      post<{ ok: boolean }>(`${base(locationId)}/drafts/${entity}/${id}/release`, { reason }),
    onSuccess: () => {
      // Prefix-matched, so both the list and the open detail view refresh.
      void qc.invalidateQueries({ queryKey: ["counts"] });
      void qc.invalidateQueries({ queryKey: ["purchases"] });
      void qc.invalidateQueries({ queryKey: ["transfers"] });
    },
  });
}
