import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { reportError } from "./telemetry";

export class AppError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Human wording for the unique constraints a user can actually collide with by
 * typing. Anything not listed still gets a 409 rather than a 500 — a value the
 * user chose being already taken is their problem to fix, never a server fault.
 */
const UNIQUE_FIELD_MESSAGES: Record<string, string> = {
  assetCode: "That asset code is already in use. Asset codes are unique across every location.",
  username: "Username already taken",
  name: "That name is already in use",
  barcode: "That barcode is already assigned to another item",
};

/**
 * The column(s) behind a P2002, without importing the Prisma client here.
 *
 * Two shapes in the wild: the classic engine puts them in `meta.target`, while
 * the driver adapter (what we run on SQLite) nests them under
 * `meta.driverAdapterError.cause.constraint.fields`. Read both, so the message
 * stays specific if the adapter ever changes.
 */
function uniqueViolationTarget(err: unknown): string[] | null {
  const e = err as {
    code?: string;
    meta?: {
      target?: unknown;
      driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } };
    };
  };
  if (e?.code !== "P2002") return null;
  const adapterFields = e.meta?.driverAdapterError?.cause?.constraint?.fields;
  if (Array.isArray(adapterFields)) return adapterFields.map(String);
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.map(String);
  return typeof target === "string" ? [target] : [];
}

export function errorHandler(err: Error, c: Context): Response {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code ?? null }, err.status);
  }
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  // A duplicate value the user typed is a 409 they can act on, not a 500 that
  // reads as "the app is broken". Editing an asset code to one already in use
  // surfaced as a raw Internal server error before this.
  const duplicate = uniqueViolationTarget(err);
  if (duplicate) {
    const field = duplicate.find((f) => f in UNIQUE_FIELD_MESSAGES);
    return c.json(
      {
        error: field ? UNIQUE_FIELD_MESSAGES[field] : "That value is already in use",
        code: "DUPLICATE",
      },
      409,
    );
  }
  console.error(err);
  reportError(err);
  return c.json({ error: "Internal server error" }, 500);
}
