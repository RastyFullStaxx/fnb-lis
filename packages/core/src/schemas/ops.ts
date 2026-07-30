import { z } from "zod";
import { COUNT_TYPES, SALE_KINDS } from "../constants";
import { dateString, id, nonNegative, positive } from "./common";

// ── Sales ──
// Mirrors sales.ts's actual read of the body: kind picks which price default
// applies, exactly one of locationItemId/menuItemId is used if present (the
// route doesn't reject both/neither, so this schema doesn't either — it
// matches the server's real tolerance, not a stricter rule of its own).
export const saleCreate = z.object({
  saleDate: dateString,
  kind: z.enum(SALE_KINDS),
  locationItemId: id.nullable().optional(),
  menuItemId: id.nullable().optional(),
  qty: positive,
  // Optional: sales.ts fills this from the catalog/menu price when omitted.
  unitPrice: nonNegative.optional(),
  discountPct: z.number().min(0).max(100).optional(),
  contentOverride: nonNegative.nullable().optional(),
  // Non-revenue bucket code (NON_REVENUE_REASONS) — distinct from the void
  // reason used on /correct below.
  reason: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type SaleCreate = z.infer<typeof saleCreate>;

// /sales/:id/correct's body, read directly off sales.ts: same shape as
// saleCreate, but the void-side reason is its own field, voidReason — the
// route also reads body.reason separately (the non-revenue bucket on the
// replacement), so saleCreate.and(voidRequest) would collide the two paths
// under one name. Kept as its own schema instead of composing the two.
export const saleCorrect = saleCreate.extend({
  voidReason: z.string().trim().min(3, "A reason is required"),
});
export type SaleCorrect = z.infer<typeof saleCorrect>;

// ── Counts ──
// countLineCreate covers both the FULL and WEIGH counting modes in one
// object (buildLineData in counts.ts branches on countType + which optional
// fields are present) — the same shape is reused for create, update, and
// correct across counts.ts, so it isn't split into per-mode schemas.
export const countLineCreate = z.object({
  locationItemId: id,
  countType: z.enum(COUNT_TYPES),
  // FULL mode:
  qtyFull: nonNegative.optional(),
  // WEIGH mode — scale reading path:
  scaleWeight: nonNegative.optional(),
  scaleUnit: z.enum(["g", "oz"]).optional(),
  tareWeight: nonNegative.optional(),
  densityFactor: positive.optional(),
  // WEIGH mode — direct open-amount entry path (client req 2026-07-21):
  // typed remaining content, bypassing the scale entirely.
  remainingContent: nonNegative.optional(),
});
export type CountLineCreate = z.infer<typeof countLineCreate>;

export const countSessionCreate = z.object({
  countDate: dateString,
  name: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type CountSessionCreate = z.infer<typeof countSessionCreate>;

// ── Purchases ──
export const purchaseCreate = z.object({
  purchaseDate: dateString,
  supplierId: id.nullable().optional(),
  refNo: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type PurchaseCreate = z.infer<typeof purchaseCreate>;

export const purchaseLineCreate = z.object({
  locationItemId: id,
  qty: positive,
  unitCost: nonNegative,
});
export type PurchaseLineCreate = z.infer<typeof purchaseLineCreate>;

// ── Forfeits (returned partial bottles) ──
// forfeits.ts's own POST route is the only consumer; qty defaults to 0 and
// the weigh fields are only read when scaleWeight is present, same
// optionality as CountLineCreate's WEIGH branch.
export const forfeitCreate = z.object({
  forfeitDate: dateString,
  locationItemId: id,
  qty: nonNegative.optional(),
  scaleWeight: nonNegative.optional(),
  scaleUnit: z.enum(["g", "oz"]).optional(),
  tareWeight: nonNegative.optional(),
  densityFactor: positive.optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type ForfeitCreate = z.infer<typeof forfeitCreate>;

// ── Transfers ──
export const transferCreate = z.object({
  toLocationId: id,
  businessDate: dateString,
  note: z.string().trim().max(500).nullable().optional(),
});
export type TransferCreate = z.infer<typeof transferCreate>;

// unitCost is optional here (transfers.ts falls back to the source
// locationItem's own cost when omitted) — the one field that differs from
// PurchaseLineCreate, where it's always required and staff-entered.
export const transferLineCreate = z.object({
  locationItemId: id,
  qty: positive,
  unitCost: nonNegative.optional(),
});
export type TransferLineCreate = z.infer<typeof transferLineCreate>;

export const transferReceive = z.object({
  receiptDate: dateString,
  lines: z
    .array(
      z.object({
        transferLineId: id,
        qtyReceived: nonNegative,
        note: z.string().trim().max(500).nullable().optional(),
      }),
    )
    .min(1, "Add at least one line to receive"),
});
export type TransferReceive = z.infer<typeof transferReceive>;
