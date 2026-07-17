import { useQuery } from "@tanstack/react-query";
import { api } from "./http";
import { useLocationId } from "./location";

const base = (locationId: string) => `/api/locations/${locationId}`;

// ── Shapes (mirror apps/server/src/services/report-lists.ts) ──

export interface SalesReport {
  from: string;
  to: string;
  rows: Array<{
    saleDate: string;
    name: string;
    kind: "item" | "menu";
    category: string | null;
    qty: number;
    unitPrice: number;
    discountPct: number;
    gross: number;
    net: number;
  }>;
  totals: { qty: number; gross: number; discount: number; net: number };
}

export interface PurchaseReport {
  from: string;
  to: string;
  rows: Array<{
    purchaseDate: string;
    supplier: string;
    refNo: string | null;
    name: string;
    category: string | null;
    qty: number;
    unitCost: number;
    lineTotal: number;
  }>;
  bySupplier: Array<{ supplier: string; qty: number; cost: number }>;
  totals: { qty: number; cost: number };
}

export interface NonRevenueReport {
  from: string;
  to: string;
  rows: Array<{
    saleDate: string;
    name: string;
    reason: string;
    qty: number;
    contentOverride: number | null;
    estimatedCost: number | null;
  }>;
  byReason: Array<{ reason: string; count: number; qty: number; cost: number }>;
  totals: { count: number; qty: number; cost: number };
}

export interface OnHandReport {
  lastCountDate: string | null;
  rows: Array<{
    locationItemId: string;
    name: string;
    category: string;
    productType: string;
    onHand: number;
    cost: number;
    retail: number;
    costValue: number;
    retailValue: number;
    belowPar: boolean;
  }>;
  totals: { costValue: number; retailValue: number };
}

export interface DrillRecord {
  kind: "COUNT" | "PURCHASE" | "SALE" | "NON_REVENUE" | "PRODUCTION" | "FORFEIT";
  date: string;
  detail: string;
  qty: number | null;
  amount: number | null;
}

// ── Hooks ──

export function useSalesReport(from: string, to: string, enabled = true) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "sales", locationId, from, to],
    queryFn: () => api<SalesReport>(`${base(locationId)}/reports/sales?from=${from}&to=${to}`),
    enabled: enabled && Boolean(from && to),
  });
}

export function usePurchaseReport(from: string, to: string, enabled = true) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "purchases", locationId, from, to],
    queryFn: () => api<PurchaseReport>(`${base(locationId)}/reports/purchases?from=${from}&to=${to}`),
    enabled: enabled && Boolean(from && to),
  });
}

export function useNonRevenueReport(from: string, to: string, enabled = true) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "non-revenue", locationId, from, to],
    queryFn: () => api<NonRevenueReport>(`${base(locationId)}/reports/non-revenue?from=${from}&to=${to}`),
    enabled: enabled && Boolean(from && to),
  });
}

export function useOnHandReport() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "on-hand-full", locationId],
    queryFn: () => api<OnHandReport>(`${base(locationId)}/reports/on-hand`),
  });
}

export function useFullAuditDrill(begin: string, end: string, locationItemId: string | null) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "drill", locationId, begin, end, locationItemId],
    queryFn: () =>
      api<{ records: DrillRecord[] }>(
        `${base(locationId)}/reports/full-audit/drill?begin=${begin}&end=${end}&locationItemId=${locationItemId}`,
      ),
    enabled: Boolean(begin && end && locationItemId),
  });
}

/** Export URL builder — used with downloadFile(). */
export function exportUrl(
  locationId: string,
  report: "full-audit" | "sales" | "purchases" | "non-revenue" | "on-hand",
  format: "xlsx" | "csv",
  params: Record<string, string> = {},
): string {
  const qs = new URLSearchParams({ ...params, format });
  return `${base(locationId)}/reports/${report}/export?${qs}`;
}
