import { z } from "zod";
import { PAYMENT_TERMS, UNIT_KINDS, WEIGH_MODES } from "../constants";
import { id, nonNegative, positive } from "./common";

export const unitCreate = z.object({
  name: z.string().trim().min(1).max(20),
  kind: z.enum(UNIT_KINDS),
  factorToBase: positive,
});
export type UnitCreate = z.infer<typeof unitCreate>;

export const categoryUpsert = z.object({
  name: z.string().trim().min(1).max(60),
  productType: z.string().trim().min(1),
  defaultDensityFactor: positive.nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export type CategoryUpsert = z.infer<typeof categoryUpsert>;

export const variantCreate = z.object({
  size: positive,
  unitId: id,
  contentTracked: z.boolean(),
  // null = legacy inference (contentTracked ⇒ DENSITY); NET = kitchen
  // net-weight counting (client req #16), MASS-unit variants only.
  weighMode: z.enum(WEIGH_MODES).nullable().optional(),
  // nonNegative, not positive: NET items weighed directly on the scale plate
  // legitimately have tare 0.
  tareWeight: nonNegative.nullable().optional(),
  tareWeightUnit: z.enum(["g", "oz"]).nullable().optional(),
  densityFactor: positive.nullable().optional(),
  barcode: z.string().trim().max(64).nullable().optional(),
});
export type VariantCreate = z.infer<typeof variantCreate>;

export const variantUpdate = variantCreate.partial().extend({
  isActive: z.boolean().optional(),
});
export type VariantUpdate = z.infer<typeof variantUpdate>;

export const itemCreate = z.object({
  name: z.string().trim().min(1).max(120),
  categoryId: id,
  description: z.string().trim().max(500).nullable().optional(),
  variants: z.array(variantCreate).min(1, "Add at least one size/variant"),
});
export type ItemCreate = z.infer<typeof itemCreate>;

export const itemUpdate = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  categoryId: id.optional(),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type ItemUpdate = z.infer<typeof itemUpdate>;

export const locationItemAttach = z.object({
  itemVariantId: id,
  cost: nonNegative.default(0),
  retail: nonNegative.default(0),
  parLevel: nonNegative.nullable().optional(),
});
export type LocationItemAttach = z.infer<typeof locationItemAttach>;

export const locationItemUpdate = z.object({
  cost: nonNegative.optional(),
  retail: nonNegative.optional(),
  parLevel: nonNegative.nullable().optional(),
  isActive: z.boolean().optional(),
});
export type LocationItemUpdate = z.infer<typeof locationItemUpdate>;

export const supplierUpsert = z.object({
  name: z.string().trim().min(1).max(120),
  contactInfo: z.string().trim().max(500).nullable().optional(),
  // Structured contact + terms (client req 2026-07-20) — printed on the
  // Purchase report so buyers can see who to call and when payment is due.
  contactPerson: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(60).nullable().optional(),
  email: z.string().trim().max(120).nullable().optional(),
  address: z.string().trim().max(240).nullable().optional(),
  paymentTerms: z.enum(PAYMENT_TERMS).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type SupplierUpsert = z.infer<typeof supplierUpsert>;

export const productTypesUpdate = z.object({
  productTypes: z.array(z.string().trim().min(1)).min(1),
});
