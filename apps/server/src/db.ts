import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client";

const here = path.dirname(fileURLToPath(import.meta.url));
const dbFile = path.resolve(here, "..", "data", "fnb.db");

const adapter = new PrismaBetterSqlite3({ url: `file:${dbFile}` });

export const prisma = new PrismaClient({ adapter });

/** WAL + busy timeout — required for sane SQLite behavior (single process only). */
export async function initDb(): Promise<void> {
  await prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL;");
  await prisma.$executeRawUnsafe("PRAGMA busy_timeout=5000;");
}

/** The transaction client type used by services that must run inside $transaction. */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
