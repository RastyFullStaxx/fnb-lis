import { z } from "zod";
import { PACKAGE_TYPES, BILLING_CYCLES, MODULE_TYPES, SUBSCRIPTION_STATUSES, isValidMaxEntities } from "../constants";

export const packageType = z.enum(PACKAGE_TYPES);
export const billingCycle = z.enum(BILLING_CYCLES);
export const moduleType = z.enum(MODULE_TYPES);
export const subscriptionStatus = z.enum(SUBSCRIPTION_STATUSES);

const INVALID_MONTHLY_COUNT_MESSAGE =
  "Monthly subscriptions must be 1 (Basic), 2-5 (Medium), or 6-10 (Full) locations.";

// Base object stays UN-refined (not wrapped in ZodEffects) so it remains
// .omit()-able — fullClientBody below relies on that. Callers that consume
// this object directly (POST /subscriptions) should validate through
// `subscriptionCreateBodyValidated` instead, which adds the maxEntities
// check. Callers that .omit() a field (like clientId here) must run
// isValidMaxEntities themselves against the merged/omitted shape — see
// routes/admin.ts POST /clients/full.
export const subscriptionCreateBody = z.object({
  clientId: z.string().min(1),
  // packageType is NOT accepted here — it's derived server-side from
  // billingCycle + maxEntities (see derivePackageType in constants.ts) so
  // the tier badge can never drift from what the subscription actually is.
  billingCycle: billingCycle,
  modules: z.array(moduleType).min(1, "Select at least one module"),
  // 0 = unlimited, but ONLY valid for STANDALONE (client req 2026-07-26) —
  // MONTHLY must land in one of the three bounded tiers; see isValidMaxEntities.
  maxEntities: z.number().int().min(0),
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

/** subscriptionCreateBody + the maxEntities/billingCycle cross-check. Use this (not the bare object) wherever the full create body is validated directly — see POST /subscriptions. */
export const subscriptionCreateBodyValidated = subscriptionCreateBody.refine(
  (body) => isValidMaxEntities(body.billingCycle, body.maxEntities),
  { message: INVALID_MONTHLY_COUNT_MESSAGE, path: ["maxEntities"] },
);

export const subscriptionUpdateBody = z
  .object({
    // packageType is NOT accepted here — see subscriptionCreateBody above.
    // status is NOT accepted either: status changes go through the dedicated,
    // individually-audited endpoints (cancel, mark-paid, unmark-paid).
    billingCycle: billingCycle.optional(),
    modules: z.array(moduleType).min(1, "Select at least one module").optional(),
    maxEntities: z.number().int().min(0).optional(),
    negotiatedPrice: z.number().min(0).optional().nullable(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .nullable(),
    note: z.string().optional().nullable(),
  })
  .refine(
    (body) => {
      // Only checkable here when BOTH fields are present in this patch — a
      // partial update that only touches one of the pair is validated
      // server-side against the merged existing+patch values instead (see
      // routes/admin.ts PUT /subscriptions/:id), since this schema alone
      // can't see the current row.
      if (body.billingCycle === undefined || body.maxEntities === undefined) return true;
      return isValidMaxEntities(body.billingCycle, body.maxEntities);
    },
    { message: INVALID_MONTHLY_COUNT_MESSAGE, path: ["maxEntities"] },
  );
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