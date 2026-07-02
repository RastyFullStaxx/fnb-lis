import { z } from "zod";

/**
 * Business dates are timezone-free calendar days stored as TEXT 'YYYY-MM-DD'.
 * Never construct a JS Date from one in domain code — the machine runs UTC+8
 * and DateTime round-trips shift days.
 */
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const id = z.string().min(1);

export const nonNegative = z.number().finite().nonnegative();
export const positive = z.number().finite().positive();

export const voidRequest = z.object({
  reason: z.string().trim().min(3, "A reason is required"),
});

export type VoidRequest = z.infer<typeof voidRequest>;
