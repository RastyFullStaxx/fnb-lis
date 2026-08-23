/**
 * LegacyMap helpers — what makes the import idempotent.
 *
 * Every stage resolves a legacy id through here before creating anything:
 * found -> update the record it already made, absent -> create and record.
 * Without this, a second run duplicates 8,525 count lines and every Full Audit
 * anchor doubles.
 */
import type { Prisma, PrismaClient } from "../../src/generated/prisma/client";

export type Tx = Prisma.TransactionClient | PrismaClient;

export async function resolve(db: Tx, table: string, legacyId: string | number): Promise<string | null> {
  const row = await db.legacyMap.findUnique({
    where: { legacyTable_legacyId: { legacyTable: table, legacyId: String(legacyId) } },
    select: { newId: true },
  });
  return row?.newId ?? null;
}

export async function record(db: Tx, table: string, legacyId: string | number, newId: string): Promise<void> {
  await db.legacyMap.upsert({
    where: { legacyTable_legacyId: { legacyTable: table, legacyId: String(legacyId) } },
    update: { newId },
    create: { legacyTable: table, legacyId: String(legacyId), newId },
  });
}

/**
 * Bulk-load one legacy table's mappings into memory.
 *
 * Stages resolve thousands of ids (8,525 count lines each need their
 * LocationItem). One findUnique per row is thousands of round trips inside a
 * transaction that is already holding the SQLite write lock.
 */
export async function loadMap(db: Tx, table: string): Promise<Map<string, string>> {
  const rows = await db.legacyMap.findMany({
    where: { legacyTable: table },
    select: { legacyId: true, newId: true },
  });
  return new Map(rows.map((r) => [r.legacyId, r.newId]));
}
