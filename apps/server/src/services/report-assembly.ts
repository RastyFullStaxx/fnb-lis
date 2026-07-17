import { reconcile, type MenuSaleAgg, type ReconItemInput, type ReconReport } from "@fnb/core";
import { prisma } from "../db";

/**
 * Assembles reconciliation inputs for one location and period.
 * Date semantics (architecture.md §6): counts ON beginDate and ON endDate
 * (COMMITTED sessions, ACTIVE lines); activity in the HALF-OPEN [begin, end).
 * TEXT YYYY-MM-DD dates make the window plain string comparisons.
 *
 * `allowedProductTypes`, when provided, restricts which catalog rows are fed
 * into `reconcile()` to those product types a client's subscription module
 * covers (see @fnb/core `allowedProductTypes`). This is purely an input
 * filter — reconcile()'s formulas are untouched.
 */
export async function buildFullAudit(
  locationId: string,
  beginDate: string,
  endDate: string,
  productType?: string,
  allowedProductTypes?: readonly string[] | null,
): Promise<ReconReport> {
  const [beginLines, endLines, purchaseLines, forfeits, sales] = await Promise.all([
    prisma.countLine.findMany({
      where: {
        status: "ACTIVE",
        countSession: { locationId, countDate: beginDate, status: "COMMITTED" },
      },
    }),
    prisma.countLine.findMany({
      where: {
        status: "ACTIVE",
        countSession: { locationId, countDate: endDate, status: "COMMITTED" },
      },
    }),
    prisma.purchaseLine.findMany({
      where: {
        status: "ACTIVE",
        purchase: { locationId, status: "COMMITTED", purchaseDate: { gte: beginDate, lt: endDate } },
      },
    }),
    prisma.forfeit.findMany({
      where: { locationId, status: "ACTIVE", forfeitDate: { gte: beginDate, lt: endDate } },
    }),
    prisma.saleRecord.findMany({
      where: { locationId, status: "ACTIVE", saleDate: { gte: beginDate, lt: endDate } },
      include: {
        recipeVersion: { include: { lines: true } },
        menuItem: true,
      },
    }),
  ]);

  type Agg = {
    beginFullQty: number;
    beginOpenContent: number;
    endFullQty: number;
    endOpenContent: number;
    beginUnitCost: number | null;
    endUnitCost: number | null;
    purchasedQty: number;
    purchasedCost: number;
    forfeitContent: number;
    forfeitCountQty: number;
    directSalesQty: number;
    directRevenue: number;
    productionQty: number;
    nonRevenueDirectQty: number;
    nonRevenueContentLines: Array<{ contentPerUnit: number; qty: number }>;
    menuSales: MenuSaleAgg[];
  };
  const aggs = new Map<string, Agg>();
  const touch = (locationItemId: string): Agg => {
    let agg = aggs.get(locationItemId);
    if (!agg) {
      agg = {
        beginFullQty: 0, beginOpenContent: 0, endFullQty: 0, endOpenContent: 0,
        beginUnitCost: null, endUnitCost: null,
        purchasedQty: 0, purchasedCost: 0,
        forfeitContent: 0, forfeitCountQty: 0,
        directSalesQty: 0, directRevenue: 0, productionQty: 0,
        nonRevenueDirectQty: 0, nonRevenueContentLines: [], menuSales: [],
      };
      aggs.set(locationItemId, agg);
    }
    return agg;
  };

  for (const line of beginLines) {
    const agg = touch(line.locationItemId);
    if (line.countType === "FULL") agg.beginFullQty += line.qtyFull;
    else agg.beginOpenContent += line.remainingContent;
    if (line.unitCost > 0) agg.beginUnitCost = line.unitCost; // snapshot from count time
  }
  for (const line of endLines) {
    const agg = touch(line.locationItemId);
    if (line.countType === "FULL") agg.endFullQty += line.qtyFull;
    else agg.endOpenContent += line.remainingContent;
    if (line.unitCost > 0) agg.endUnitCost = line.unitCost;
  }
  for (const line of purchaseLines) {
    const agg = touch(line.locationItemId);
    agg.purchasedQty += line.qty;
    agg.purchasedCost += line.lineTotal;
  }
  for (const forfeit of forfeits) {
    const agg = touch(forfeit.locationItemId);
    agg.forfeitContent += forfeit.remainingContent;
    agg.forfeitCountQty += forfeit.qty;
  }

  for (const sale of sales) {
    if (sale.locationItemId) {
      const agg = touch(sale.locationItemId);
      const hasOverride = sale.contentOverride !== null && sale.contentOverride > 0;
      if (sale.kind === "SALE") {
        // Nuance A: override rows are excluded from direct sums (SALE never has one by validation).
        agg.directSalesQty += sale.qty;
        agg.directRevenue += sale.unitPrice * sale.qty;
      } else if (sale.kind === "PRODUCTION") {
        agg.productionQty += sale.qty;
      } else if (sale.kind === "NON_REVENUE") {
        if (hasOverride) {
          // Nuance B: per-unit content × qty via the content path only.
          agg.nonRevenueContentLines.push({ contentPerUnit: sale.contentOverride!, qty: sale.qty });
        } else {
          agg.nonRevenueDirectQty += sale.qty;
        }
      }
    } else if (sale.menuItemId && sale.recipeVersion) {
      // Menu sale: expand the SNAPSHOTTED recipe version into per-ingredient aggregates.
      const version = sale.recipeVersion;
      const totalServing = version.lines.reduce((s, l) => s + l.servingQty, 0); // Nuance C: mtotal
      for (const recipeLine of version.lines) {
        const agg = touch(recipeLine.locationItemId);
        if (sale.kind === "NON_REVENUE") {
          agg.nonRevenueContentLines.push({ contentPerUnit: recipeLine.servingQty, qty: sale.qty });
        } else {
          agg.menuSales.push({
            menuName: sale.menuItem?.name ?? "menu",
            qtySold: sale.qty,
            discountPct: sale.kind === "SALE" ? sale.discountPct : 100, // production = full-discount consumption
            menuSrp: sale.kind === "SALE" ? sale.unitPrice : 0,
            ingredientServing: recipeLine.servingQty,
            menuTotalServing: totalServing,
            ingredientCount: version.lines.length,
          });
        }
      }
    }
  }

  // Item metadata for every touched catalog row.
  const locationItems = await prisma.locationItem.findMany({
    where: { id: { in: [...aggs.keys()] } },
    include: { itemVariant: { include: { unit: true, item: { include: { category: true } } } } },
  });

  const inputs: ReconItemInput[] = [];
  for (const li of locationItems) {
    const category = li.itemVariant.item.category;
    if (productType && category.productType !== productType) continue;
    if (allowedProductTypes && !allowedProductTypes.includes(category.productType)) continue;
    const agg = aggs.get(li.id)!;
    inputs.push({
      locationItemId: li.id,
      itemName: `${li.itemVariant.item.name} ${li.itemVariant.size} ${li.itemVariant.unit.name}`,
      categoryName: category.name,
      categorySortOrder: category.sortOrder,
      productType: category.productType,
      size: li.itemVariant.size,
      unitName: li.itemVariant.unit.name,
      contentTracked: li.itemVariant.contentTracked,
      currentCost: li.cost,
      currentRetail: li.retail,
      ...agg,
    });
  }

  return reconcile(inputs, { beginDate, endDate });
}

/** Distinct committed count dates — the anchors report pickers are constrained to. */
export async function committedCountDates(locationId: string): Promise<string[]> {
  const sessions = await prisma.countSession.findMany({
    where: { locationId, status: "COMMITTED" },
    select: { countDate: true },
    distinct: ["countDate"],
    orderBy: { countDate: "asc" },
  });
  return sessions.map((s) => s.countDate);
}

/**
 * Stock on hand: latest committed count per item + committed activity since
 * (same movement math as the report, endDate = far future).
 */
export async function stockOnHand(
  locationId: string,
  allowedProductTypes?: readonly string[] | null,
): Promise<Array<{ locationItemId: string; onHand: number; lastCountDate: string | null }>> {
  const dates = await committedCountDates(locationId);
  const lastDate = dates.at(-1) ?? null;
  const FUTURE = "9999-12-31";
  if (!lastDate) return [];
  const report = await buildFullAudit(locationId, lastDate, FUTURE, undefined, allowedProductTypes);
  // usage = begin + purchases + forfeits − end; with no end counts, on-hand = begin + purchases + forfeits − expected consumption
  return report.rows.map((row) => ({
    locationItemId: row.locationItemId,
    onHand:
      row.beginFull + row.beginOpenEquiv + row.purchased + row.forfeited -
      (row.soldDirect + row.soldPortion + row.nonRevenue + row.production),
    lastCountDate: lastDate,
  }));
}
