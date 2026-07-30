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

/**
 * The two fields an offline desktop adds to any create. Both absent on every
 * browser request, so nothing about the web app changes.
 *
 * `id` is the idempotency key, and it is deliberately the record's OWN primary
 * key rather than a separate token. The device mints a cuid before writing to
 * its local mirror, so a record carries one identity from the moment it exists
 * — push it twice and the second push collides with the primary key, which is
 * how the server knows to hand back the first push's record instead of
 * duplicating a night's sales. A separate idempotency table would need its own
 * retention policy to answer the question the primary key answers for free.
 *
 * Shape-checked, not merely non-empty: this is a caller-supplied primary key,
 * so it is a trust boundary. Bounded to the cuid alphabet and length.
 *
 * `occurredAt` is when the user did the work on the device; the server still
 * stamps createdAt on receipt. Past values are the entire point of the field.
 * Future ones are rejected beyond a day of slack — a desktop with a wrong
 * clock must not be able to date entries into next year, and a device is not
 * a trusted clock.
 */
export const syncFields = {
  id: z
    .string()
    .regex(/^[a-z][a-z0-9]{7,31}$/, "Invalid record id")
    .optional(),
  occurredAt: z.coerce
    .date()
    .refine((d) => d.getTime() < Date.now() + 86_400_000, "Timestamp is in the future")
    .optional(),
};

export const voidRequest = z.object({
  reason: z.string().trim().min(3, "A reason is required"),
});

export type VoidRequest = z.infer<typeof voidRequest>;
