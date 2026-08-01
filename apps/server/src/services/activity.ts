import type { SessionUser } from "@fnb/core";
import { prisma, type Tx } from "../db";
import { chainTip, computeHash } from "./activity-chain";

export interface ActivityInput {
  user?: SessionUser | null;
  clientId?: string;
  locationId?: string;
  action: string; // e.g. "auth.login", "purchase.commit", "locationItem.priceChange"
  entity: string;
  entityId?: string;
  summary: string;
  details?: unknown; // serialized to TEXT
}

/**
 * Append-only activity trail. For mutations, pass the transaction client so
 * the log row commits atomically with the change it describes.
 */
export async function logActivity(input: ActivityInput, tx?: Tx): Promise<void> {
  const db = tx ?? prisma;

  /**
   * Two device-session facts get folded into every entry, here rather than at
   * nineteen call sites.
   *
   * `deviceId` is provenance: an admin chasing a double-entered delivery needs
   * to know it arrived from the bar PC.
   *
   * `disabledActor` is the flag §7.5 promises. A user disabled while their
   * machine was offline still has real work in that machine's outbox, and we
   * accept it rather than delete a week of counts to enforce a decision made
   * afterwards (see resolveActingUser). But "accept" without "flag" would let
   * a dismissed employee's entries land silently, so the batch is marked for
   * review right where an admin already looks.
   */
  const sync =
    input.user?.deviceId || input.user?.actorDisabled
      ? { deviceId: input.user.deviceId ?? null, disabledActor: input.user.actorDisabled || undefined }
      : null;
  const details =
    sync && input.details !== undefined
      ? { ...(input.details as Record<string, unknown>), ...sync }
      : sync
        ? sync
        : input.details;

  /**
   * Link this entry into the tamper-evident chain (services/activity-chain.ts).
   *
   * Done HERE because this function is the single choke point every one of the
   * ~90 log sites goes through — the same reason the device-session fields are
   * folded in above. A chain maintained at ninety call sites would be a chain
   * with holes in it.
   *
   * The tip is read with the SAME client the insert uses, so when a caller
   * passes a transaction the read and the append are inside it. That is what
   * keeps `seq` contiguous: SQLite serialises write transactions (one writer,
   * WAL — db.ts), so two concurrent mutations cannot both see the same tip and
   * fork the chain.
   */
  const tip = await chainTip(db);
  const seq = tip.seq + 1;
  const ts = new Date();
  const detailsJson = details === undefined ? null : JSON.stringify(details);

  const material = {
    seq,
    ts,
    userId: input.user?.id ?? null,
    userName: input.user ? `${input.user.firstName} ${input.user.lastName}` : null,
    clientId: input.clientId ?? null,
    locationId: input.locationId ?? null,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    summary: input.summary,
    detailsJson,
  };

  await db.activityLog.create({
    data: {
      ...material,
      // Written explicitly rather than left to @default(now()), because the
      // hash covers `ts` and the two must be the same instant.
      ts,
      deviceId: input.user?.deviceId ?? null,
      prevHash: tip.hash,
      hash: computeHash(material, tip.hash),
    },
  });
}
