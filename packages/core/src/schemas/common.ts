import { z } from "zod";

/**
 * Business dates are timezone-free calendar days stored as TEXT 'YYYY-MM-DD'.
 * Never construct a JS Date from one in domain code — the machine runs UTC+8
 * and DateTime round-trips shift days.
 */
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  /**
   * The shape check alone is not a date check: `2026-13-45`, `2026-02-30`,
   * `2026-00-10` and `9999-99-99` all match four-two-two and were all accepted.
   *
   * That is not cosmetic. Every report window compares these lexicographically
   * (`saleDate: { gte: from, lte: to }`), which is the whole reason the format
   * is TEXT — so a sale dated `2026-13-45` sorts after `2026-12-31` and lands
   * in **no** audit period at all. The revenue simply stops appearing in the
   * reconciliation, with nothing raised anywhere.
   *
   * `Date.UTC` is used here to VALIDATE, never to convert: it normalises
   * overflow (Feb 30 → Mar 2), so round-tripping and comparing the parts back
   * against the input is what detects an impossible day. No value derived from
   * this Date escapes the function, so the file-level warning above — never
   * build a JS Date from a business date in domain code — still holds.
   */
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, "Not a real calendar date");

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

/**
 * Fields that make a NON-creating mutation (commit, void, correct) safe to
 * replay and safe to reject. Absent on every browser request.
 *
 * `opId` — a create carries its own primary key, which answers "did this already
 * apply?" for free. A void changes an existing row, so there is no key to
 * collide: without a token, a device replaying its own void is
 * indistinguishable from someone else having voided the same record in the
 * browser meanwhile, and those two need opposite handling.
 *
 * `expectedStatus` — what the caller believed the record's status to be. A
 * mismatch means the record moved while this device was offline; that is a
 * genuine conflict and the server answers with the real state rather than
 * silently applying or returning a bare "already voided".
 */
export const syncMutation = {
  opId: z
    .string()
    .regex(/^[a-z][a-z0-9]{7,31}$/, "Invalid operation id")
    .optional(),
  expectedStatus: z.string().trim().min(1).max(20).optional(),
};

export const voidRequest = z.object({
  ...syncMutation,
  reason: z.string().trim().min(3, "A reason is required"),
});

/**
 * Body for commit endpoints, which historically took none. Every field is
 * optional so existing callers that send nothing at all still work.
 */
export const commitRequest = z.object(syncMutation);
export type CommitRequest = z.infer<typeof commitRequest>;

export type VoidRequest = z.infer<typeof voidRequest>;
