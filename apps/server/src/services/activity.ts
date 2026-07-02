import type { SessionUser } from "@fnb/core";
import { prisma, type Tx } from "../db";

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
  await db.activityLog.create({
    data: {
      userId: input.user?.id ?? null,
      userName: input.user ? `${input.user.firstName} ${input.user.lastName}` : null,
      clientId: input.clientId ?? null,
      locationId: input.locationId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      summary: input.summary,
      detailsJson: input.details === undefined ? null : JSON.stringify(input.details),
    },
  });
}
