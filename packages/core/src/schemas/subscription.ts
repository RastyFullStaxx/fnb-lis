import { z } from "zod";
import { PACKAGE_TYPES, BILLING_CYCLES, MODULE_TYPES, SUBSCRIPTION_STATUSES } from "../constants";

export const packageType = z.enum(PACKAGE_TYPES);
export const billingCycle = z.enum(BILLING_CYCLES);
export const moduleType = z.enum(MODULE_TYPES);
export const subscriptionStatus = z.enum(SUBSCRIPTION_STATUSES);

export const subscriptionCreateBody = z.object({
  clientId: z.string().min(1),
  // packageType is NOT accepted here — it's derived server-side from
  // billingCycle + maxEntities (see derivePackageType in constants.ts) so
  // the tier badge can never drift from what the subscription actually is.
  billingCycle: billingCycle,
  modules: z.array(moduleType).min(1, "Select at least one module"),
  maxEntities: z.number().int().min(0), // 0 = unlimited
  negotiatedPrice: z.number().min(0).optional().nullable(), // per-client/per-deal price, if tracked at all
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
    .optional()
    .nullable(),
  note: z.string().optional().nullable(),
});
export type SubscriptionCreateBody = z.infer<typeof subscriptionCreateBody>;

export const subscriptionUpdateBody = z.object({
  // packageType is NOT accepted here — see subscriptionCreateBody above.
  billingCycle: billingCycle.optional(),
  modules: z.array(moduleType).min(1, "Select at least one module").optional(),
  maxEntities: z.number().int().min(0).optional(),
  negotiatedPrice: z.number().min(0).optional().nullable(),
  status: subscriptionStatus.optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  note: z.string().optional().nullable(),
});
export type SubscriptionUpdateBody = z.infer<typeof subscriptionUpdateBody>;

export interface SubscriptionRecord {
  id: string;
  clientId: string;
  packageType: string;
  billingCycle: string;
  modules: string[];
  maxEntities: number;
  negotiatedPrice: number | null;
  status: string;
  startDate: string;
  endDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A single location's own module set (Fix Plan §2.3) — a subset of its client's SubscriptionModule ceiling. */
export const locationModulesBody = z.object({
  modules: z.array(moduleType).min(1, "Select at least one module"),
});
export type LocationModulesBody = z.infer<typeof locationModulesBody>;