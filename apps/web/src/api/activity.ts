import { useQuery } from "@tanstack/react-query";
import { api } from "./http";

export interface ActivityRow {
  id: string;
  ts: string;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string;
  details: string | null;
}

export interface ActivityFilters {
  clientId?: string;
  userId?: string;
  entity?: string;
  action?: string;
  search?: string;
  from?: string;
  to?: string;
}

export function useActivity(filters: ActivityFilters) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  return useQuery({
    queryKey: ["activity", filters],
    queryFn: () => api<{ rows: ActivityRow[] }>(`/api/activity?${params}`),
  });
}
