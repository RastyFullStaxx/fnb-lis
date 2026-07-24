import { round2 } from "@fnb/core";
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
  totals: { count: number; initialCostValue: number; currentCostValue: number };
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
    return { asOf: todayBusinessDate(), rows: [], totals: { count: 0, initialCostValue: 0, currentCostValue: 0 } };
  }

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
        industry: li.industry,
        initialCost: li.initialCost,
        currentCost: li.cost,
        remarks: li.remarks,
        supplier: supplier?.name ?? null,
        latestNoteDate: latestNote?.saleDate ?? null,
        latestNote: latestNote?.note ?? (latestNote?.reason ?? null),
      };
    }),
  );

  const totals = rows.reduce(
    (acc, r) => ({
      count: acc.count + 1,
      initialCostValue: acc.initialCostValue + (r.initialCost ?? 0),
      currentCostValue: acc.currentCostValue + r.currentCost,
    }),
    { count: 0, initialCostValue: 0, currentCostValue: 0 },
  );

  return {
    asOf: todayBusinessDate(),
    rows,
    totals: { count: totals.count, initialCostValue: round2(totals.initialCostValue), currentCostValue: round2(totals.currentCostValue) },
  };
}
