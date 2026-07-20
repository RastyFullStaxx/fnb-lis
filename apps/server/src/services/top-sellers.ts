import { prisma } from "../db";

/**
 * Top Sellers report — replaces the legacy Graph report (Top Brands / Top Menus / Top Ingredients).
 * Uses the same SaleRecord base query as salesReport() in report-lists.ts, grouped and ranked
 * instead of listed chronologically.
 *
 * Ingredient expansion walks each menu sale's SNAPSHOTTED recipeVersion.lines so historical
 * reports never drift when a recipe is later edited. This mirrors the exact same recipeVersionId
 * guarantee used throughout report-assembly.ts.
 *
 * contentTracked branching for ingredient qty:
 *   contentTracked = true  → servingQty / size  (content units — e.g. ml served / bottle size)
 *   contentTracked = false → servingQty          (whole-unit servings)
 * This is identical to reconciliation.ts line 150's soldPortion accumulation.
 */

export interface TopSellerRow {
  id: string;
  name: string;
  kind: "item" | "menu" | "ingredient";
  category: string | null;
  qty: number;
  /** Revenue in the location's currency. Always 0 for ingredient rows — consumption has no direct price. */
  revenue: number;
}

export interface TopSellersReport {
  from: string;
  to: string;
  topBrands: TopSellerRow[];
  topMenus: TopSellerRow[];
  topIngredients: TopSellerRow[];
}

export async function topSellersReport(
  locationId: string,
  from: string,
  to: string,
  allowedProductTypes?: readonly string[] | null,
  limit = 10,
): Promise<TopSellersReport> {
  const sales = await prisma.saleRecord.findMany({
    where: {
      locationId,
      status: "ACTIVE",
      kind: "SALE",
      saleDate: { gte: from, lte: to },
      ...(allowedProductTypes
        ? {
            OR: [
              { locationItemId: null },
              {
                locationItem: {
                  itemVariant: { item: { category: { productType: { in: [...allowedProductTypes] } } } },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      locationItem: {
        include: {
          itemVariant: {
            include: { unit: true, item: { include: { category: true } } },
          },
        },
      },
      menuItem: true,
      recipeVersion: {
        include: {
          lines: {
            include: {
              locationItem: {
                include: {
                  itemVariant: {
                    include: { unit: true, item: { include: { category: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  // ── Top Brands ──────────────────────────────────────────────────────────────
  // Direct item sales only (locationItemId set).

  const brandMap = new Map<string, { name: string; category: string | null; qty: number; revenue: number }>();
  for (const s of sales) {
    if (!s.locationItemId || !s.locationItem) continue;
    const li = s.locationItem;
    const label = `${li.itemVariant.item.name} ${li.itemVariant.size} ${li.itemVariant.unit.name}`;
    const net = s.unitPrice * s.qty * (1 - s.discountPct / 100);
    const agg = brandMap.get(s.locationItemId) ?? {
      name: label,
      category: li.itemVariant.item.category.name,
      qty: 0,
      revenue: 0,
    };
    agg.qty += s.qty;
    agg.revenue += net;
    brandMap.set(s.locationItemId, agg);
  }

  const topBrands: TopSellerRow[] = [...brandMap.entries()]
    .map(([id, v]) => ({ id, kind: "item" as const, ...v }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, limit);

  // ── Top Menus ────────────────────────────────────────────────────────────────
  // Menu/cocktail sales only (menuItemId set, locationItemId null).

  const menuMap = new Map<string, { name: string; category: null; qty: number; revenue: number }>();
  for (const s of sales) {
    if (!s.menuItemId || s.locationItemId) continue;
    const net = s.unitPrice * s.qty * (1 - s.discountPct / 100);
    const agg = menuMap.get(s.menuItemId) ?? {
      name: s.menuItem?.name ?? "—",
      category: null,
      qty: 0,
      revenue: 0,
    };
    agg.qty += s.qty;
    agg.revenue += net;
    menuMap.set(s.menuItemId, agg);
  }

  const topMenus: TopSellerRow[] = [...menuMap.entries()]
    .map(([id, v]) => ({ id, kind: "menu" as const, ...v }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, limit);

  // ── Top Ingredients ──────────────────────────────────────────────────────────
  // Expand each menu sale through its SNAPSHOTTED recipeVersion.lines.
  // Sale rows with recipeVersionId = null (menu sold before its first published recipe,
  // or after the version was voided) are silently skipped — nothing to expand.

  const ingredientMap = new Map<string, { name: string; category: string | null; qty: number }>();
  for (const s of sales) {
    if (!s.menuItemId || s.locationItemId) continue;
    if (!s.recipeVersion) continue; // no snapshot → skip, per spec

    for (const line of s.recipeVersion.lines) {
      const li = line.locationItem;
      if (!li) continue;

      // contentTracked mirrors reconciliation.ts soldPortion accumulation (line ~150):
      //   contentTracked → servingQty / size (content-unit portions of a whole bottle)
      //   !contentTracked → servingQty (whole units served as-is)
      const size = li.itemVariant.size || 1;
      const consumed = li.itemVariant.contentTracked
        ? (line.servingQty / size) * s.qty
        : line.servingQty * s.qty;

      const label = `${li.itemVariant.item.name} ${li.itemVariant.size} ${li.itemVariant.unit.name}`;
      const agg = ingredientMap.get(line.locationItemId) ?? {
        name: label,
        category: li.itemVariant.item.category.name,
        qty: 0,
      };
      agg.qty += consumed;
      ingredientMap.set(line.locationItemId, agg);
    }
  }

  const topIngredients: TopSellerRow[] = [...ingredientMap.entries()]
    .map(([id, v]) => ({ id, kind: "ingredient" as const, revenue: 0, ...v }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, limit);

  return { from, to, topBrands, topMenus, topIngredients };
}
