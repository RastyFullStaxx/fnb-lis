import { zValidator as honoZValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

/**
 * `zValidator`, but its failures are readable by a human.
 *
 * The stock validator answers a bad body with
 * `{ success: false, error: <serialized ZodError> }`. The web client reads
 * `{ error: string }` — every other error on this server sends that — so
 * `body.error` came back an OBJECT, `new ApiError(400, thatObject)` stringified
 * it, and the toast on screen read **"[object Object]"**. Every failed
 * validation in the app, on every form.
 *
 * So this hook rewrites the failure into the shape the rest of the server
 * already speaks. The field name is included because a form can have a dozen
 * inputs and "must be YYYY-MM-DD" alone does not say which one.
 *
 * Import this instead of `@hono/zod-validator` — that is the whole contract.
 */
export function zValidator<T extends ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return honoZValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: describe(result.error), code: "VALIDATION" }, 400);
    }
    return undefined;
  });
}

/**
 * Structural, not the `ZodError` class: zod v4 hands the hook a `$ZodError`,
 * which is not an instance of it. Only `issues` is needed here.
 */
interface ZodIssues {
  issues: ReadonlyArray<{
    path: ReadonlyArray<PropertyKey | undefined>;
    message: string;
    code?: string;
  }>;
}

/**
 * Zod's default wording, translated for the person reading the toast.
 *
 * "Invalid input: expected string, received undefined" is a sentence for
 * whoever wrote the schema. The user left a field blank, and "is required" is
 * what happened. Only the missing-value case is rewritten — it is far and away
 * the most common, and every other message either comes from a schema that
 * already words it deliberately or is specific enough to act on.
 */
function humanize(message: string, code?: string): string {
  if (code === "invalid_type" && /received (undefined|null|nan)/i.test(message)) {
    return "is required";
  }
  return message;
}

/**
 * The first problem, said plainly.
 *
 * One issue, not all of them: a toast is one line, and a user fixes fields one
 * at a time anyway. Zod orders issues by field order, so the first is the one
 * highest up the form — the one they will reach first.
 */
function describe(error: ZodIssues): string {
  const issue = error.issues[0];
  if (!issue) return "Some of the details are invalid";
  const field = issue.path
    .filter((p): p is string | number => p !== undefined)
    .map(String)
    // countDate → Count date; lines.0.qtyFull → Lines 0 qty full
    .map((p) => (/^\d+$/.test(p) ? p : p.replace(/([A-Z])/g, " $1").toLowerCase()))
    .join(" ")
    .trim();
  const message = humanize(issue.message || "is invalid", issue.code);
  if (!field) return message;
  const label = field.charAt(0).toUpperCase() + field.slice(1);
  return `${label}: ${message}`;
}
