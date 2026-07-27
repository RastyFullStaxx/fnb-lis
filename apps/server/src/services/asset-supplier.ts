import { prisma, type Tx } from "../db";

/**
 * Next sequential `AST-###` register code, client-wide — NOT per-category
 * (the AST-001→070 trace in asset-module-proposal.md shows the sequence
 * never resets when the category changes). Must run inside the SAME
 * `$transaction` as the LocationItem create/attach that consumes it: this
 * read-then-increment is the convenience path, not the safety guarantee —
 * `LocationItem.assetCode`'s `@unique` constraint (1.2) is the actual
 * backstop against a race between two concurrent attaches.
 */
export async function generateAssetCode(tx: Tx): Promise<string> {
  const latest = await tx.locationItem.findFirst({
    where: { assetCode: { not: null } },
    orderBy: { assetCode: "desc" },
    select: { assetCode: true },
  });
  const lastNum = latest?.assetCode ? Number.parseInt(latest.assetCode.replace("AST-", ""), 10) : 0;
  const next = (Number.isFinite(lastNum) ? lastNum : 0) + 1;
  return `AST-${String(next).padStart(3, "0")}`;
}

/**
 * Derives a LocationItem's current supplier from the most recent COMMITTED
 * Purchase linked via PurchaseLine — the same idiom `resolveCostBasis`
 * (packages/core/src/pricing.ts) already uses in this codebase: derive from
 * the latest linked transaction rather than duplicating the source of truth.
 * No `supplierId` column on LocationItem (closes the proposal's second team
 * item — architecture.md deviation #21).
 *
 * VOID purchases are excluded — a voided purchase never actually supplied
 * the item. DRAFT purchases are excluded too: nothing is "current" until
 * committed, matching how the rest of the app treats DRAFT as not-yet-real.
 *
 * Returns null when no committed purchase exists yet for this LocationItem.
 */
export async function deriveCurrentSupplier(
  locationItemId: string,
): Promise<{ id: string; name: string } | null> {
  const line = await prisma.purchaseLine.findFirst({
    where: {
      locationItemId,
      status: "ACTIVE",
      purchase: { status: "COMMITTED" },
    },
    orderBy: [{ purchase: { committedAt: "desc" } }, { createdAt: "desc" }],
    select: {
      purchase: { select: { supplier: { select: { id: true, name: true } } } },
    },
  });
  return line?.purchase.supplier ?? null;
}
