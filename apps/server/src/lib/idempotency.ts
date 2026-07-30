import { AppError } from "./errors";

/**
 * Replay guard for pushes from an offline desktop.
 *
 * The record's primary key IS the idempotency key (see `syncFields` in
 * @fnb/core): the device mints the id before it writes to its local mirror, so
 * a retried push carries the same id as the first attempt. This looks it up —
 * finding it means "already applied", and the caller returns that record
 * instead of writing a second one. Without this, one dropped connection
 * mid-upload silently duplicates a night's sales.
 *
 * The `owns` predicate is the reason this is a helper rather than three inline
 * lines repeated at every create route. A bare findUnique on a caller-supplied
 * id reaches every row in the database, so a device that replayed — or guessed
 * — another establishment's id would be handed back that establishment's
 * record. Eight routes are eight chances to forget the scoping check; making it
 * a required argument means it cannot be omitted, only answered.
 *
 * A collision with a foreign record is a 409 rather than a silent pass, because
 * letting the create proceed would hit the primary key and 409 anyway. The
 * message says nothing about who owns it.
 */
export async function replay<T>(
  id: string | undefined,
  find: (id: string) => Promise<T | null>,
  owns: (row: T) => boolean,
): Promise<T | null> {
  if (!id) return null;
  const existing = await find(id);
  if (!existing) return null;
  if (!owns(existing)) throw new AppError(409, "That record id is already in use");
  return existing;
}
