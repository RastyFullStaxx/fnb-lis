import {
  ASSET_LOSS_REASON_LABELS,
  costLine,
  hasReportActivity,
  hasVariance,
  isPaymentTerms,
  netOfVat,
  NON_REVENUE_GROUP_LABELS,
  NON_REVENUE_GROUPS,
  nonRevenueGroupOf,
  pctOf,
  round2,
  shouldDropHiddenRow,
  VARIANCE_EPSILON,
  type AssetLossReason,
  type CostBasis,
  type NonRevenueGroup,
  type PaymentTerms,
} from "@fnb/core";
import { buildFullAudit, committedCountDates } from "./report-assembly";
import { weightedAverageCosts } from "./valuation";
import { prisma } from "../db";

/** Server-local calendar day — valuation as-of date for current stock. */
function todayBusinessDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Business-listing reports (sales, purchases, non-revenue, on-hand).
 * These use INCLUSIVE date ranges [from, to] — the natural expectation for
 * "sales from Jun 1 to Jun 8". Only the Full Audit reconciliation uses the
 * half-open audit window; see report-assembly.ts / architecture.md §6.
 */

const LI_INCLUDE = {
  itemVariant: { include: { unit: true, item: { include: { category: true } } } },
} as const;

function itemLabel(li: { itemVariant: { size: number; unit: { name: string }; item: { name: string } } }): string {
  return `${li.itemVariant.item.name} ${li.itemVariant.size} ${li.itemVariant.unit.name}`;
}

// ── Sales report (transaction-level) ──
// Views (client req, 2026-07-20): "sales" = kind SALE (default);
// "discounted" = SALE rows carrying a discount; "production" = kind
// PRODUCTION (consumption at zero revenue), surfaced under Sales per the
// client's mental model ("Input Production").

export type SalesReportView = "sales" | "discounted" | "production";

export interface SalesReportRow {
  saleDate: string;
  name: string;
  kind: "item" | "menu";
  category: string | null;
  qty: number;
  unitPrice: number;
  discountPct: number;
  gross: number; // unitPrice × qty (legacy getSales basis)
  net: number; // gross × (1 − discount/100)
  /** LocationItem.isActive — null for menu rows (no single LocationItem).
      Carried through for the clutter display filter and the Phase 6.1 badge;
      see clutter-in-reports-decision.md. */
  isActive: boolean | null;
}
/** Regular = no discount, Discounted = any discount (client req 2026-07-21).
    Derived from discountPct, so it's a view of the same rows, not a new query. */
export type SalesPriceType = "REGULAR" | "DISCOUNTED";
const PRICE_TYPE_ORDER: SalesPriceType[] = ["REGULAR", "DISCOUNTED"];

export interface SalesReport {
  from: string;
  to: string;
  rows: SalesReportRow[];
  // Regular-vs-discounted split so a manager sees how much revenue is being
  // discounted away — the `discount` field is the money given up.
  byPriceType: Array<{ type: SalesPriceType; count: number; qty: number; gross: number; discount: number; net: number }>;
  totals: { qty: number; gross: number; discount: number; net: number };
}

export async function salesReport(
  locationId: string,
  from: string,
  to: string,
  allowedProductTypes?: readonly string[] | null,
  view: SalesReportView = "sales",
  // Clutter-in-reports (docs/clutter-in-reports-decision.md): off by default.
  // Every row here IS a transaction — a hidden item's row only exists because
  // it moved in this exact window — so `hasReportActivity` is true for every
  // row by construction and nothing is ever actually dropped. Still threaded
  // through for the same reason every other report carries it: one client
  // policy applied consistently, never a per-viewer difference, and it keeps
  // this report honest if a future row source ever stops implying activity.
  includeHiddenInReports: boolean = false,
): Promise<SalesReport> {
  const sales = await prisma.saleRecord.findMany({
    where: {
      locationId,
      status: "ACTIVE",
      kind: view === "production" ? "PRODUCTION" : "SALE",
      ...(view === "discounted" ? { discountPct: { gt: 0 } } : {}),
      saleDate: { gte: from, lte: to },
      // Menu sales (locationItemId null) span ingredients across modules — they're
      // left unfiltered here, matching how report-assembly treats menu expansion;
      // only direct item rows carry a single productType to check.
      ...(allowedProductTypes
        ? { OR: [{ locationItemId: null }, { locationItem: { itemVariant: { item: { category: { productType: { in: [...allowedProductTypes] } } } } } }] }
        : {}),
    },
    include: { locationItem: { include: LI_INCLUDE }, menuItem: true },
    orderBy: [{ saleDate: "asc" }, { createdAt: "asc" }],
  });

  const allRows: SalesReportRow[] = sales.map((s) => {
    const gross = s.unitPrice * s.qty;
    const net = gross * (1 - s.discountPct / 100);
    return {
      saleDate: s.saleDate,
      name: s.locationItem ? itemLabel(s.locationItem) : (s.menuItem?.name ?? "—"),
      kind: s.locationItem ? "item" : "menu",
      category: s.locationItem?.itemVariant.item.category.name ?? null,
      qty: s.qty,
      unitPrice: s.unitPrice,
      discountPct: s.discountPct,
      gross,
      net,
      isActive: s.locationItem?.isActive ?? null,
    };
  });

  const ptMap = new Map<SalesPriceType, { count: number; qty: number; gross: number; discount: number; net: number }>();
  for (const r of allRows) {
    const type: SalesPriceType = r.discountPct > 0 ? "DISCOUNTED" : "REGULAR";
    const agg = ptMap.get(type) ?? { count: 0, qty: 0, gross: 0, discount: 0, net: 0 };
    agg.count += 1;
    agg.qty += r.qty;
    agg.gross += r.gross;
    agg.discount += r.gross - r.net;
    agg.net += r.net;
    ptMap.set(type, agg);
  }
  const byPriceType = PRICE_TYPE_ORDER.filter((t) => ptMap.has(t)).map((t) => ({ type: t, ...ptMap.get(t)! }));

  // Totals FIRST, from the complete row set — the display filter below must
  // never be able to move them (clutter-in-reports-decision.md).
  const totals = allRows.reduce(
    (acc, r) => ({
      qty: acc.qty + r.qty,
      gross: acc.gross + r.gross,
      discount: acc.discount + (r.gross - r.net),
      net: acc.net + r.net,
    }),
    { qty: 0, gross: 0, discount: 0, net: 0 },
  );

  // A row here IS the activity — it exists because a sale posted in this
  // window — so a hidden item's row always has qty/revenue > 0 and never
  // qualifies for dropping. This mirrors shouldDropHiddenRow's own rule
  // (isActive === false AND zero activity) without needing a full ReconRow.
  const rows =
    includeHiddenInReports
      ? allRows
      : allRows.filter((r) => r.isActive !== false || r.qty !== 0 || r.gross !== 0);

  return { from, to, rows, byPriceType, totals };
}

// ── Purchase report (committed lines, with supplier rollup) ──

export interface PurchaseReportRow {
  purchaseDate: string;
  supplier: string;
  refNo: string | null;
  name: string;
  category: string | null;
  qty: number;
  unitCost: number;
  lineTotal: number;
  /** LocationItem.isActive — carried through for the clutter display filter
      and the Phase 6.1 badge; see clutter-in-reports-decision.md. */
  isActive: boolean;
}
export interface PurchaseReport {
  from: string;
  to: string;
  rows: PurchaseReportRow[];
  /** Per-supplier rollup carrying the contact + terms the client asked for
      (2026-07-20) so a buyer can see who to call and when payment is due. */
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

export async function purchaseReport(
  locationId: string,
  from: string,
  to: string,
  allowedProductTypes?: readonly string[] | null,
  // Clutter-in-reports (docs/clutter-in-reports-decision.md): off by default.
  // Same reasoning as salesReport — a row here IS a purchase that landed in
  // this window, so it is activity by construction and nothing is ever
  // actually dropped. Threaded through for policy consistency regardless.
  includeHiddenInReports: boolean = false,
): Promise<PurchaseReport> {
  const lines = await prisma.purchaseLine.findMany({
    where: {
      status: "ACTIVE",
      purchase: { locationId, status: "COMMITTED", purchaseDate: { gte: from, lte: to } },
      ...(allowedProductTypes
        ? { locationItem: { itemVariant: { item: { category: { productType: { in: [...allowedProductTypes] } } } } } }
        : {}),
    },
    include: { locationItem: { include: LI_INCLUDE }, purchase: { include: { supplier: true } } },
    orderBy: { purchase: { purchaseDate: "asc" } },
  });

  const allRows: PurchaseReportRow[] = lines.map((l) => ({
    purchaseDate: l.purchase.purchaseDate,
    supplier: l.purchase.supplier?.name ?? "—",
    refNo: l.purchase.refNo,
    name: itemLabel(l.locationItem),
    category: l.locationItem.itemVariant.item.category.name,
    qty: l.qty,
    unitCost: l.unitCost,
    lineTotal: l.lineTotal,
    isActive: l.locationItem.isActive,
  }));

  // Keyed by supplier ID, not name: two distinct suppliers can legitimately
  // share a name (the seed data has exactly that), and merging them would
  // attribute one vendor's spend — and contact details — to another.
  const supplierMap = new Map<
    string,
    {
      supplier: string;
      qty: number;
      cost: number;
      contactPerson: string | null;
      phone: string | null;
      email: string | null;
      address: string | null;
      paymentTerms: PaymentTerms | null;
    }
  >();
  for (const l of lines) {
    const s = l.purchase.supplier;
    const key = s?.id ?? "__none__";
    const agg = supplierMap.get(key) ?? {
      supplier: s?.name ?? "—",
      qty: 0,
      cost: 0,
      contactPerson: s?.contactPerson ?? null,
      phone: s?.phone ?? null,
      email: s?.email ?? null,
      address: s?.address ?? null,
      paymentTerms: isPaymentTerms(s?.paymentTerms) ? s.paymentTerms : null,
    };
    agg.qty += l.qty;
    agg.cost += l.lineTotal;
    supplierMap.set(key, agg);
  }
  const bySupplier = [...supplierMap.values()].sort((a, b) => b.cost - a.cost);

  // Totals FIRST, from the complete row set — the display filter below must
  // never be able to move them (clutter-in-reports-decision.md).
  const totals = allRows.reduce(
    (acc, r) => ({ qty: acc.qty + r.qty, cost: acc.cost + r.lineTotal }),
    { qty: 0, cost: 0 },
  );

  // A row here IS the activity — it exists because a purchase line landed in
  // this window — so a hidden item's row always has qty/lineTotal > 0 and
  // never qualifies for dropping (mirrors shouldDropHiddenRow's own rule).
  const rows =
    includeHiddenInReports
      ? allRows
      : allRows.filter((r) => r.isActive || r.qty !== 0 || r.lineTotal !== 0);

  return { from, to, rows, bySupplier, totals };
}

// ── Non-revenue report (grouped by reason) ──

const REASON_LABELS: Record<string, string> = {
  // Canonical buckets (client req, 2026-07-20)
  SPOILAGE_SPILLAGE: "Spoilage & Spillages",
  TRIMMING: "Trimming",
  MARKETING_OTH: "Marketing & OTH",
  // Legacy codes on historical rows
  COMPLIMENTARY: "Complimentary",
  SPILLAGE: "Spillage",
  STAFF_USE: "Staff use",
  SPOILAGE: "Spoilage",
  BREAKAGE: "Breakage",
  TASTING: "Tasting",
  INTERNAL_USE: "Internal use",
  OTHER: "Other",
};

export interface NonRevenueRow {
  saleDate: string;
  name: string;
  uom: string | null; // size + unit for direct item entries; null for menus
  reason: string;
  qty: number;
  contentOverride: number | null;
  estimatedCost: number | null; // qty × current cost for direct item entries
  estimatedRetail: number | null; // qty × current retail (client req #8)
  /** LocationItem.isActive — null for menu rows (no single LocationItem).
      Carried through for the clutter display filter and the Phase 6.1 badge;
      see clutter-in-reports-decision.md. */
  isActive: boolean | null;
}
/** All three canonical buckets, plus an "Other / Unspecified" catch-all. */
export type NonRevenueBucket = NonRevenueGroup | "OTHER";
const BUCKET_ORDER: NonRevenueBucket[] = [...NON_REVENUE_GROUPS, "OTHER"];
const BUCKET_LABELS: Record<NonRevenueBucket, string> = {
  ...NON_REVENUE_GROUP_LABELS,
  OTHER: "Other / Unspecified",
};

export interface NonRevenueReport {
  from: string;
  to: string;
  rows: NonRevenueRow[];
  // Breakdown by the canonical buckets (+ Other), NOT by raw reason label, so
  // legacy-coded rows roll up into the bucket they report under (client req
  // 2026-07-21). `group` is the stable key; `reason` is its display label.
  byReason: Array<{ group: NonRevenueBucket; reason: string; count: number; qty: number; cost: number }>;
  totals: { count: number; qty: number; cost: number; retail: number };
}

export async function nonRevenueReport(
  locationId: string,
  from: string,
  to: string,
  allowedProductTypes?: readonly string[] | null,
  group?: NonRevenueGroup,
  // Clutter-in-reports (docs/clutter-in-reports-decision.md): off by default.
  // Same reasoning as salesReport/purchaseReport — a row here IS a
  // non-revenue entry that posted in this window, so it is activity by
  // construction and nothing is ever actually dropped.
  includeHiddenInReports: boolean = false,
): Promise<NonRevenueReport> {
  const found = await prisma.saleRecord.findMany({
    where: {
      locationId,
      status: "ACTIVE",
      kind: "NON_REVENUE",
      saleDate: { gte: from, lte: to },
      ...(allowedProductTypes
        ? { OR: [{ locationItemId: null }, { locationItem: { itemVariant: { item: { category: { productType: { in: [...allowedProductTypes] } } } } } }] }
        : {}),
    },
    include: { locationItem: { include: LI_INCLUDE }, menuItem: true },
    orderBy: [{ saleDate: "asc" }, { createdAt: "asc" }],
  });
  // Bucket filter (client req): legacy reasons fold into their nearest bucket
  // via nonRevenueGroupOf; unmapped reasons appear only in the unfiltered view.
  const records = group ? found.filter((r) => nonRevenueGroupOf(r.reason) === group) : found;

  const allRows: NonRevenueRow[] = records.map((r) => {
    const estimatedCost = r.locationItem ? r.qty * r.locationItem.cost : null;
    const estimatedRetail = r.locationItem ? r.qty * r.locationItem.retail : null;
    return {
      saleDate: r.saleDate,
      name: r.locationItem ? itemLabel(r.locationItem) : (r.menuItem?.name ?? "—"),
      uom: r.locationItem ? `${r.locationItem.itemVariant.size} ${r.locationItem.itemVariant.unit.name}` : null,
      reason: REASON_LABELS[r.reason ?? "OTHER"] ?? r.reason ?? "Other",
      qty: r.qty,
      contentOverride: r.contentOverride,
      estimatedCost,
      estimatedRetail,
      isActive: r.locationItem?.isActive ?? null,
    };
  });

  // Aggregate from the raw records (which carry the reason CODE) so each row
  // folds into its canonical bucket via nonRevenueGroupOf; the display rows
  // above only kept the reason's label. Ordered canonically, Other last.
  const bucketMap = new Map<NonRevenueBucket, { count: number; qty: number; cost: number }>();
  for (const r of records) {
    const bucket: NonRevenueBucket = nonRevenueGroupOf(r.reason) ?? "OTHER";
    const cost = r.locationItem ? r.qty * r.locationItem.cost : 0;
    const agg = bucketMap.get(bucket) ?? { count: 0, qty: 0, cost: 0 };
    agg.count += 1;
    agg.qty += r.qty;
    agg.cost += cost;
    bucketMap.set(bucket, agg);
  }
  const byReason = BUCKET_ORDER.filter((b) => bucketMap.has(b)).map((b) => ({
    group: b,
    reason: BUCKET_LABELS[b],
    ...bucketMap.get(b)!,
  }));

  // Totals FIRST, from the complete row set — the display filter below must
  // never be able to move them (clutter-in-reports-decision.md).
  const totals = allRows.reduce(
    (acc, r) => ({
      count: acc.count + 1,
      qty: acc.qty + r.qty,
      cost: acc.cost + (r.estimatedCost ?? 0),
      retail: acc.retail + (r.estimatedRetail ?? 0),
    }),
    { count: 0, qty: 0, cost: 0, retail: 0 },
  );

  // A row here IS the activity — it exists because a non-revenue entry
  // posted in this window — so a hidden item's row always has qty > 0 and
  // never qualifies for dropping (mirrors shouldDropHiddenRow's own rule,
  // same reasoning as salesReport/purchaseReport above).
  const rows =
    includeHiddenInReports
      ? allRows
      : allRows.filter((r) => r.isActive !== false || r.qty !== 0 || (r.estimatedCost ?? 0) !== 0);

  return { from, to, rows, byReason, totals };
}

// ── Inventory on hand (computed stock + valuation) ──

export interface OnHandRow {
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
  /** LocationItem.isActive — carried through so the client can badge a
      hidden-but-active row (clutter-in-reports-plan.md Phase 6.1). */
  isActive: boolean;
}
export interface OnHandReport {
  lastCountDate: string | null;
  rows: OnHandRow[];
  totals: { costValue: number; retailValue: number };
}

export async function onHandReport(
  locationId: string,
  allowedProductTypes?: readonly string[] | null,
  // On-hand worth is a VALUATION, so it follows the client's cost basis.
  costBasis: CostBasis = "PRICE",
  // Clutter-in-reports (docs/clutter-in-reports-decision.md): off by default,
  // matching Client.includeHiddenInReports' own default. When false, a
  // hidden item with zero activity in this report's period is dropped from
  // `rows` — but never before `totals` below is computed from the FULL set,
  // so the filter can never move the report's own numbers.
  includeHiddenInReports: boolean = false,
): Promise<OnHandReport> {
  const dates = await committedCountDates(locationId);
  const lastDate = dates.at(-1) ?? null;
  if (!lastDate) return { lastCountDate: null, rows: [], totals: { costValue: 0, retailValue: 0 } };

  // On-hand = last count + everything committed since (report end date = far future).
  const report = await buildFullAudit(locationId, lastDate, "9999-12-31", undefined, allowedProductTypes, costBasis);
  // Value today's stock at today's average (the far-future end date would
  // include no later purchases anyway, but be explicit about the as-of date).
  const wac = await weightedAverageCosts(locationId, todayBusinessDate(), costBasis);

  const priceRows = await prisma.locationItem.findMany({
    where: { id: { in: report.rows.map((r) => r.locationItemId) } },
    select: { id: true, cost: true, retail: true, parLevel: true },
  });
  const priceMap = new Map(priceRows.map((p) => [p.id, p]));

  const allRows: OnHandRow[] = report.rows.map((row) => {
    const price = priceMap.get(row.locationItemId);
    const onHand =
      row.beginFull + row.beginOpenEquiv + row.purchased + row.forfeited + row.transferIn - row.transferOut -
      (row.soldDirect + row.soldPortion + row.nonRevenue + row.production);
    // Mirror core's rule: only a POSITIVE valuation override wins, so a
    // zero-cost average can never silently zero the stock's worth.
    const average = wac.get(row.locationItemId);
    const cost = average !== undefined && average > 0 ? average : (price?.cost ?? row.costBasis);
    const retail = price?.retail ?? 0;
    return {
      locationItemId: row.locationItemId,
      name: row.itemName,
      category: row.categoryName,
      productType: row.productType,
      onHand,
      cost,
      retail,
      costValue: onHand * cost,
      retailValue: onHand * retail,
      belowPar: price?.parLevel != null && onHand < price.parLevel,
      isActive: row.isActive,
    };
  });

  // Totals FIRST, from the complete row set — the display filter below must
  // never be able to move them (clutter-in-reports-decision.md).
  const totals = allRows.reduce(
    (acc, r) => ({ costValue: acc.costValue + r.costValue, retailValue: acc.retailValue + r.retailValue }),
    { costValue: 0, retailValue: 0 },
  );

  const reportRowById = new Map(report.rows.map((r) => [r.locationItemId, r]));
  const rows = allRows.filter((r) => {
    const reportRow = reportRowById.get(r.locationItemId)!;
    return !shouldDropHiddenRow(reportRow, includeHiddenInReports);
  });

  return { lastCountDate: lastDate, rows, totals };
}

// ── Par Level (#3) & Non-Moving (#4) — stock-movement reports ──
// Both read the same snapshot: current on-hand (last count → now) plus each
// item's usage over the latest CLOSED period (the "beginning-and-ending
// movement" the client named). On-hand is computed exactly as onHandReport
// does, so all three reports cross-foot.

interface StockSnapshotItem {
  locationItemId: string;
  name: string;
  category: string;
  productType: string;
  onHand: number;
  cost: number;
  retail: number;
  parLevel: number | null;
  usage: number; // consumption over the latest closed period; 0 if no closed period
  /** LocationItem.isActive — carried through from onHandAudit so the reports
      built on this snapshot (Non-Moving today; Par Level in a later phase)
      can apply the clutter display filter without a second query. */
  isActive: boolean;
  /** Whether this item has any activity in the SAME window onHandAudit read
      (last count → now) — the input `shouldDropHiddenRow` needs. Distinct
      from `usage` above, which is the closed-period figure a different report
      column displays; this one must match the period the row's own totals
      were drawn from, per the decision doc. */
  hasOnHandPeriodActivity: boolean;
}

export async function stockSnapshot(
  locationId: string,
  allowedProductTypes?: readonly string[] | null,
  costBasis: CostBasis = "PRICE",
): Promise<{ lastCountDate: string | null; periodBegin: string | null; periodEnd: string | null; items: StockSnapshotItem[] }> {
  const dates = await committedCountDates(locationId);
  const lastDate = dates.at(-1) ?? null;
  if (!lastDate) return { lastCountDate: null, periodBegin: null, periodEnd: null, items: [] };
  const periodBegin = dates.at(-2) ?? null;

  // On-hand = last count + everything committed since (far-future end date).
  const onHandAudit = await buildFullAudit(locationId, lastDate, "9999-12-31", undefined, allowedProductTypes, costBasis);
  const wac = await weightedAverageCosts(locationId, todayBusinessDate(), costBasis);

  // Movement = reconciled usage over the latest closed period, if one exists.
  const usageByItem = new Map<string, number>();
  if (periodBegin) {
    const periodAudit = await buildFullAudit(locationId, periodBegin, lastDate, undefined, allowedProductTypes, costBasis);
    for (const r of periodAudit.rows) usageByItem.set(r.locationItemId, r.usage);
  }

  const priceRows = await prisma.locationItem.findMany({
    where: { id: { in: onHandAudit.rows.map((r) => r.locationItemId) } },
    select: { id: true, cost: true, retail: true, parLevel: true },
  });
  const priceMap = new Map(priceRows.map((p) => [p.id, p]));

  const items: StockSnapshotItem[] = onHandAudit.rows.map((row) => {
    const price = priceMap.get(row.locationItemId);
    const onHand =
      row.beginFull + row.beginOpenEquiv + row.purchased + row.forfeited + row.transferIn - row.transferOut -
      (row.soldDirect + row.soldPortion + row.nonRevenue + row.production);
    const average = wac.get(row.locationItemId);
    const cost = average !== undefined && average > 0 ? average : (price?.cost ?? row.costBasis);
    return {
      locationItemId: row.locationItemId,
      name: row.itemName,
      category: row.categoryName,
      productType: row.productType,
      onHand,
      cost,
      retail: price?.retail ?? 0,
      parLevel: price?.parLevel ?? null,
      usage: usageByItem.get(row.locationItemId) ?? 0,
      isActive: row.isActive,
      hasOnHandPeriodActivity: hasReportActivity(row),
    };
  });
  return { lastCountDate: lastDate, periodBegin, periodEnd: lastDate, items };
}

export interface ParLevelRow {
  locationItemId: string;
  name: string;
  category: string;
  onHand: number;
  parLevel: number;
  usage: number; // movement over the last closed period — how fast it depletes
  suggestedOrder: number; // max(0, par − on hand)
  orderValue: number; // suggestedOrder × cost
  belowPar: boolean;
  /** LocationItem.isActive — carried through so the client can badge a
      hidden-but-active row (clutter-in-reports-plan.md Phase 6.1). */
  isActive: boolean;
}
export interface ParLevelReport {
  lastCountDate: string | null;
  periodBegin: string | null;
  periodEnd: string | null;
  rows: ParLevelRow[];
  totals: { belowParCount: number; orderValue: number };
}

/**
 * Par Level report (client req 2026-07-21) — a purchasing guide. For every
 * item that has a reorder point set, shows current on-hand against par, how
 * much moved last period, and a suggested order quantity (par − on-hand).
 * Items with no par level set are omitted (nothing to reorder against).
 */
export async function parLevelReport(
  locationId: string,
  allowedProductTypes?: readonly string[] | null,
  costBasis: CostBasis = "PRICE",
  // Clutter-in-reports (docs/clutter-in-reports-decision.md): off by default.
  // Same window rule as nonMovingReport — a hidden item is dropped only when
  // it ALSO had no activity in the SAME window stockSnapshot computed onHand
  // over (`hasOnHandPeriodActivity`), so this can never move the totals below,
  // which are computed from the complete par-eligible set first.
  includeHiddenInReports: boolean = false,
): Promise<ParLevelReport> {
  const snap = await stockSnapshot(locationId, allowedProductTypes, costBasis);
  const eligible = snap.items.filter((it) => it.parLevel != null);

  const allRows: ParLevelRow[] = eligible
    .map((it) => {
      const par = it.parLevel!;
      const suggestedOrder = Math.max(0, round2(par - it.onHand));
      return {
        locationItemId: it.locationItemId,
        name: it.name,
        category: it.category,
        onHand: round2(it.onHand),
        parLevel: par,
        usage: round2(it.usage),
        suggestedOrder,
        orderValue: round2(suggestedOrder * it.cost),
        belowPar: it.onHand < par,
        isActive: it.isActive,
      };
    })
    // Below-par first, then by the biggest gap to fill, then by name.
    .sort((a, b) => Number(b.belowPar) - Number(a.belowPar) || b.suggestedOrder - a.suggestedOrder || a.name.localeCompare(b.name));

  // Totals FIRST, from the complete row set — the display filter below must
  // never be able to move them (clutter-in-reports-decision.md).
  const totals = allRows.reduce(
    (acc, r) => ({ belowParCount: acc.belowParCount + (r.belowPar ? 1 : 0), orderValue: acc.orderValue + r.orderValue }),
    { belowParCount: 0, orderValue: 0 },
  );

  // Same shape as nonMovingReport's own filter: isActive/hasOnHandPeriodActivity
  // both live on the snapshot item, keyed by locationItemId.
  const eligibleById = new Map(eligible.map((it) => [it.locationItemId, it]));
  const rows = allRows.filter((r) => {
    const it = eligibleById.get(r.locationItemId)!;
    if (includeHiddenInReports || it.isActive) return true;
    return it.hasOnHandPeriodActivity; // keep (badged) only if it actually moved
  });

  return { lastCountDate: snap.lastCountDate, periodBegin: snap.periodBegin, periodEnd: snap.periodEnd, rows, totals: { belowParCount: totals.belowParCount, orderValue: round2(totals.orderValue) } };
}

export interface NonMovingRow {
  locationItemId: string;
  name: string;
  category: string;
  onHand: number;
  cost: number;
  costValue: number;
  retailValue: number;
  /** LocationItem.isActive — carried through so the client can badge a
      hidden-but-active row (clutter-in-reports-plan.md Phase 6.1). */
  isActive: boolean;
}
export interface NonMovingReport {
  lastCountDate: string | null;
  periodBegin: string | null;
  periodEnd: string | null;
  rows: NonMovingRow[];
  totals: { count: number; costValue: number; retailValue: number };
}

/**
 * Non-Moving items report (client req 2026-07-21) — dead stock. Items still on
 * hand that saw NO movement (zero usage) over the latest closed period: cash
 * tied up in stock that isn't selling. Needs a closed period to judge movement;
 * with only one committed count, nothing has moved through a full period, so
 * every held item qualifies.
 */
export async function nonMovingReport(
  locationId: string,
  allowedProductTypes?: readonly string[] | null,
  costBasis: CostBasis = "PRICE",
  // Clutter-in-reports (docs/clutter-in-reports-decision.md): off by default.
  // Every row here already has zero usage by construction — that's the
  // report's own subject — but a hidden item can still be excluded only when
  // it ALSO had no purchases/forfeits/transfers/variance in the same window
  // onHand itself was computed over (`hasOnHandPeriodActivity`), so this
  // never drops a row the report's own totals below would still reflect.
  includeHiddenInReports: boolean = false,
): Promise<NonMovingReport> {
  const snap = await stockSnapshot(locationId, allowedProductTypes, costBasis);
  const candidates = snap.items.filter((it) => !hasVariance(it.usage) && it.onHand > VARIANCE_EPSILON);

  const allRows: NonMovingRow[] = candidates.map((it) => ({
    locationItemId: it.locationItemId,
    name: it.name,
    category: it.category,
    onHand: round2(it.onHand),
    cost: it.cost, // unit price keeps its centavo fractions (client req 2026-07-28)
    costValue: round2(it.onHand * it.cost),
    retailValue: round2(it.onHand * it.retail),
    isActive: it.isActive,
  }));

  // Totals FIRST, from the complete row set — the display filter below must
  // never be able to move them (clutter-in-reports-decision.md).
  const totals = allRows.reduce(
    (acc, r) => ({ count: acc.count + 1, costValue: acc.costValue + r.costValue, retailValue: acc.retailValue + r.retailValue }),
    { count: 0, costValue: 0, retailValue: 0 },
  );

  // Every row here has zero `usage` by construction (the report's own filter
  // above already guarantees it), so whether a hidden row survives comes down
  // to `hasOnHandPeriodActivity` alone — the same purchases/forfeits/
  // transfers/variance activity `shouldDropHiddenRow` checks, already folded
  // into one boolean by stockSnapshot for this exact window.
  const candidateById = new Map(candidates.map((it) => [it.locationItemId, it]));
  const rows = allRows
    .filter((r) => {
      const it = candidateById.get(r.locationItemId)!;
      if (includeHiddenInReports || it.isActive) return true;
      return it.hasOnHandPeriodActivity; // keep (badged) only if it actually moved
    })
    .sort((a, b) => b.costValue - a.costValue || a.name.localeCompare(b.name));

  return { lastCountDate: snap.lastCountDate, periodBegin: snap.periodBegin, periodEnd: snap.periodEnd, rows, totals: { count: totals.count, costValue: round2(totals.costValue), retailValue: round2(totals.retailValue) } };
}

// ── Expiring Batches (expiry-date-plan.md, phases doc Phase 6.1) ──
// The manager-level "what's expiring across the board" view. Extends the
// per-item FIFO worklist (fifo-batches.ts, Phase 4.1) to the whole location:
// same "open batch" definition — an ACTIVE line on a COMMITTED purchase,
// dated lines only — just not filtered down to one LocationItem. Pure read,
// no new schema, sourced straight from PurchaseLine.expiryDate rows already
// written at receiving (Phase 3).

export interface ExpiringBatchRow {
  purchaseLineId: string;
  locationItemId: string;
  name: string;
  category: string;
  productType: string;
  qty: number;
  expiryDate: string;
  purchaseDate: string;
  /** Computed live against today, never stored — same precedent as
      BottleKeep.dueForForfeit (expiry-date-plan.md, "computed, not stored"). */
  isExpired: boolean;
}
export interface ExpiringBatchesReport {
  asOfDate: string;
  rows: ExpiringBatchRow[];
  totals: { expiredCount: number; upcomingCount: number };
}

/**
 * Every open, dated batch across a location, expired first (oldest expiry
 * first within that group), then everything still ahead sorted
 * soonest-to-expire — the ordering the source plan asks for ("expired
 * first, then soonest-to-expire").
 *
 * `allowedProductTypes` mirrors every other report here (a Kitchen-only
 * location has no use for a Beverage batch, and vice versa) even though
 * perishable rows in practice skew Food/Beverage — Supplies and Asset
 * default `defaultPerishable: false` per the source plan, so they rarely
 * appear here at all, but the filter costs nothing to keep consistent.
 */
export async function expiringBatchesReport(
  locationId: string,
  allowedProductTypes?: readonly string[] | null,
): Promise<ExpiringBatchesReport> {
  const today = todayBusinessDate();
  const lines = await prisma.purchaseLine.findMany({
    where: {
      status: "ACTIVE",
      expiryDate: { not: null },
      purchase: { status: "COMMITTED", locationId },
      ...(allowedProductTypes
        ? { locationItem: { itemVariant: { item: { category: { productType: { in: [...allowedProductTypes] } } } } } }
        : {}),
    },
    include: {
      purchase: { select: { purchaseDate: true } },
      locationItem: { include: LI_INCLUDE },
    },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
  });

  const rows: ExpiringBatchRow[] = lines.map((l) => ({
    purchaseLineId: l.id,
    locationItemId: l.locationItemId,
    name: itemLabel(l.locationItem),
    category: l.locationItem.itemVariant.item.category.name,
    productType: l.locationItem.itemVariant.item.category.productType,
    qty: round2(l.qty),
    expiryDate: l.expiryDate!, // filtered not-null above
    purchaseDate: l.purchase.purchaseDate,
    isExpired: l.expiryDate! <= today,
  }));

  // Expired first (still oldest-expiry-first within that group, since the
  // query is already sorted ascending by expiryDate), then upcoming batches
  // in the same soonest-first order the query already produced.
  rows.sort((a, b) => {
    if (a.isExpired !== b.isExpired) return a.isExpired ? -1 : 1;
    return a.expiryDate.localeCompare(b.expiryDate);
  });

  const totals = rows.reduce(
    (acc, r) => ({
      expiredCount: acc.expiredCount + (r.isExpired ? 1 : 0),
      upcomingCount: acc.upcomingCount + (r.isExpired ? 0 : 1),
    }),
    { expiredCount: 0, upcomingCount: 0 },
  );
  return { asOfDate: today, rows, totals };
}

// ── Clutter candidates (clutter-item-removal plan, Phase 3) ──
// System-suggested items for the manual hide action. Reuses the same
// idle-stock read as Non-Moving, then adds two guards so a seasonal item
// is not suggested by mistake: a 12-month lookback instead of one closed
// period, and a per-item movement schedule. No scheduler job — this runs
// on request, same as every other report here.

export interface ClutterCandidateRow {
  locationItemId: string;
  name: string;
  category: string;
  onHand: number;
  costValue: number;
  monthsChecked: number;
}
export interface ClutterCandidateReport {
  asOfDate: string | null;
  rows: ClutterCandidateRow[];
}

function monthsAgo(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  // Clamp to day 1 first so this can't overflow into the following month
  // on a short target month (e.g. Mar 31 minus 1 -> Mar 3 instead of the
  // intended Feb 28). Then set the real day, capped to the target month's
  // own last day.
  const probe = new Date(d.getFullYear(), d.getMonth() - months, 1);
  const lastDayOfTargetMonth = new Date(probe.getFullYear(), probe.getMonth() + 1, 0).getDate();
  probe.setDate(Math.min(d.getDate(), lastDayOfTargetMonth));
  return `${probe.getFullYear()}-${String(probe.getMonth() + 1).padStart(2, "0")}-${String(probe.getDate()).padStart(2, "0")}`;
}

/**
 * True when `month` (1-12) falls inside the item's expected movement window.
 * No schedule set means always inside, so an unscheduled item falls back to
 * the plain lookback with no seasonal exception.
 */
function inScheduleWindow(month: number, start: number | null, end: number | null): boolean {
  if (start == null || end == null) return true;
  if (start <= end) return month >= start && month <= end;
  // Window wraps the year end, e.g. Nov (11) to Jan (1).
  return month >= start || month <= end;
}

export async function clutterCandidates(
  locationId: string,
  allowedProductTypes?: readonly string[] | null,
  costBasis: CostBasis = "PRICE",
): Promise<ClutterCandidateReport> {
  const snap = await stockSnapshot(locationId, allowedProductTypes, costBasis);
  if (!snap.lastCountDate) return { asOfDate: null, rows: [] };

  const lookbackStart = monthsAgo(snap.lastCountDate, 12);
  const lookbackAudit = await buildFullAudit(locationId, lookbackStart, snap.lastCountDate, undefined, allowedProductTypes, costBasis);
  const usage12mo = new Map<string, number>();
  for (const r of lookbackAudit.rows) usage12mo.set(r.locationItemId, r.usage);

  // Items with no committed count ON lookbackStart itself have no real begin
  // quantity for reconcile() to work from — buildFullAudit silently treats
  // "no begin line" as "began at zero", so a normal item with, say, 6 units
  // on hand and nothing else touching it comes back as usage = 0 - 6 = -6,
  // which hasVariance() (Math.abs-based) reads as a REAL 6-unit variance and
  // excludes the item — the opposite of "idle, no movement". This bites any
  // item newer than the 12-month window, not just deliberately-seeded dead
  // stock: a location with under a year of count history would exclude
  // everything from Clutter Candidates. Anchor on whether a begin line
  // actually exists; where it doesn't, fall back to stockSnapshot's
  // already-correct single-period usage (periodBegin -> lastCountDate, one
  // real closed period) rather than trust a fabricated 12-month figure.
  const anchoredDates = await prisma.countLine.findMany({
    where: { status: "ACTIVE", countSession: { locationId, countDate: lookbackStart, status: "COMMITTED" } },
    select: { locationItemId: true },
    distinct: ["locationItemId"],
  });
  const hasAnchor = new Set(anchoredDates.map((r) => r.locationItemId));

  const schedules = await prisma.locationItem.findMany({
    where: { id: { in: snap.items.map((it) => it.locationItemId) } },
    select: { id: true, scheduleStartMonth: true, scheduleEndMonth: true },
  });
  const scheduleMap = new Map(schedules.map((s) => [s.id, s]));
  const currentMonth = new Date(snap.lastCountDate).getMonth() + 1;

  const rows: ClutterCandidateRow[] = snap.items
    .filter((it) => it.onHand > VARIANCE_EPSILON)
    .filter((it) => {
      const usage = hasAnchor.has(it.locationItemId) ? (usage12mo.get(it.locationItemId) ?? 0) : it.usage;
      return !hasVariance(usage);
    })
    .filter((it) => {
      const sched = scheduleMap.get(it.locationItemId);
      return inScheduleWindow(currentMonth, sched?.scheduleStartMonth ?? null, sched?.scheduleEndMonth ?? null);
    })
    .map((it) => ({
      locationItemId: it.locationItemId,
      name: it.name,
      category: it.category,
      onHand: round2(it.onHand),
      costValue: round2(it.onHand * it.cost),
      monthsChecked: hasAnchor.has(it.locationItemId) ? 12 : 1,
    }))
    .sort((a, b) => b.costValue - a.costValue || a.name.localeCompare(b.name));

  return { asOfDate: snap.lastCountDate, rows };
}


// Equipment that left the register: non-revenue records on ASSET-type items,
// showing "what happened" (the note) — the asset equivalent of usage. Filters
// to the Asset product type, so it's empty on a bar/kitchen location.

export interface AssetBreakageRow {
  date: string;
  name: string;
  category: string;
  uom: string;
  qty: number;
  reason: string; // display label ("Broken / Damaged", …)
  note: string | null; // what happened
  costValue: number; // qty × cost — value written off
}
export interface AssetBreakageReport {
  from: string;
  to: string;
  rows: AssetBreakageRow[];
  byReason: Array<{ reason: string; count: number; qty: number; costValue: number }>;
  totals: { qty: number; costValue: number };
}

export async function assetBreakageReport(
  locationId: string,
  from: string,
  to: string,
): Promise<AssetBreakageReport> {
  const records = await prisma.saleRecord.findMany({
    where: {
      locationId,
      status: "ACTIVE",
      kind: "NON_REVENUE",
      saleDate: { gte: from, lte: to },
      // Assets only — this is the report's whole point.
      locationItem: { itemVariant: { item: { category: { productType: "Asset" } } } },
    },
    include: { locationItem: { include: LI_INCLUDE } },
    orderBy: [{ saleDate: "asc" }, { createdAt: "asc" }],
  });

  const rows: AssetBreakageRow[] = records.map((r) => {
    const li = r.locationItem!;
    return {
      date: r.saleDate,
      name: li.itemVariant.item.name,
      category: li.itemVariant.item.category.name,
      uom: `${li.itemVariant.size} ${li.itemVariant.unit.name}`,
      qty: r.qty,
      reason: ASSET_LOSS_REASON_LABELS[r.reason as AssetLossReason] ?? REASON_LABELS[r.reason ?? "OTHER"] ?? r.reason ?? "Other",
      note: r.note,
      costValue: round2(r.qty * li.cost),
    };
  });

  const reasonMap = new Map<string, { count: number; qty: number; costValue: number }>();
  for (const r of rows) {
    const agg = reasonMap.get(r.reason) ?? { count: 0, qty: 0, costValue: 0 };
    agg.count += 1;
    agg.qty += r.qty;
    agg.costValue += r.costValue;
    reasonMap.set(r.reason, agg);
  }
  const byReason = [...reasonMap.entries()].map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.qty - a.qty);

  const totals = rows.reduce((acc, r) => ({ qty: acc.qty + r.qty, costValue: acc.costValue + r.costValue }), { qty: 0, costValue: 0 });
  return { from, to, rows, byReason, totals: { qty: round2(totals.qty), costValue: round2(totals.costValue) } };
}

// ── Transfer report (in/out at cost & retail — client req #10) ──

export interface TransferReportRow {
  date: string; // businessDate (out) / receiptDate (in)
  counterparty: string; // the other location's name
  counterpartyKind: string | null;
  name: string;
  category: string;
  qtySent: number;
  /** null until the destination confirms receipt (out direction only). */
  qtyReceived: number | null;
  unitCost: number;
  costValue: number;
  retailValue: number;
}
export interface TransferReport {
  from: string;
  to: string;
  direction: "in" | "out";
  rows: TransferReportRow[];
  byCounterparty: Array<{ counterparty: string; qty: number; cost: number }>;
  totals: { qty: number; cost: number; retail: number };
}

export async function transferReport(
  locationId: string,
  from: string,
  to: string,
  direction: "in" | "out",
  allowedProductTypes?: readonly string[] | null,
  /** Report on ONE branch only (client req 2026-07-25: "Main to branches —
      must select Main to branches accounts"). Undefined = every counterparty. */
  counterpartyId?: string,
): Promise<TransferReport> {
  const productTypeFilter = allowedProductTypes
    ? { itemVariant: { item: { category: { productType: { in: [...allowedProductTypes] } } } } }
    : {};

  let rows: TransferReportRow[];
  if (direction === "out") {
    // Source view: dispatched lines, valued at the line's cost snapshot and
    // the source catalog's current retail.
    const lines = await prisma.transferLine.findMany({
      where: {
        status: "ACTIVE",
        transfer: {
          fromLocationId: locationId,
          ...(counterpartyId ? { toLocationId: counterpartyId } : {}),
          status: "COMMITTED",
          businessDate: { gte: from, lte: to },
        },
        locationItem: productTypeFilter,
      },
      include: {
        locationItem: { include: LI_INCLUDE },
        transfer: { include: { toLocation: { select: { name: true, kind: true } } } },
        receipts: { where: { status: "ACTIVE" }, select: { qtyReceived: true } },
      },
      orderBy: { transfer: { businessDate: "asc" } },
    });
    rows = lines.map((l) => ({
      date: l.transfer.businessDate,
      counterparty: l.transfer.toLocation.name,
      counterpartyKind: l.transfer.toLocation.kind,
      name: itemLabel(l.locationItem),
      category: l.locationItem.itemVariant.item.category.name,
      qtySent: l.qty,
      qtyReceived: l.receipts.length > 0 ? l.receipts.reduce((s, r) => s + r.qtyReceived, 0) : null,
      unitCost: l.unitCost,
      costValue: l.qty * l.unitCost,
      retailValue: l.qty * l.locationItem.retail,
    }));
  } else {
    // Destination view: confirmed receipts, valued at the sender's cost
    // snapshot and the destination catalog's current retail.
    const receipts = await prisma.transferReceiptLine.findMany({
      where: {
        status: "ACTIVE",
        receiptDate: { gte: from, lte: to },
        transferLine: {
          status: "ACTIVE",
          transfer: {
            toLocationId: locationId,
            ...(counterpartyId ? { fromLocationId: counterpartyId } : {}),
            status: "COMMITTED",
          },
        },
        toLocationItem: productTypeFilter,
      },
      include: {
        toLocationItem: { include: LI_INCLUDE },
        transferLine: {
          include: { transfer: { include: { fromLocation: { select: { name: true, kind: true } } } } },
        },
      },
      orderBy: { receiptDate: "asc" },
    });
    rows = receipts.map((r) => ({
      date: r.receiptDate,
      counterparty: r.transferLine.transfer.fromLocation.name,
      counterpartyKind: r.transferLine.transfer.fromLocation.kind,
      name: itemLabel(r.toLocationItem),
      category: r.toLocationItem.itemVariant.item.category.name,
      qtySent: r.transferLine.qty,
      qtyReceived: r.qtyReceived,
      unitCost: r.transferLine.unitCost,
      costValue: r.qtyReceived * r.transferLine.unitCost,
      retailValue: r.qtyReceived * r.toLocationItem.retail,
    }));
  }

  const counterpartyMap = new Map<string, { qty: number; cost: number }>();
  for (const r of rows) {
    const agg = counterpartyMap.get(r.counterparty) ?? { qty: 0, cost: 0 };
    agg.qty += direction === "out" ? r.qtySent : (r.qtyReceived ?? 0);
    agg.cost += r.costValue;
    counterpartyMap.set(r.counterparty, agg);
  }
  const byCounterparty = [...counterpartyMap.entries()]
    .map(([counterparty, v]) => ({ counterparty, ...v }))
    .sort((a, b) => b.cost - a.cost);

  const totals = rows.reduce(
    (acc, r) => ({
      qty: acc.qty + (direction === "out" ? r.qtySent : (r.qtyReceived ?? 0)),
      cost: acc.cost + r.costValue,
      retail: acc.retail + r.retailValue,
    }),
    { qty: 0, cost: 0, retail: 0 },
  );
  return { from, to, direction, rows, byCounterparty, totals };
}

// ── Cost Analysis (client req #3 — legacy food/beverage_downloadCA) ──
// One combined bar+kitchen report: a sales summary block plus one cost
// section per product type present. Formula precedents live in
// @fnb/core/cost-analysis.ts; window semantics are the audit half-open
// [begin, end) with counts ON each boundary, same as the Full Audit — the
// begin/end inventory costs come straight from its recon rows, so this
// report can never disagree with the Full Audit for the same window.

export interface CostAnalysisRow {
  category: string;
  beginningCost: number;
  purchasesCost: number;
  /** Received − dispatched, valued at the transfer lines' cost snapshots. */
  transfersCost: number;
  endingCost: number;
  cost: number;
  costNet: number;
  grossPct: number | null;
  netPct: number | null;
}
export interface CostAnalysisSection {
  productType: string;
  grossSales: number;
  netSales: number;
  /**
   * Profit (client req 2026-07-25: "gross - cost = net"). Every input was
   * already computed here — this is only the subtraction the report never did.
   *   grossProfit = gross sales − cost of goods
   *   netProfit   = VAT-exclusive sales − VAT-exclusive cost
   * NOTE: no operating expenses (payroll/rent/utilities) exist anywhere in this
   * system, so "net" here means net-of-VAT, NOT accounting net profit.
   */
  grossProfit: number;
  netProfit: number;
  rows: CostAnalysisRow[];
  totals: Omit<CostAnalysisRow, "category">;
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
  sections: CostAnalysisSection[];
}

export async function costAnalysisReport(
  locationId: string,
  begin: string,
  end: string,
  allowedProductTypes?: readonly string[] | null,
  // Beginning/Ending cost here are VALUATIONS, so they follow the client's
  // cost basis; the sales side and the cost % formula are unchanged.
  costBasis: CostBasis = "PRICE",
): Promise<CostAnalysisReport> {
  const audit = await buildFullAudit(locationId, begin, end, undefined, allowedProductTypes, costBasis);

  // Purchases cost per category over the same half-open window — from the
  // committed purchase lines directly (their lineTotal snapshots), not from
  // the recon rows, which don't carry per-row purchase cost.
  const purchaseLines = await prisma.purchaseLine.findMany({
    where: {
      status: "ACTIVE",
      purchase: { locationId, status: "COMMITTED", purchaseDate: { gte: begin, lt: end } },
      ...(allowedProductTypes
        ? { locationItem: { itemVariant: { item: { category: { productType: { in: [...allowedProductTypes] } } } } } }
        : {}),
    },
    include: { locationItem: { include: LI_INCLUDE } },
  });
  const purchasesByCategory = new Map<string, number>();
  for (const l of purchaseLines) {
    const cat = l.locationItem.itemVariant.item.category.name;
    purchasesByCategory.set(cat, (purchasesByCategory.get(cat) ?? 0) + l.lineTotal);
  }

  // Transfers move goods, not consumption: received stock joins the pool at
  // the sender's cost snapshot, dispatched stock leaves it — exactly the
  // terms the Full Audit's usage line carries, so Cost = B + P + Tin − Tout − E
  // stays equal to "cost of what was actually consumed" and the two reports
  // keep cross-footing (a window containing a transfer would otherwise show
  // phantom cost at the source and negative cost at the destination).
  const [transferOutLines, transferInReceipts] = await Promise.all([
    prisma.transferLine.findMany({
      where: {
        status: "ACTIVE",
        transfer: { fromLocationId: locationId, status: "COMMITTED", businessDate: { gte: begin, lt: end } },
      },
      include: { locationItem: { include: LI_INCLUDE } },
    }),
    prisma.transferReceiptLine.findMany({
      where: {
        status: "ACTIVE",
        receiptDate: { gte: begin, lt: end },
        transferLine: { status: "ACTIVE", transfer: { toLocationId: locationId, status: "COMMITTED" } },
      },
      include: { toLocationItem: { include: LI_INCLUDE }, transferLine: { select: { unitCost: true } } },
    }),
  ]);
  const transfersByCategory = new Map<string, number>();
  for (const l of transferOutLines) {
    const cat = l.locationItem.itemVariant.item.category.name;
    transfersByCategory.set(cat, (transfersByCategory.get(cat) ?? 0) - l.qty * l.unitCost);
  }
  for (const r of transferInReceipts) {
    const cat = r.toLocationItem.itemVariant.item.category.name;
    transfersByCategory.set(cat, (transfersByCategory.get(cat) ?? 0) + r.qtyReceived * r.transferLine.unitCost);
  }

  // Gross sales per product type from the recon rows' revenue — menu revenue
  // is thereby allocated per-ingredient by the same legacy share math the
  // Full Audit uses, so the two reports always cross-foot.
  const grossByType = new Map<string, number>();
  for (const row of audit.rows) {
    grossByType.set(row.productType, (grossByType.get(row.productType) ?? 0) + row.revenue);
  }
  const byType = [...grossByType.entries()]
    .map(([productType, gross]) => ({ productType, gross, net: netOfVat(gross) }))
    .sort((a, b) => a.productType.localeCompare(b.productType));
  const totalGross = byType.reduce((s, t) => s + t.gross, 0);
  const totalNet = netOfVat(totalGross);

  const sections: CostAnalysisSection[] = [];
  for (const group of audit.categories) {
    let section = sections.find((s) => s.productType === group.productType);
    if (!section) {
      const gross = grossByType.get(group.productType) ?? 0;
      section = {
        productType: group.productType,
        grossSales: gross,
        netSales: netOfVat(gross),
        grossProfit: 0, // filled after the section's costs are totalled
        netProfit: 0,
        rows: [],
        totals: { beginningCost: 0, purchasesCost: 0, transfersCost: 0, endingCost: 0, cost: 0, costNet: 0, grossPct: null, netPct: null },
      };
      sections.push(section);
    }
    const beginningCost = group.totals.beginCost;
    const endingCost = group.totals.endCost;
    const purchasesCost = purchasesByCategory.get(group.categoryName) ?? 0;
    const transfersCost = transfersByCategory.get(group.categoryName) ?? 0;
    const { cost, costNet } = costLine(beginningCost, purchasesCost + transfersCost, endingCost);
    section.rows.push({
      category: group.categoryName,
      beginningCost,
      purchasesCost,
      transfersCost,
      endingCost,
      cost,
      costNet,
      grossPct: pctOf(cost, section.grossSales),
      netPct: pctOf(costNet, section.netSales),
    });
  }
  for (const section of sections) {
    const t = section.totals;
    for (const row of section.rows) {
      t.beginningCost += row.beginningCost;
      t.purchasesCost += row.purchasesCost;
      t.transfersCost += row.transfersCost;
      t.endingCost += row.endingCost;
      t.cost += row.cost;
      t.costNet += row.costNet;
    }
    t.grossPct = pctOf(t.cost, section.grossSales);
    t.netPct = pctOf(t.costNet, section.netSales);
    section.grossProfit = round2(section.grossSales - t.cost);
    section.netProfit = round2(section.netSales - t.costNet);
  }
  sections.sort((a, b) => a.productType.localeCompare(b.productType));

  return {
    begin,
    end,
    sales: { byType, totalGross, totalNet, vatAmount: totalGross - totalNet },
    sections,
  };
}

// ── Full Audit drill-down: the source records behind one item's row ──

export interface DrillRecord {
  kind: "COUNT" | "PURCHASE" | "SALE" | "NON_REVENUE" | "PRODUCTION" | "FORFEIT" | "TRANSFER_IN" | "TRANSFER_OUT";
  date: string;
  detail: string;
  qty: number | null;
  amount: number | null;
  // Source-record id for drill-down navigation (Full Audit → source record).
  // COUNT → CountSession.id · PURCHASE → Purchase.id · SALE/NON_REVENUE/PRODUCTION → SaleRecord.id.
  // null for kinds with no landing page yet (FORFEIT, TRANSFER_IN, TRANSFER_OUT) — see
  // docs/2026-07-28-full-audit-drilldown-redirect-plan.md, "Open questions".
  id: string | null;
}

export async function fullAuditDrill(
  locationId: string,
  locationItemId: string,
  begin: string,
  end: string,
): Promise<DrillRecord[]> {
  const [counts, purchaseLines, forfeits, directSales, menuSales, transferOutLines, transferReceipts] = await Promise.all([
    prisma.countLine.findMany({
      where: {
        status: "ACTIVE",
        locationItemId,
        countSession: { locationId, status: "COMMITTED", countDate: { in: [begin, end] } },
      },
      include: { countSession: true },
    }),
    prisma.purchaseLine.findMany({
      where: {
        status: "ACTIVE",
        locationItemId,
        purchase: { locationId, status: "COMMITTED", purchaseDate: { gte: begin, lt: end } },
      },
      include: { purchase: true },
    }),
    prisma.forfeit.findMany({
      where: { locationId, locationItemId, status: "ACTIVE", forfeitDate: { gte: begin, lt: end } },
    }),
    prisma.saleRecord.findMany({
      where: { locationId, locationItemId, status: "ACTIVE", saleDate: { gte: begin, lt: end } },
    }),
    // Menu sales that expand into this item via their snapshotted recipe version.
    prisma.saleRecord.findMany({
      where: {
        locationId,
        status: "ACTIVE",
        menuItemId: { not: null },
        saleDate: { gte: begin, lt: end },
        recipeVersion: { lines: { some: { locationItemId } } },
      },
      include: { menuItem: true, recipeVersion: { include: { lines: true } } },
    }),
    prisma.transferLine.findMany({
      where: {
        status: "ACTIVE",
        locationItemId,
        transfer: { fromLocationId: locationId, status: "COMMITTED", businessDate: { gte: begin, lt: end } },
      },
      include: { transfer: { include: { toLocation: { select: { name: true } } } } },
    }),
    prisma.transferReceiptLine.findMany({
      where: {
        status: "ACTIVE",
        toLocationItemId: locationItemId,
        receiptDate: { gte: begin, lt: end },
        transferLine: { status: "ACTIVE", transfer: { toLocationId: locationId, status: "COMMITTED" } },
      },
      include: {
        transferLine: { include: { transfer: { include: { fromLocation: { select: { name: true } } } } } },
      },
    }),
  ]);

  const records: DrillRecord[] = [];

  for (const c of counts) {
    records.push({
      kind: "COUNT",
      date: c.countSession.countDate,
      detail:
        c.countType === "FULL"
          ? `${c.countSession.countDate === begin ? "Beginning" : "Ending"} count · ${c.qtyFull} full`
          : `${c.countSession.countDate === begin ? "Beginning" : "Ending"} count · weigh ${c.scaleWeight} ${c.scaleUnit} → ${c.remainingContent}`,
      qty: c.countType === "FULL" ? c.qtyFull : c.remainingContent,
      amount: null,
      id: c.countSession.id,
    });
  }
  for (const p of purchaseLines) {
    records.push({
      kind: "PURCHASE",
      date: p.purchase.purchaseDate,
      detail: `Purchase ×${p.qty} @ ${p.unitCost}`,
      qty: p.qty,
      amount: p.lineTotal,
      id: p.purchase.id,
    });
  }
  for (const f of forfeits) {
    records.push({
      kind: "FORFEIT",
      date: f.forfeitDate,
      detail: f.remainingContent > 0 ? `Returned ${f.remainingContent} content` : `Returned ×${f.qty}`,
      qty: f.remainingContent > 0 ? f.remainingContent : f.qty,
      amount: null,
      id: null,
    });
  }
  for (const s of directSales) {
    const kind = s.kind as DrillRecord["kind"];
    records.push({
      kind,
      date: s.saleDate,
      detail:
        s.kind === "SALE"
          ? `Sale ×${s.qty} @ ${s.unitPrice}${s.discountPct ? ` (−${s.discountPct}%)` : ""}`
          : s.kind === "NON_REVENUE"
            ? `Non-revenue ×${s.qty}${s.contentOverride ? ` · ${s.contentOverride}/unit` : ""} (${s.reason ?? "—"})`
            : `Production ×${s.qty}`,
      qty: s.qty,
      amount: s.kind === "SALE" ? s.unitPrice * s.qty : null,
      id: s.id,
    });
  }
  for (const m of menuSales) {
    const line = m.recipeVersion?.lines.find((l) => l.locationItemId === locationItemId);
    records.push({
      kind: m.kind as DrillRecord["kind"],
      date: m.saleDate,
      detail: `${m.menuItem?.name ?? "Menu"} ×${m.qty} · ${line?.servingQty ?? "?"}/serving`,
      qty: m.qty,
      amount: m.kind === "SALE" ? m.unitPrice * m.qty : null,
      id: m.id,
    });
  }
  for (const t of transferOutLines) {
    records.push({
      kind: "TRANSFER_OUT",
      date: t.transfer.businessDate,
      detail: `Transferred ×${t.qty} to ${t.transfer.toLocation.name}`,
      qty: t.qty,
      amount: t.lineTotal,
      id: null,
    });
  }
  for (const r of transferReceipts) {
    records.push({
      kind: "TRANSFER_IN",
      date: r.receiptDate,
      detail: `Received ×${r.qtyReceived} of ${r.transferLine.qty} sent from ${r.transferLine.transfer.fromLocation.name}`,
      qty: r.qtyReceived,
      amount: r.qtyReceived * r.transferLine.unitCost,
      id: null,
    });
  }

  return records.sort((a, b) => a.date.localeCompare(b.date));
}
