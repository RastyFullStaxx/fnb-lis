import { costLine, netOfVat, nonRevenueGroupOf, pctOf, type CostBasis, type NonRevenueGroup } from "@fnb/core";
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
}
export interface SalesReport {
  from: string;
  to: string;
  rows: SalesReportRow[];
  totals: { qty: number; gross: number; discount: number; net: number };
}

export async function salesReport(
  locationId: string,
  from: string,
  to: string,
  allowedProductTypes?: readonly string[] | null,
  view: SalesReportView = "sales",
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

  const rows: SalesReportRow[] = sales.map((s) => {
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
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      qty: acc.qty + r.qty,
      gross: acc.gross + r.gross,
      discount: acc.discount + (r.gross - r.net),
      net: acc.net + r.net,
    }),
    { qty: 0, gross: 0, discount: 0, net: 0 },
  );
  return { from, to, rows, totals };
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
}
export interface PurchaseReport {
  from: string;
  to: string;
  rows: PurchaseReportRow[];
  bySupplier: Array<{ supplier: string; qty: number; cost: number }>;
  totals: { qty: number; cost: number };
}

export async function purchaseReport(
  locationId: string,
  from: string,
  to: string,
  allowedProductTypes?: readonly string[] | null,
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

  const rows: PurchaseReportRow[] = lines.map((l) => ({
    purchaseDate: l.purchase.purchaseDate,
    supplier: l.purchase.supplier?.name ?? "—",
    refNo: l.purchase.refNo,
    name: itemLabel(l.locationItem),
    category: l.locationItem.itemVariant.item.category.name,
    qty: l.qty,
    unitCost: l.unitCost,
    lineTotal: l.lineTotal,
  }));

  const supplierMap = new Map<string, { qty: number; cost: number }>();
  for (const r of rows) {
    const agg = supplierMap.get(r.supplier) ?? { qty: 0, cost: 0 };
    agg.qty += r.qty;
    agg.cost += r.lineTotal;
    supplierMap.set(r.supplier, agg);
  }
  const bySupplier = [...supplierMap.entries()]
    .map(([supplier, v]) => ({ supplier, ...v }))
    .sort((a, b) => b.cost - a.cost);

  const totals = rows.reduce(
    (acc, r) => ({ qty: acc.qty + r.qty, cost: acc.cost + r.lineTotal }),
    { qty: 0, cost: 0 },
  );
  return { from, to, rows, bySupplier, totals };
}

// ── Non-revenue report (grouped by reason) ──

const REASON_LABELS: Record<string, string> = {
  // Canonical buckets (client req, 2026-07-20)
  SPOILAGE_SPILLAGE: "Spoilage & Spillages",
  TRIMMING: "Trimming",
  MARKETING_OTH: "Marketing & OTH (On the House)",
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
}
export interface NonRevenueReport {
  from: string;
  to: string;
  rows: NonRevenueRow[];
  byReason: Array<{ reason: string; count: number; qty: number; cost: number }>;
  totals: { count: number; qty: number; cost: number; retail: number };
}

export async function nonRevenueReport(
  locationId: string,
  from: string,
  to: string,
  allowedProductTypes?: readonly string[] | null,
  group?: NonRevenueGroup,
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

  const rows: NonRevenueRow[] = records.map((r) => {
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
    };
  });

  const reasonMap = new Map<string, { count: number; qty: number; cost: number }>();
  for (const r of rows) {
    const agg = reasonMap.get(r.reason) ?? { count: 0, qty: 0, cost: 0 };
    agg.count += 1;
    agg.qty += r.qty;
    agg.cost += r.estimatedCost ?? 0;
    reasonMap.set(r.reason, agg);
  }
  const byReason = [...reasonMap.entries()]
    .map(([reason, v]) => ({ reason, ...v }))
    .sort((a, b) => b.qty - a.qty);

  const totals = rows.reduce(
    (acc, r) => ({
      count: acc.count + 1,
      qty: acc.qty + r.qty,
      cost: acc.cost + (r.estimatedCost ?? 0),
      retail: acc.retail + (r.estimatedRetail ?? 0),
    }),
    { count: 0, qty: 0, cost: 0, retail: 0 },
  );
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

  const rows: OnHandRow[] = report.rows.map((row) => {
    const price = priceMap.get(row.locationItemId);
    const onHand =
      row.beginFull + row.beginOpenEquiv + row.purchased + row.forfeited + row.transferIn - row.transferOut -
      (row.soldDirect + row.soldPortion + row.nonRevenue + row.production);
    const cost = wac.get(row.locationItemId) ?? price?.cost ?? row.costBasis;
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
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({ costValue: acc.costValue + r.costValue, retailValue: acc.retailValue + r.retailValue }),
    { costValue: 0, retailValue: 0 },
  );
  return { lastCountDate: lastDate, rows, totals };
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
        transfer: { fromLocationId: locationId, status: "COMMITTED", businessDate: { gte: from, lte: to } },
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
        transferLine: { status: "ACTIVE", transfer: { toLocationId: locationId, status: "COMMITTED" } },
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
    });
  }
  for (const p of purchaseLines) {
    records.push({ kind: "PURCHASE", date: p.purchase.purchaseDate, detail: `Purchase ×${p.qty} @ ${p.unitCost}`, qty: p.qty, amount: p.lineTotal });
  }
  for (const f of forfeits) {
    records.push({ kind: "FORFEIT", date: f.forfeitDate, detail: f.remainingContent > 0 ? `Returned ${f.remainingContent} content` : `Returned ×${f.qty}`, qty: f.remainingContent > 0 ? f.remainingContent : f.qty, amount: null });
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
    });
  }
  for (const t of transferOutLines) {
    records.push({
      kind: "TRANSFER_OUT",
      date: t.transfer.businessDate,
      detail: `Transferred ×${t.qty} to ${t.transfer.toLocation.name}`,
      qty: t.qty,
      amount: t.lineTotal,
    });
  }
  for (const r of transferReceipts) {
    records.push({
      kind: "TRANSFER_IN",
      date: r.receiptDate,
      detail: `Received ×${r.qtyReceived} of ${r.transferLine.qty} sent from ${r.transferLine.transfer.fromLocation.name}`,
      qty: r.qtyReceived,
      amount: r.qtyReceived * r.transferLine.unitCost,
    });
  }

  return records.sort((a, b) => a.date.localeCompare(b.date));
}
