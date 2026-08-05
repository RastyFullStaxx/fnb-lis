import { z } from "zod";
import { PACKAGE_TYPES, BILLING_CYCLES, MODULE_TYPES, SUBSCRIPTION_STATUSES, REPORT_SLUGS } from "../constants";

export const packageType = z.enum(PACKAGE_TYPES);
export const billingCycle = z.enum(BILLING_CYCLES);
export const moduleType = z.enum(MODULE_TYPES);
export const subscriptionStatus = z.enum(SUBSCRIPTION_STATUSES);

export const subscriptionCreateBody = z.object({
  clientId: z.string().min(1),
  // packageType is NOT accepted here — it's derived server-side from
  // billingCycle + maxEntities + maxUsers (see derivePackageType in
  // constants.ts) so the tier badge can never drift from what the
  // subscription actually is.
  billingCycle: billingCycle,
  modules: z.array(moduleType).min(1, "Select at least one module"),
  maxEntities: z.number().int().min(0), // 0 = unlimited
  // Max user accounts (client req 2026-07-21). Monthly tiers cap it
  // (Basic 1 / Medium 5 / Full 10); Standalone owners set their own.
  maxUsers: z.number().int().min(0).default(0),
  /**
   * How many offline desktop computers this establishment may register.
   *
   * 0 = unlimited, matching maxEntities — `resolveDevice` skips the cap check
   * entirely when it is 0. Defaults to 1, the shipped assumption of "one client
   * computer"; a dev machine that also runs the mirror rehearsal needs 2.
   *
   * NOT an input to `derivePackageType` — the tier is billingCycle + maxEntities
   * + maxUsers, and adding a fourth axis would let the badge move for a reason
   * the pricing table does not mention.
   */
  maxDevices: z.number().int().min(0).default(1),
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
  // status is NOT accepted either: status changes go through the dedicated,
  // individually-audited endpoints (cancel, mark-paid, unmark-paid).
  billingCycle: billingCycle.optional(),
  modules: z.array(moduleType).min(1, "Select at least one module").optional(),
  maxEntities: z.number().int().min(0).optional(),
  maxUsers: z.number().int().min(0).optional(),
  /**
   * Omitted here until 2026-08-04, which made the licence uneditable: a `PUT`
   * carrying it returned 200 and silently changed nothing, because zod stripped
   * the field before the handler's `{ ...rest }` passthrough ever saw it.
   *
   * Narrowing needs no cascade, unlike `modules`. The cap is read only when a
   * NEW machine registers, so lowering it leaves already-registered computers
   * working and simply blocks the next one — the same way maxEntities and
   * maxUsers behave.
   */
  maxDevices: z.number().int().min(0).optional(),
  negotiatedPrice: z.number().min(0).optional().nullable(),
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
  maxUsers: number;
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

export const reportSlug = z.enum(REPORT_SLUGS);

/**
 * A client's full enabled-report set (report tier gating, Phase 5.2 —
 * docs/2026-08-04-report-tier-gating-phases.md). Same replace-the-whole-set
 * shape as locationModulesBody: the caller sends the complete desired list,
 * not a delta, and the handler diffs it against what's currently enabled.
 *
 * Unlike locationModulesBody, empty is allowed — an admin can deliberately
 * gate a client down to zero reports (e.g. a suspended/negotiated account),
 * which is not true of a location's own module set.
 */
export const subscriptionReportsBody = z.object({
  reportSlugs: z.array(reportSlug),
});
export type SubscriptionReportsBody = z.infer<typeof subscriptionReportsBody>;
