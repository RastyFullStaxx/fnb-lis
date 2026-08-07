import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CostBasis, PaymentTerms, ReconReport, ReportDiff } from "@fnb/core";
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
  // Regular-vs-discounted split (client req 2026-07-21).
  byPriceType: Array<{
    type: "REGULAR" | "DISCOUNTED";
    count: number;
    qty: number;
    gross: number;
    discount: number;
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
  // Grouped by canonical bucket (+ "Other"); `group` is the stable key.
  byReason: Array<{ group: string; reason: string; count: number; qty: number; cost: number }>;
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

export interface ParLevelReport {
  lastCountDate: string | null;
  periodBegin: string | null;
  periodEnd: string | null;
  rows: Array<{
    locationItemId: string;
    name: string;
    category: string;
    onHand: number;
    parLevel: number;
    usage: number;
    suggestedOrder: number;
    orderValue: number;
    belowPar: boolean;
  }>;
  totals: { belowParCount: number; orderValue: number };
}

export interface NonMovingReport {
  lastCountDate: string | null;
  periodBegin: string | null;
  periodEnd: string | null;
  rows: Array<{
    locationItemId: string;
    name: string;
    category: string;
    onHand: number;
    cost: number;
    costValue: number;
    retailValue: number;
  }>;
  totals: { count: number; costValue: number; retailValue: number };
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
    /** Sales − cost of goods (client req 2026-07-25). "net" = VAT-exclusive,
        not accounting net profit — this system tracks no operating expenses. */
    grossProfit: number;
    netProfit: number;
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
  // Source-record id (CountSession/Purchase/SaleRecord) for drill-down navigation.
  // null for kinds with no landing page yet (FORFEIT, TRANSFER_IN, TRANSFER_OUT).
  id: string | null;
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

/** The legacy 24-column "Full Audit Report By Category" layout — mirrors
    LegacyAuditRow/Group in apps/server/src/services/report-suite.ts. */
export interface LegacyAuditRow {
  productName: string;
  sizeUom: string;
  contentTracked: boolean;
  beginFull: number;
  beginOpen: number;
  bCost: number;
  purchased: number;
  purchasedCost: number;
  forfeited: number;
  endFull: number;
  endOpen: number;
  eCost: number;
  usage: number;
  costOfUsage: number;
  shot: number;
  bottle: number;
  costOfSold: number;
  revenue: number;
  usedVsSales: number;
  nonRevUsage: number;
  nonRevCost: number;
  overallVariance: number;
  variancePct: number | null;
  varianceCost: number;
  varianceRetail: number;
}
export interface LegacyAuditReport {
  begin: string;
  end: string;
  costBasis: string;
  groups: Array<{
    categoryName: string;
    rows: LegacyAuditRow[];
    totals: Omit<LegacyAuditRow, "productName" | "sizeUom" | "contentTracked" | "variancePct"> & {
      variancePct: null;
    };
  }>;
  totals: LegacyAuditReport["groups"][number]["totals"];
  costRatio: number | null;
}

export function useLegacyAuditReport(
  begin: string,
  end: string,
  variant: "detailed" | "inventory",
) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "legacy-audit", locationId, begin, end, variant],
    queryFn: () =>
      api<LegacyAuditReport>(
        `${base(locationId)}/reports/legacy-audit?begin=${begin}&end=${end}&variant=${variant}`,
      ),
    enabled: Boolean(begin && end),
  });
}

export interface AssetBreakageReport {
  from: string;
  to: string;
  rows: Array<{
    date: string;
    name: string;
    category: string;
    uom: string;
    qty: number;
    reason: string;
    note: string | null;
    costValue: number;
  }>;
  byReason: Array<{ reason: string; count: number; qty: number; costValue: number }>;
  totals: { qty: number; costValue: number };
}

export function useAssetBreakageReport(from: string, to: string, enabled = true) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "asset-breakage", locationId, from, to],
    queryFn: () => api<AssetBreakageReport>(`${base(locationId)}/reports/asset-breakage?from=${from}&to=${to}`),
    enabled: enabled && Boolean(from && to),
  });
}

export interface AssetRegisterReport {
  asOf: string;
  rows: Array<{
    locationItemId: string;
    assetCode: string | null;
    location: string;
    name: string;
    brand: string | null;
    model: string | null;
    category: string;
    uom: string;
    serialNo: string | null;
    condition: string | null;
    status: string | null;
    industry: string | null;
    initialCost: number | null;
    currentCost: number;
    remarks: string | null;
    supplier: string | null;
    latestNoteDate: string | null;
    latestNote: string | null;
    qty: number;
    currentValue: number;
  }>;
  totals: { count: number; qty: number; initialCostValue: number; currentCostValue: number };
}

export function useAssetRegisterReport() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "asset-register", locationId],
    queryFn: () => api<AssetRegisterReport>(`${base(locationId)}/reports/asset-register`),
  });
}

export interface AssetInventoryReport {
  beginningDate: string | null;
  endingDate: string | null;
  rows: Array<{
    locationItemId: string;
    assetCode: string | null;
    name: string;
    category: string;
    industry: string | null;
    uom: string;
    beginningQty: number;
    endingQty: number;
    change: number;
  }>;
  totals: { beginningQty: number; endingQty: number; change: number };
}

export function useAssetInventoryReport(beginningDate?: string, endingDate?: string) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "asset-inventory", locationId, beginningDate, endingDate],
    queryFn: () =>
      api<AssetInventoryReport>(
        `${base(locationId)}/reports/asset-inventory?beginningDate=${beginningDate ?? ""}&endingDate=${endingDate ?? ""}`,
      ),
    enabled: Boolean(beginningDate && endingDate),
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

export function useTransferReport(
  from: string,
  to: string,
  direction: "in" | "out",
  enabled = true,
  /** Report on one branch only; empty = every counterparty. */
  counterparty = "",
) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "transfers", locationId, from, to, direction, counterparty],
    queryFn: () =>
      api<TransferReport>(
        `${base(locationId)}/reports/transfers?from=${from}&to=${to}&direction=${direction}${counterparty ? `&counterparty=${counterparty}` : ""}`,
      ),
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

export function useParLevelReport() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "par-level", locationId],
    queryFn: () => api<ParLevelReport>(`${base(locationId)}/reports/par-level`),
  });
}

export function useNonMovingReport() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "non-moving", locationId],
    queryFn: () => api<NonMovingReport>(`${base(locationId)}/reports/non-moving`),
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

// ── What-if scenarios (Phase 3, 2026-08-06) ──

export type ScenarioKind = "SALE" | "NON_REVENUE" | "PRODUCTION" | "PURCHASE" | "FORFEIT";

export interface Scenario {
  id: string;
  begin: string;
  end: string;
  name: string;
  note: string | null;
  status: string;
  createdAt: string;
  createdByName: string;
  _count?: { entries: number };
}

export interface ScenarioEntry {
  id: string;
  kind: ScenarioKind;
  locationItemId: string;
  businessDate: string;
  qty: number;
  unitCost: number | null;
  unitPrice: number | null;
  note: string | null;
  itemName: string;
}

export function useScenarios() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["scenarios", locationId],
    queryFn: () => api<{ scenarios: Scenario[] }>(`${base(locationId)}/scenarios`),
  });
}

export function useScenario(id: string | null) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["scenario", locationId, id],
    queryFn: () => api<{ scenario: Scenario; entries: ScenarioEntry[] }>(`${base(locationId)}/scenarios/${id}`),
    enabled: Boolean(id),
  });
}

export function useScenarioReport(id: string | null) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["scenario-report", locationId, id],
    queryFn: () => api<{ scenario: Scenario; report: ReconReport }>(`${base(locationId)}/scenarios/${id}/report`),
    enabled: Boolean(id),
  });
}

export function useScenarioCompare(id: string | null) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["scenario-compare", locationId, id],
    queryFn: () => api<{ scenario: Scenario; diff: ReportDiff }>(`${base(locationId)}/scenarios/${id}/compare`),
    enabled: Boolean(id),
  });
}

export function useScenarioMutations(scenarioId?: string) {
  const locationId = useLocationId();
  const qc = useQueryClient();
  // Any entry change moves both the scenario report and its comparison, so
  // both go — showing one refreshed and the other stale would be worse than
  // showing neither.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["scenario", locationId, scenarioId] });
    void qc.invalidateQueries({ queryKey: ["scenario-report", locationId, scenarioId] });
    void qc.invalidateQueries({ queryKey: ["scenario-compare", locationId, scenarioId] });
    void qc.invalidateQueries({ queryKey: ["scenarios", locationId] });
  };
  return {
    create: useMutation({
      mutationFn: (body: { begin: string; end: string; name: string; note?: string; seedFromLive?: boolean }) =>
        api<Scenario & { seededEntries: number }>(`${base(locationId)}/scenarios`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      onSuccess: refresh,
    }),
    addEntry: useMutation({
      mutationFn: (body: {
        kind: ScenarioKind;
        locationItemId: string;
        businessDate: string;
        qty: number;
        unitCost?: number;
        unitPrice?: number;
      }) =>
        api<ScenarioEntry>(`${base(locationId)}/scenarios/${scenarioId}/entries`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      onSuccess: refresh,
    }),
    removeEntry: useMutation({
      mutationFn: (entryId: string) =>
        api<{ ok: true }>(`${base(locationId)}/scenarios/${scenarioId}/entries/${entryId}`, { method: "DELETE" }),
      onSuccess: refresh,
    }),
    discard: useMutation({
      mutationFn: (id: string) =>
        api<Scenario>(`${base(locationId)}/scenarios/${id}/discard`, { method: "POST" }),
      onSuccess: refresh,
    }),
  };
}

// ── Closed periods (Phase 2, 2026-08-06) ──

export interface PeriodLock {
  id: string;
  begin: string;
  end: string;
  status: "LOCKED" | "RELEASED";
  reason: string | null;
  lockedAt: string;
  lockedByName: string;
  releasedAt: string | null;
  releaseReason: string | null;
}

export function usePeriodLocks() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["period-locks", locationId],
    queryFn: () => api<{ locks: PeriodLock[] }>(`${base(locationId)}/period-locks`),
  });
}

export function usePeriodLockMutations() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  // Closing or reopening a period changes what every entry screen will accept,
  // so the whole cache goes — a stale "this saves fine" is the one wrong answer
  // this feature must not give.
  const settled = { onSuccess: () => qc.invalidateQueries() };
  return {
    lock: useMutation({
      mutationFn: (body: { begin: string; end: string; reason?: string }) =>
        api<PeriodLock>(`${base(locationId)}/period-locks`, { method: "POST", body: JSON.stringify(body) }),
      ...settled,
    }),
    release: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) =>
        api<PeriodLock>(`${base(locationId)}/period-locks/${id}/release`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        }),
      ...settled,
    }),
  };
}

// ── Report snapshots: the Full Audit frozen, and two of them compared ──
// (client request G, 2026-08-06 — mirrors apps/server/src/services/snapshots.ts)

export interface SnapshotSummary {
  id: string;
  slug: string;
  label: string | null;
  note: string | null;
  takenAt: string;
  takenByName: string;
  params: { begin: string; end: string; productType?: string; costBasis: string; varianceThresholdPct: number };
  supersedesId: string | null;
  totals: ReconReport["totals"];
  rowCount: number;
}

export interface SnapshotComparison {
  a: SnapshotSummary;
  b: SnapshotSummary;
  diff: ReportDiff;
  activity: Array<{ id: string; ts: string; userName: string | null; action: string; summary: string }>;
}

export function useSnapshots() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["snapshots", locationId],
    queryFn: () => api<{ snapshots: SnapshotSummary[] }>(`${base(locationId)}/reports/full-audit/snapshots`),
  });
}

export function useSnapshotCompare(a: string | null, b: string | null) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["snapshot-compare", locationId, a, b],
    queryFn: () => api<SnapshotComparison>(`${base(locationId)}/reports/full-audit/compare?a=${a}&b=${b}`),
    // Same id on both sides is a 400, not a comparison — the picker prevents it,
    // but a stale deep link should not fire a doomed request either.
    enabled: Boolean(a && b && a !== b),
  });
}

export function useSaveSnapshot() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { begin: string; end: string; label?: string; note?: string; productType?: string }) =>
      api<SnapshotSummary>(`${base(locationId)}/reports/full-audit/snapshot`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshots", locationId] }),
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
    | "par-level"
    | "non-moving"
    | "asset-breakage"
    | "asset-register"
    | "asset-inventory"
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
