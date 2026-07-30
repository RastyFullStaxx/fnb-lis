import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client";

const here = path.dirname(fileURLToPath(import.meta.url));
/**
 * `FNB_DB_FILE` overrides the database path. Defaults to the dev database, so
 * normal runs are unchanged — it exists so the seeder can be executed against a
 * throwaway file and verified (golden fixture + report coverage) without
 * touching anyone's working data. `prisma migrate reset` is off-limits here, so
 * a disposable database is the only way to prove a from-scratch seed.
 */
const dbFile = process.env.FNB_DB_FILE
  ? path.resolve(process.env.FNB_DB_FILE)
  : path.resolve(here, "..", "data", "fnb.db");

const adapter = new PrismaBetterSqlite3({ url: `file:${dbFile}` });

export const prisma = new PrismaClient({ adapter });

/** WAL + busy timeout — required for sane SQLite behavior (single process only). */
export async function initDb(): Promise<void> {
  await prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL;");
  await prisma.$executeRawUnsafe("PRAGMA busy_timeout=5000;");
}

/** The transaction client type used by services that must run inside $transaction. */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
