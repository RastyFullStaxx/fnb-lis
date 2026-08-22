import { prisma } from "../db";

/**
 * Open perishable batches for one catalog row, oldest expiry first
 * (expiry-date-plan.md, phases doc Phase 4.1) — the data behind the count
 * screen's FIFO worklist.
 *
 * "Open" here means an ACTIVE line on a COMMITTED delivery: a DRAFT purchase
 * hasn't entered the stock pool yet (nothing to grab off the shelf), and a
 * VOID or corrected-away line was never real stock or has already been
 * superseded by its replacement. There is no per-batch depletion ledger in
 * this codebase (`architecture.md` deviation #21 — cost basis is PRICE or
 * AVERAGE across the pool, never per-batch FIFO consumption), so "open" does
 * not mean "not yet counted out"; it means "still a committed delivery on
 * record for this item, with a date on the box". That is exactly the fact
 * the source plan asks this panel to surface — the client wants old stock
 * visible against new, not a consumption tracker this product doesn't keep.
 *
 * Only lines that actually carry a date are returned — a non-perishable
 * item's lines (expiryDate null) have nothing for this panel to show, and a
 * historical line written before Phase 3 shipped is silently excluded rather
 * than showing as a mystery undated row.
 *
 * `locationItemId` is already indexed (schema `@@index([locationItemId])`,
 * same column `getTrailingAverage` reads), so no new migration for this read.
 */
const FIFO_WORKLIST_SAMPLE_SIZE = 20;

export interface FifoBatch {
  id: string;
  qty: number;
  expiryDate: string;
  purchaseDate: string;
}

export async function getFifoBatches(locationItemId: string): Promise<FifoBatch[]> {
  const lines = await prisma.purchaseLine.findMany({
    where: {
      locationItemId,
      status: "ACTIVE",
      expiryDate: { not: null },
      purchase: { status: "COMMITTED" },
    },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
    take: FIFO_WORKLIST_SAMPLE_SIZE,
    select: { id: true, qty: true, expiryDate: true, purchase: { select: { purchaseDate: true } } },
  });
  return lines.map((l) => ({
    id: l.id,
    qty: l.qty,
    expiryDate: l.expiryDate!, // filtered not-null above
    purchaseDate: l.purchase.purchaseDate,
  }));
}

/**
 * The single oldest open expiry date per catalog row, across a whole
 * location — the item catalog list's "does this row have an expired batch
 * sitting on it" signal (expiry-date-plan.md, phases doc Phase 5.1).
 *
 * One `groupBy` for the whole catalog rather than one `getFifoBatches` call
 * per row: the catalog list already returns up to 1000 rows in a single
 * response, and 1000 sequential per-row queries to answer "is anything
 * expired" would be the N+1 this codebase avoids everywhere else. The
 * earliest date is enough to answer the flag — if the oldest batch on record
 * isn't expired, nothing newer is either, since `PurchaseLine` has no
 * unique constraint on `(purchaseId, locationItemId)` and every batch for
 * one item independently carries its own date.
 *
 * Same "open" definition as `getFifoBatches`: ACTIVE lines on a COMMITTED
 * purchase, dated lines only.
 */
export async function getEarliestOpenExpiry(locationId: string): Promise<Map<string, string>> {
  const grouped = await prisma.purchaseLine.groupBy({
    by: ["locationItemId"],
    where: {
      status: "ACTIVE",
      expiryDate: { not: null },
      purchase: { status: "COMMITTED", locationId },
    },
    _min: { expiryDate: true },
  });
  const byItem = new Map<string, string>();
  for (const row of grouped) {
    if (row._min.expiryDate) byItem.set(row.locationItemId, row._min.expiryDate);
  }
  return byItem;
}
