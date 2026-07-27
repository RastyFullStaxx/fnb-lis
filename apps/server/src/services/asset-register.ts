import { round2 } from "@fnb/core";
import { stockSnapshot } from "./report-lists";
import { prisma } from "../db";
import { deriveCurrentSupplier } from "./asset-supplier";

/**
 * Asset Register — the Audit Report equivalent for Asset (Phase 6.1).
 *
 * A snapshot query over `LocationItem`, filtered to `Category.productType =
 * "Asset"`, not a projection of `buildFullAudit`. Asset has no
 * variance/reconciliation math (see asset-module-proposal.md's "what NOT to
 * build" table), so this deliberately doesn't touch report-assembly.ts.
 *
 * Supplier is derived per row via `deriveCurrentSupplier` (2.4) — no
 * `supplierId` stored on LocationItem. The "latest note" is the most recent
 * ACTIVE non-revenue (Usage/Breakage) SaleRecord against the row, the same
 * source `assetBreakageReport` reads, surfaced here as a single field so the
 * register itself answers "what happened last" without a second report.
 */

const LI_INCLUDE = {
  location: { select: { id: true, name: true } },
  itemVariant: {
    include: {
      unit: true,
      item: { include: { category: true } },
    },
  },
} as const;

export interface AssetRegisterRow {
  /** Units actually on hand now — last committed count plus everything since. */
  qty: number;
  /** qty × currentCost. The register lists one row per asset TYPE, not per unit. */
  currentValue: number;
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
}

export interface AssetRegisterReport {
  asOf: string;
  rows: AssetRegisterRow[];
  totals: { count: number; qty: number; initialCostValue: number; currentCostValue: number };
}

function todayBusinessDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export async function assetRegisterReport(
  locationId: string,
  allowedProductTypes?: readonly string[] | null,
): Promise<AssetRegisterReport> {
  // Asset rows only, by definition — but still intersect against the
  // location's own module ceiling, same guard full-audit/cost-analysis use,
  // so a location without the Asset module simply sees nothing rather than
  // relying on the caller to have checked first.
  if (allowedProductTypes && !allowedProductTypes.includes("Asset")) {
    return { asOf: todayBusinessDate(), rows: [], totals: { count: 0, qty: 0, initialCostValue: 0, currentCostValue: 0 } };
  }

  // On-hand per row, from the same source the On Hand and Par Level reports
  // use: last committed count PLUS everything committed since. That is what
  // makes a written-off unit leave the register's value — the breakage posts as
  // a committed non-revenue movement, so it is already subtracted here. No
  // status is auto-mutated: three microphones minus one broken is two working
  // microphones, still "In Use".
  const snapshot = await stockSnapshot(locationId, allowedProductTypes);
  const onHand = new Map(snapshot.items.map((i) => [i.locationItemId, i.onHand]));

  const items = await prisma.locationItem.findMany({
    where: {
      locationId,
      isActive: true,
      itemVariant: { item: { category: { productType: "Asset" } } },
    },
    include: LI_INCLUDE,
    orderBy: [{ assetCode: "asc" }],
  });

  const rows: AssetRegisterRow[] = await Promise.all(
    items.map(async (li) => {
      const [supplier, latestNote] = await Promise.all([
        deriveCurrentSupplier(li.id),
        prisma.saleRecord.findFirst({
          where: { locationItemId: li.id, status: "ACTIVE", kind: "NON_REVENUE" },
          orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }],
          select: { saleDate: true, note: true, reason: true },
        }),
      ]);
      const qty = onHand.get(li.id) ?? 0;
      return {
        locationItemId: li.id,
        assetCode: li.assetCode,
        location: li.location.name,
        name: li.itemVariant.item.name,
        brand: li.itemVariant.brand,
        model: li.itemVariant.model,
        category: li.itemVariant.item.category.name,
        uom: `${li.itemVariant.size} ${li.itemVariant.unit.name}`,
        serialNo: li.serialNo,
        condition: li.condition,
        status: li.status,
        industry: li.itemVariant.item.category.industry,
        initialCost: li.initialCost,
        currentCost: li.cost,
        remarks: li.remarks,
        supplier: supplier?.name ?? null,
        latestNoteDate: latestNote?.saleDate ?? null,
        latestNote: latestNote?.note ?? (latestNote?.reason ?? null),
        qty,
        currentValue: round2(qty * li.cost),
      };
    }),
  );

  // Value is quantity-extended. Summing one unit cost per asset TYPE understated
  // the base badly — 70 codes cover 400+ physical units — and disagreed with the
  // Asset Inventory report, which counts units. Initial cost is extended the same
  // way so the two money columns stay comparable.
  const totals = rows.reduce(
    (acc, r) => ({
      count: acc.count + 1,
      qty: acc.qty + r.qty,
      initialCostValue: acc.initialCostValue + (r.initialCost ?? 0) * r.qty,
      currentCostValue: acc.currentCostValue + r.currentValue,
    }),
    { count: 0, qty: 0, initialCostValue: 0, currentCostValue: 0 },
  );

  return {
    asOf: todayBusinessDate(),
    rows,
    totals: {
      count: totals.count,
      qty: round2(totals.qty),
      initialCostValue: round2(totals.initialCostValue),
      currentCostValue: round2(totals.currentCostValue),
    },
  };
}
