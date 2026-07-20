import { useQuery } from "@tanstack/react-query";
import type { CostBasis, PaymentTerms } from "@fnb/core";
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
  bySupplier: Array<{
    supplier: string;
    contactPerson: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    paymentTerms: PaymentTerms | null;
    qty: number;
    cost: number;
  }>;
  totals: { qty: number; cost: number };
}

export interface NonRevenueReport {
  from: string;
  to: string;
  rows: Array<{
    saleDate: string;
    name: string;
    uom: string | null;
    reason: string;
    qty: number;
    contentOverride: number | null;
    estimatedCost: number | null;
    estimatedRetail: number | null;
  }>;
  byReason: Array<{ reason: string; count: number; qty: number; cost: number }>;
  totals: { count: number; qty: number; cost: number; retail: number };
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

export interface CostAnalysisReport {
  begin: string;
  end: string;
  sales: {
    byType: Array<{ productType: string; gross: number; net: number }>;
    totalGross: number;
    totalNet: number;
    vatAmount: number;
  };
  sections: Array<{
    productType: string;
    grossSales: number;
    netSales: number;
    rows: Array<{
      category: string;
      beginningCost: number;
      purchasesCost: number;
      transfersCost: number;
      endingCost: number;
      cost: number;
      costNet: number;
      grossPct: number | null;
      netPct: number | null;
    }>;
    totals: {
      beginningCost: number;
      purchasesCost: number;
      transfersCost: number;
      endingCost: number;
      cost: number;
      costNet: number;
      grossPct: number | null;
      netPct: number | null;
    };
  }>;
}

export interface TransferReport {
  from: string;
  to: string;
  direction: "in" | "out";
  rows: Array<{
    date: string;
    counterparty: string;
    counterpartyKind: string | null;
    name: string;
    category: string;
    qtySent: number;
    qtyReceived: number | null;
    unitCost: number;
    costValue: number;
    retailValue: number;
  }>;
  byCounterparty: Array<{ counterparty: string; qty: number; cost: number }>;
  totals: { qty: number; cost: number; retail: number };
}

export interface DrillRecord {
  kind: "COUNT" | "PURCHASE" | "SALE" | "NON_REVENUE" | "PRODUCTION" | "FORFEIT" | "TRANSFER_IN" | "TRANSFER_OUT";
  date: string;
  detail: string;
  qty: number | null;
  amount: number | null;
}

// ── Hooks ──

export type SalesReportView = "sales" | "discounted" | "production";

export function useSalesReport(from: string, to: string, view: SalesReportView = "sales", enabled = true) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "sales", locationId, from, to, view],
    queryFn: () => api<SalesReport>(`${base(locationId)}/reports/sales?from=${from}&to=${to}&view=${view}`),
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

export function useNonRevenueReport(from: string, to: string, group?: string, enabled = true) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "non-revenue", locationId, from, to, group ?? "all"],
    queryFn: () =>
      api<NonRevenueReport>(
        `${base(locationId)}/reports/non-revenue?from=${from}&to=${to}${group ? `&group=${group}` : ""}`,
      ),
    enabled: enabled && Boolean(from && to),
  });
}

export function useCostAnalysisReport(begin?: string, end?: string) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "cost-analysis", locationId, begin, end],
    queryFn: () => api<CostAnalysisReport>(`${base(locationId)}/reports/cost-analysis?begin=${begin}&end=${end}`),
    enabled: Boolean(begin && end),
  });
}

export function useTransferReport(from: string, to: string, direction: "in" | "out", enabled = true) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "transfers", locationId, from, to, direction],
    queryFn: () =>
      api<TransferReport>(`${base(locationId)}/reports/transfers?from=${from}&to=${to}&direction=${direction}`),
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

export interface TopSellersReport {
  from: string;
  to: string;
  topBrands: Array<{
    id: string;
    name: string;
    kind: "item";
    category: string | null;
    qty: number;
    revenue: number;
  }>;
  topMenus: Array<{
    id: string;
    name: string;
    kind: "menu";
    category: string | null;
    qty: number;
    revenue: number;
  }>;
  topIngredients: Array<{
    id: string;
    name: string;
    kind: "ingredient";
    category: string | null;
    qty: number;
    revenue: number;
  }>;
}

export function useTopSellersReport(from?: string, to?: string, limit?: number) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "top-sellers", locationId, from, to, limit],
    queryFn: () => {
      const qs = new URLSearchParams({ from: from!, to: to! });
      if (limit) qs.set("limit", String(limit));
      return api<TopSellersReport>(`${base(locationId)}/reports/top-sellers?${qs}`);
    },
    enabled: Boolean(from && to),
  });
}

/** Export URL builder — used with downloadFile(). */
export function exportUrl(
  locationId: string,
  report:
    | "full-audit"
    | "sales"
    | "purchases"
    | "non-revenue"
    | "on-hand"
    | "transfers"
    | "cost-analysis"
    | "top-sellers"
    | "legacy-audit"
    | "cost-snapshot"
    | "forfeits"
    | "usage-cost"
    | "sales-by-item",
  format: "xlsx" | "csv" | "pdf",
  params: Record<string, string> = {},
): string {
  const qs = new URLSearchParams({ ...params, format });
  return `${base(locationId)}/reports/${report}/export?${qs}`;
}

// ── Client report suite (docs/client-report-formats.md) ──

export interface CostSnapshotReport {
  anchorDate: string;
  costBasis: CostBasis;
  rows: Array<{
    name: string;
    uom: string;
    qty: number;
    cost: number;
    value: number;
    basis: "average" | "price";
  }>;
  totals: { qty: number; value: number };
}

export function useCostSnapshotReport(anchor?: string) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "cost-snapshot", locationId, anchor],
    queryFn: () => api<CostSnapshotReport>(`${base(locationId)}/reports/cost-snapshot?anchor=${anchor}`),
    enabled: Boolean(anchor),
  });
}

export interface ForfeitsReport {
  from: string;
  to: string;
  rows: Array<{
    date: string;
    name: string;
    uom: string;
    qty: number;
    contentEquiv: number;
    costValue: number;
    retailValue: number;
  }>;
  totals: { qty: number; contentEquiv: number; costValue: number; retailValue: number };
}

export function useForfeitsReport(from: string, to: string) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "forfeits", locationId, from, to],
    queryFn: () => api<ForfeitsReport>(`${base(locationId)}/reports/forfeits?from=${from}&to=${to}`),
    enabled: Boolean(from && to),
  });
}

export interface UsageCostReport {
  begin: string;
  end: string;
  rows: Array<{ name: string; uom: string; qty: number; cost: number }>;
  totals: { qty: number; cost: number };
}

export function useUsageCostReport(begin?: string, end?: string) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "usage-cost", locationId, begin, end],
    queryFn: () => api<UsageCostReport>(`${base(locationId)}/reports/usage-cost?begin=${begin}&end=${end}`),
    enabled: Boolean(begin && end),
  });
}

export interface SalesByItemReport {
  begin: string;
  end: string;
  rows: Array<{ name: string; uom: string; shot: number; bottle: number; qty: number; cost: number; retail: number }>;
  totals: { shot: number; bottle: number; qty: number; cost: number; retail: number };
}

export function useSalesByItemReport(begin?: string, end?: string) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "sales-by-item", locationId, begin, end],
    queryFn: () => api<SalesByItemReport>(`${base(locationId)}/reports/sales-by-item?begin=${begin}&end=${end}`),
    enabled: Boolean(begin && end),
  });
}
