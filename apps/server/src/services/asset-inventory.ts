import { round2 } from "@fnb/core";
import { prisma } from "../db";

/**
 * Asset Inventory — Beginning/Ending count (Phase 6.2). Given a location and
 * two committed count dates, pulls `CountLine.qtyFull` for each Asset
 * `LocationItem` at each date — the same two-lookup shape Phase 3.1 already
 * verified needs no new query, since Asset rows are never weighable
 * (confirmed 3.2: `weighable` is always false for Asset variants, so every
 * Asset CountLine is `countType = "FULL"`). No `openEquivalent`, no weighted
 * average — those belong to Full Audit reconciliation, out of scope here.
 */

const LI_INCLUDE = {
  itemVariant: {
    include: { unit: true, item: { include: { category: true } } },
  },
} as const;

export interface AssetInventoryRow {
  locationItemId: string;
  assetCode: string | null;
  name: string;
  category: string;
  industry: string | null;
  uom: string;
  beginningQty: number;
  endingQty: number;
  change: number;
}

export interface AssetInventoryReport {
  beginningDate: string | null;
  endingDate: string | null;
  rows: AssetInventoryRow[];
  totals: { beginningQty: number; endingQty: number; change: number };
}

/** Committed CountLine.qtyFull per LocationItem for one location + date, Asset rows only. */
async function assetCountLinesAt(locationId: string, countDate: string | null) {
  if (!countDate) return new Map<string, number>();
  const lines = await prisma.countLine.findMany({
    where: {
      status: "ACTIVE",
      countSession: { locationId, countDate, status: "COMMITTED" },
      locationItem: { itemVariant: { item: { category: { productType: "Asset" } } } },
    },
    select: { locationItemId: true, qtyFull: true },
  });
  const byItem = new Map<string, number>();
  for (const line of lines) {
    byItem.set(line.locationItemId, (byItem.get(line.locationItemId) ?? 0) + line.qtyFull);
  }
  return byItem;
}

export async function assetInventoryReport(
  locationId: string,
  beginningDate: string | null,
  endingDate: string | null,
  allowedProductTypes?: readonly string[] | null,
): Promise<AssetInventoryReport> {
  if (allowedProductTypes && !allowedProductTypes.includes("Asset")) {
    return { beginningDate, endingDate, rows: [], totals: { beginningQty: 0, endingQty: 0, change: 0 } };
  }

  const [beginMap, endMap] = await Promise.all([
    assetCountLinesAt(locationId, beginningDate),
    assetCountLinesAt(locationId, endingDate),
  ]);

  const locationItemIds = new Set([...beginMap.keys(), ...endMap.keys()]);
  const items = locationItemIds.size
    ? await prisma.locationItem.findMany({
        where: { id: { in: [...locationItemIds] } },
        include: LI_INCLUDE,
      })
    : [];

  const rows: AssetInventoryRow[] = items
    .map((li) => {
      const beginningQty = beginMap.get(li.id) ?? 0;
      const endingQty = endMap.get(li.id) ?? 0;
      return {
        locationItemId: li.id,
        assetCode: li.assetCode,
        name: li.itemVariant.item.name,
        category: li.itemVariant.item.category.name,
        industry: li.industry,
        uom: `${li.itemVariant.size} ${li.itemVariant.unit.name}`,
        beginningQty: round2(beginningQty),
        endingQty: round2(endingQty),
        change: round2(endingQty - beginningQty),
      };
    })
    .sort((a, b) => (a.assetCode ?? "").localeCompare(b.assetCode ?? "") || a.name.localeCompare(b.name));

  const totals = rows.reduce(
    (acc, r) => ({
      beginningQty: acc.beginningQty + r.beginningQty,
      endingQty: acc.endingQty + r.endingQty,
      change: acc.change + r.change,
    }),
    { beginningQty: 0, endingQty: 0, change: 0 },
  );

  return {
    beginningDate,
    endingDate,
    rows,
    totals: { beginningQty: round2(totals.beginningQty), endingQty: round2(totals.endingQty), change: round2(totals.change) },
  };
}
