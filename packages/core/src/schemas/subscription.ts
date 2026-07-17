import { z } from "zod";
import { PACKAGE_TYPES, BILLING_CYCLES, INVENTORY_MODULES, SUBSCRIPTION_STATUSES } from "../constants";

export const packageType = z.enum(PACKAGE_TYPES);
export const billingCycle = z.enum(BILLING_CYCLES);
export const inventoryModule = z.enum(INVENTORY_MODULES);
export const subscriptionStatus = z.enum(SUBSCRIPTION_STATUSES);

export const subscriptionCreateBody = z.object({
  clientId: z.string().min(1),
  packageType: packageType,
  billingCycle: billingCycle,
  inventoryModules: inventoryModule,
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
  packageType: packageType.optional(),
  billingCycle: billingCycle.optional(),
  inventoryModules: inventoryModule.optional(),
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
  inventoryModules: string;
  maxEntities: number;
  status: string;
  startDate: string;
  endDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}
