import { useQuery } from "@tanstack/react-query";
import { api } from "./http";
import { useLocationId } from "./location";

export interface DashboardData {
  generatedAt: string;
  period: {
    lastCountDate: string | null;
    daysSinceLastCount: number | null;
    countDates: number;
    canAudit: boolean;
    latest: { begin: string; end: string } | null;
  };
  readiness: {
    activeItems: number;
  };
  openWork: {
    latestCount: {
      id: string;
      date: string;
      lineCount: number;
    } | null;
    latestPurchase: {
      id: string;
      invoiceRef: string | null;
      supplierName: string | null;
      updatedAt: string;
    } | null;
  };
  attention: {
    missingPrices: number;
    unmatchedRows: number;
    draftPurchases: number;
    openCounts: number;
  };
  varianceLeaders: Array<{
    locationItemId: string;
    itemName: string;
    variancePct: number | null;
    varianceCost: number;
    varianceRetail: number;
    short: boolean;
  }>;
  recentActivity: Array<{
    id: string;
    ts: string;
    userName: string | null;
    action: string;
    entity: string;
    entityId: string | null;
    summary: string;
  }>;
}

export function useDashboard() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["dashboard", locationId],
    queryFn: () => api<DashboardData>(`/api/locations/${locationId}/dashboard`),
  });
}

export interface TrendPeriod {
  begin: string;
  end: string;
  revenue: number;
  usageCost: number;
  varianceCost: number;
  varianceRetail: number;
  shortageCost: number;
  surplusCost: number;
  itemsShort: number;
  itemsOver: number;
}

export interface TrendsData {
  periods: TrendPeriod[]; // oldest → newest
  totalPeriods: number;
}

export function useTrends(periods = 8, enabled = true) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["dashboard-trends", locationId, periods],
    queryFn: () => api<TrendsData>(`/api/locations/${locationId}/dashboard/trends?periods=${periods}`),
    enabled,
    staleTime: 60_000, // eight reconciliations per hit — don't refetch on every focus
  });
}
