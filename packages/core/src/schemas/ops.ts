import { z } from "zod";
import { NON_REVENUE_REASONS, SALE_KINDS } from "../constants";
import { dateString, id, nonNegative, positive, syncFields, voidRequest } from "./common";

// ── Counts ──

export const countSessionCreate = z.object({
  ...syncFields,
  countDate: dateString,
  name: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
});
export type CountSessionCreate = z.infer<typeof countSessionCreate>;

export const countLineCreate = z
  .object({
    ...syncFields,
    locationItemId: id,
    /**
     * Which part of the establishment this tally is from (client sheet, June
     * 2026: MAIN BAR / COCKTAIL LOUNGE / BEER HALL / STOCK ROOM).
     *
     * Optional, and stays optional: a location that keeps all its stock in one
     * place never picks one, and every count recorded before areas existed has
     * none. Several lines for the same item — one per area — is the normal
     * shape, and totals correctly because report-assembly sums them.
     */
    areaId: id.optional(),
    countType: z.enum(["FULL", "WEIGH"]),
    qtyFull: nonNegative.optional(),
    scaleWeight: nonNegative.optional(),
    scaleUnit: z.enum(["g", "oz"]).optional(),
    tareWeight: nonNegative.optional(),
    densityFactor: positive.optional(),
    /**
     * Direct open-amount entry (client req 2026-07-21): the counter types the
     * remaining content itself, without weighing — so an open item can be
     * recorded even with no liquid/tare weight. When present on a WEIGH line it
     * replaces the scale/tare calculation; reconciliation reads it identically.
     */
    remainingContent: nonNegative.optional(),
    /**
     * Combined total entry (client req 2026-07-31, Mayonnaise scenario): the
     * counter has one combined number for full units plus one open
     * container, instead of splitting by hand. Server runs `splitTotalAmount`
     * (packages/core/src/weighing.ts) and writes the result as ordinary
     * `qtyFull` / `remainingContent` — this field never reaches storage or
     * reconciliation on its own.
     */
    totalAmount: nonNegative.optional(),
    /**
     * The prices as they stood WHEN THE BOTTLE WAS COUNTED.
     *
     * Normally the server stamps these from the catalog at write time, and on
     * the browser that is the same instant. From an offline desktop it is not:
     * a count taken Monday at 2am and pushed Wednesday would be stamped with
     * Wednesday's prices, so a repricing in between silently restates a
     * finished count's valuation. `report-assembly` reads these as
     * "snapshot from count time" — they have to actually be that.
     *
     * Honoured only for a device session; a browser cannot use them to post
     * arbitrary prices.
     */
    unitCost: nonNegative.optional(),
    unitRetail: nonNegative.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.countType === "FULL") {
      if (val.qtyFull === undefined) {
        ctx.addIssue({ code: "custom", path: ["qtyFull"], message: "Enter the counted quantity" });
      }
    } else if (val.remainingContent === undefined && val.totalAmount === undefined) {
      // Weighing path — needs scale + tare. (Skipped entirely when the counter
      // enters the remaining amount directly, or a combined total that the
      // server will split via splitTotalAmount into qtyFull/remainingContent.)
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
  ...syncFields,
  purchaseDate: dateString,
  supplierId: id.nullable().optional(),
  refNo: z.string().trim().max(60).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type PurchaseCreate = z.infer<typeof purchaseCreate>;

export const purchaseLineCreate = z.object({
  ...syncFields,
  locationItemId: id,
  qty: positive,
  unitCost: nonNegative,
});
export type PurchaseLineCreate = z.infer<typeof purchaseLineCreate>;

/**
 * Correcting a committed purchase line = void the old + write the replacement
 * onto the SAME purchase in one step. Keeping it on the same document is the
 * point: the replacement inherits the invoice's date, supplier and ref, so it
 * lands in exactly the report period the original did. The item is fixed —
 * you're correcting the numbers, not what was delivered (for a missed item,
 * record a new delivery). Omitting `unitCost` keeps the original's snapshot.
 */
export const purchaseLineCorrect = purchaseLineCreate
  .pick({ qty: true })
  // .pick() drops the sync fields, and a correction is a create like any other
  // — it needs its own idempotency key or a retried correction writes a second
  // replacement line against an already-voided original.
  .extend({ ...syncFields, unitCost: nonNegative.optional() })
  .and(voidRequest);
export type PurchaseLineCorrect = z.infer<typeof purchaseLineCorrect>;

// ── Sales / non-revenue / production ──

export const saleCreate = z
  .object({
    ...syncFields,
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
    /**
     * The recipe version live when the sale was rung up. Same reason as
     * countLineCreate's prices: the server otherwise resolves the LATEST
     * version at write time, so a menu sale recorded offline against v3 and
     * pushed after a recipe edit would deplete v4's ingredients. Device
     * sessions only.
     */
    recipeVersionId: id.optional(),
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

/**
 * Correcting a committed sale = void the old + create the replacement in one
 * step. The replacement is a full saleCreate; the void needs its own reason,
 * kept under `voidReason` so it never collides with saleCreate's `reason`
 * (the non-revenue bucket). Intersecting saleCreate with a plain `reason`
 * would force the void reason to satisfy the non-revenue enum — the source of
 * a latent bug that made SALE corrections un-submittable.
 */
export const saleCorrect = saleCreate.and(
  z.object({ voidReason: z.string().trim().min(3, "A reason for the change is required") }),
);
export type SaleCorrect = z.infer<typeof saleCorrect>;

// ── Inter-location transfers ──

export const transferCreate = z.object({
  ...syncFields,
  toLocationId: id,
  businessDate: dateString,
  note: z.string().trim().max(500).nullable().optional(),
});
export type TransferCreate = z.infer<typeof transferCreate>;

export const transferLineCreate = z.object({
  ...syncFields,
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
      // Each entry becomes one TransferReceiptLine, so the idempotency key
      // belongs on the line, not on the envelope — a retried receive has to
      // land on the same rows the first attempt created.
      z.object({
        ...syncFields,
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
    ...syncFields,
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
