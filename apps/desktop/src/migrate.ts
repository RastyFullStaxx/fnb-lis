import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * Apply Prisma migrations without the Prisma CLI.
 *
 * `prisma migrate deploy` needs the 41 MB `prisma` package plus a 21 MB
 * `schema-engine-windows.exe`. Shipping 60 MB of tooling inside a desktop app to
 * run some CREATE TABLE statements is not defensible, and the CLI also expects a
 * writable project layout that a packaged app does not have.
 *
 * This writes the same `_prisma_migrations` rows the CLI does. The compatibility
 * that matters is the checksum: Prisma stores plain hex SHA-256 of the raw
 * migration.sql BYTES. Reproducing it exactly means a database created here is
 * indistinguishable from one the server's CLI produced — so the same folder can
 * later be opened by the CLI, and `migrate status` agrees.
 *
 * Idempotent: already-applied migrations are skipped by name.
 */

/** Mirrors Prisma's own checksum: hex sha256 over the file's raw bytes. */
function checksumOf(sql: Buffer): string {
  return createHash("sha256").update(sql).digest("hex");
}

const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id"                    TEXT PRIMARY KEY NOT NULL,
  "checksum"              TEXT NOT NULL,
  "finished_at"           DATETIME,
  "migration_name"        TEXT NOT NULL,
  "logs"                  TEXT,
  "rolled_back_at"        DATETIME,
  "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
  "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`;

export interface MigrateResult {
  applied: string[];
  alreadyApplied: number;
}

/**
 * @param dbFile   the local mirror's SQLite file
 * @param migrationsDir  the packaged copy of apps/server/prisma/migrations
 */
export function migrateLocal(dbFile: string, migrationsDir: string): MigrateResult {
  const db = new Database(dbFile);
  try {
    // WAL before anything else, matching the server (apps/server/src/db.ts).
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.exec(CREATE_MIGRATIONS_TABLE);

    const done = new Set<string>(
      db
        .prepare(`SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`)
        .all()
        .map((r) => (r as { migration_name: string }).migration_name),
    );

    // Prisma orders by directory name, which is timestamp-prefixed. Sorting
    // lexicographically is therefore chronological — and must stay that way, or
    // a migration lands before the table it alters exists.
    const pending = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .filter((name) => !done.has(name));

    const applied: string[] = [];
    for (const name of pending) {
      const file = path.join(migrationsDir, name, "migration.sql");
      const raw = readFileSync(file);

      // One transaction per migration, matching the CLI: a half-applied
      // migration on a bar PC is worse than a failed startup, because the app
      // would then run against a schema no version of the code expects.
      const run = db.transaction(() => {
        db.exec(raw.toString("utf8"));
        db.prepare(
          `INSERT INTO "_prisma_migrations"
             (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
           VALUES (?, ?, current_timestamp, ?, NULL, NULL, current_timestamp, 1)`,
        ).run(crypto.randomUUID(), checksumOf(raw), name);
      });
      run();
      applied.push(name);
    }

    return { applied, alreadyApplied: done.size };
  } finally {
    db.close();
  }
}
