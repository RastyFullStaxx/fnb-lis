import { openEquivalent, type CostBasis } from "@fnb/core";
import { prisma } from "../db";

/**
 * Inventory valuation basis (client decision, 2026-07-20).
 *
 * PERIODIC WEIGHTED AVERAGE COST, computed the way an accountant checks it:
 *
 *     WAC(date) = (opening stock value + purchases value) ÷ (opening qty + purchased qty)
 *
 * where "opening" is the item's EARLIEST committed count (the first time the
 * business ever recorded holding it, valued at that count's snapshot cost) and
 * "purchases" are every committed purchase line up to and including the
 * valuation date.
 *
 * Opening stock MUST participate. Averaging purchase lines alone yields
 * "average purchase price", which is a different figure: an item with 12
 * opening units and one 6-unit purchase would be valued entirely at that
 * single purchase's price, ignoring two-thirds of the stock actually on hand.
 *
 * Consumption never moves the unit average — only stock-ins do — which is why
 * sales, non-revenue and usage are absent here.
 *
 * Scope: VALUATION ONLY. Callers apply this to beginning/ending stock value
 * and on-hand worth. Variance cost is never computed from it.
 */

export type ValuationMap = Map<string, number>;

const LI_INCLUDE = {
  itemVariant: { select: { size: true, contentTracked: true } },
} as const;

/**
 * Per-locationItem weighted average unit cost as of `asOfDate` (inclusive).
 * Items with neither an opening count nor purchases are absent from the map;
 * callers fall back to their existing basis, so a missing entry is never a
 * silent zero.
 */
export async function weightedAverageCosts(
  locationId: string,
  asOfDate: string,
  basis: CostBasis,
): Promise<ValuationMap> {
  const map: ValuationMap = new Map();
  if (basis !== "AVERAGE") return map; // PRICE basis: nothing to override

  const [openingLines, purchaseAgg] = await Promise.all([
    // Every committed count line at or before the valuation date. We reduce to
    // the EARLIEST count date per item below — that is the opening balance;
    // later counts are re-measurements of the same stock, not new stock-ins,
    // so including them would double-count.
    prisma.countLine.findMany({
      where: {
        status: "ACTIVE",
        countSession: { locationId, status: "COMMITTED", countDate: { lte: asOfDate } },
      },
      select: {
        locationItemId: true,
        countType: true,
        qtyFull: true,
        remainingContent: true,
        unitCost: true,
        countSession: { select: { countDate: true } },
        locationItem: { include: LI_INCLUDE },
      },
    }),
    // Dates come back per line (not grouped) because each item's purchases are
    // windowed against ITS OWN opening count date — see the filter below.
    prisma.purchaseLine.findMany({
      where: {
        status: "ACTIVE",
        purchase: { locationId, status: "COMMITTED", purchaseDate: { lte: asOfDate } },
      },
      select: {
        locationItemId: true,
        qty: true,
        lineTotal: true,
        purchase: { select: { purchaseDate: true } },
      },
    }),
  ]);

  // Opening = the item's earliest committed count date within the window.
  const earliestDate = new Map<string, string>();
  for (const line of openingLines) {
    const date = line.countSession.countDate;
    const current = earliestDate.get(line.locationItemId);
    if (!current || date < current) earliestDate.set(line.locationItemId, date);
  }

  const opening = new Map<string, { qty: number; value: number }>();
  for (const line of openingLines) {
    if (line.countSession.countDate !== earliestDate.get(line.locationItemId)) continue;
    const variant = line.locationItem.itemVariant;
    const qty =
      line.countType === "FULL"
        ? line.qtyFull
        : openEquivalent(line.remainingContent, variant.size, variant.contentTracked);
    const unit = line.unitCost > 0 ? line.unitCost : line.locationItem.cost;
    const entry = opening.get(line.locationItemId) ?? { qty: 0, value: 0 };
    entry.qty += qty;
    entry.value += qty * unit;
    opening.set(line.locationItemId, entry);
  }

  // Only purchases AFTER the opening count join the average. A purchase that
  // predates an item's first count is already physically inside that count's
  // quantity — adding it again would inflate both sides of the ratio. (Real
  // case: a new item is delivered mid-period and first counted at period end.)
  const purchases = new Map<string, { qty: number; value: number }>();
  for (const line of purchaseAgg) {
    const opened = earliestDate.get(line.locationItemId);
    if (opened && line.purchase.purchaseDate <= opened) continue;
    const entry = purchases.get(line.locationItemId) ?? { qty: 0, value: 0 };
    entry.qty += line.qty;
    entry.value += line.lineTotal;
    purchases.set(line.locationItemId, entry);
  }

  for (const id of new Set([...opening.keys(), ...purchases.keys()])) {
    const o = opening.get(id) ?? { qty: 0, value: 0 };
    const p = purchases.get(id) ?? { qty: 0, value: 0 };
    const qty = o.qty + p.qty;
    // Zero total quantity ⇒ no defensible average; leave the item out so the
    // caller keeps its snapshot/catalog cost rather than valuing it at 0.
    if (qty > 0) map.set(id, (o.value + p.value) / qty);
  }
  return map;
}

/** The client's saved basis (accounting policy — see @fnb/core COST_BASES). */
export async function clientCostBasis(clientId: string): Promise<CostBasis> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { costBasis: true } });
  return client?.costBasis === "AVERAGE" ? "AVERAGE" : "PRICE";
}
