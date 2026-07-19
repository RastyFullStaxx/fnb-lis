import { z } from "zod";
import { NON_REVENUE_REASONS, SALE_KINDS } from "../constants";
import { dateString, id, nonNegative, positive } from "./common";

// ── Counts ──

export const countSessionCreate = z.object({
  countDate: dateString,
  name: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
});
export type CountSessionCreate = z.infer<typeof countSessionCreate>;

export const countLineCreate = z
  .object({
    locationItemId: id,
    countType: z.enum(["FULL", "WEIGH"]),
    qtyFull: nonNegative.optional(),
    scaleWeight: nonNegative.optional(),
    scaleUnit: z.enum(["g", "oz"]).optional(),
    tareWeight: nonNegative.optional(),
    densityFactor: positive.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.countType === "FULL") {
      if (val.qtyFull === undefined) {
        ctx.addIssue({ code: "custom", path: ["qtyFull"], message: "Enter the counted quantity" });
      }
    } else {
      if (val.scaleWeight === undefined) {
        ctx.addIssue({ code: "custom", path: ["scaleWeight"], message: "Enter the scale reading" });
      }
      if (val.tareWeight === undefined) {
        ctx.addIssue({ code: "custom", path: ["tareWeight"], message: "Tare weight is required" });
      }
      // densityFactor is mode-dependent (DENSITY needs one, NET must not) —
      // the server enforces it per the variant's weighMode.
      if (
        val.scaleWeight !== undefined &&
        val.tareWeight !== undefined &&
        val.scaleWeight < val.tareWeight
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["scaleWeight"],
          message: "Scale reading is below the empty-container weight",
        });
      }
    }
  });
export type CountLineCreate = z.infer<typeof countLineCreate>;

// ── Purchases ──

export const purchaseCreate = z.object({
  purchaseDate: dateString,
  supplierId: id.nullable().optional(),
  refNo: z.string().trim().max(60).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type PurchaseCreate = z.infer<typeof purchaseCreate>;

export const purchaseLineCreate = z.object({
  locationItemId: id,
  qty: positive,
  unitCost: nonNegative,
});
export type PurchaseLineCreate = z.infer<typeof purchaseLineCreate>;

// ── Sales / non-revenue / production ──

export const saleCreate = z
  .object({
    saleDate: dateString,
    kind: z.enum(SALE_KINDS),
    locationItemId: id.optional(),
    menuItemId: id.optional(),
    qty: positive,
    unitPrice: nonNegative.optional(),
    discountPct: z.number().min(0).max(100).optional(),
    contentOverride: positive.optional(),
    reason: z.enum(NON_REVENUE_REASONS).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((val, ctx) => {
    const hasItem = Boolean(val.locationItemId);
    const hasMenu = Boolean(val.menuItemId);
    if (hasItem === hasMenu) {
      ctx.addIssue({ code: "custom", path: ["locationItemId"], message: "Choose an item or a menu (one of the two)" });
    }
    if (val.contentOverride !== undefined && val.kind !== "NON_REVENUE") {
      ctx.addIssue({
        code: "custom",
        path: ["contentOverride"],
        message: "A manual content amount applies to non-revenue entries only",
      });
    }
    if (val.kind === "NON_REVENUE" && !val.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Pick a reason" });
    }
  });
export type SaleCreate = z.infer<typeof saleCreate>;

// ── Inter-location transfers ──

export const transferCreate = z.object({
  toLocationId: id,
  businessDate: dateString,
  note: z.string().trim().max(500).nullable().optional(),
});
export type TransferCreate = z.infer<typeof transferCreate>;

export const transferLineCreate = z.object({
  locationItemId: id, // source-catalog row
  qty: positive,
  /** Optional override; defaults server-side to the source LocationItem.cost snapshot. */
  unitCost: nonNegative.optional(),
});
export type TransferLineCreate = z.infer<typeof transferLineCreate>;

/** Destination-side receive: what actually arrived, per dispatched line. */
export const transferReceive = z.object({
  receiptDate: dateString,
  lines: z
    .array(
      z.object({
        transferLineId: id,
        qtyReceived: nonNegative, // 0 = nothing arrived (still an explicit receipt)
        note: z.string().trim().max(500).nullable().optional(),
      }),
    )
    .min(1, "Receive at least one line"),
});
export type TransferReceive = z.infer<typeof transferReceive>;

// ── Forfeits (returned bottles) ──

export const forfeitCreate = z
  .object({
    forfeitDate: dateString,
    locationItemId: id,
    scaleWeight: nonNegative.optional(),
    scaleUnit: z.enum(["g", "oz"]).optional(),
    tareWeight: nonNegative.optional(),
    densityFactor: positive.optional(),
    qty: nonNegative.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((val, ctx) => {
    const weighed = val.scaleWeight !== undefined;
    if (weighed) {
      if (val.tareWeight === undefined) {
        ctx.addIssue({ code: "custom", path: ["tareWeight"], message: "Tare weight is required when weighing" });
      }
      // densityFactor is mode-dependent (server enforces per weighMode).
      if (val.tareWeight !== undefined && val.scaleWeight! < val.tareWeight) {
        ctx.addIssue({ code: "custom", path: ["scaleWeight"], message: "Scale reading is below the tare weight" });
      }
    } else if (!val.qty || val.qty <= 0) {
      ctx.addIssue({ code: "custom", path: ["qty"], message: "Enter a quantity or weigh the container" });
    }
  });
export type ForfeitCreate = z.infer<typeof forfeitCreate>;
