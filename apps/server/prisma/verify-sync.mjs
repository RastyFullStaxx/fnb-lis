/**
 * Drives verify-sync.ts against a THROWAWAY database:
 *   temp file -> migrate deploy -> seed -> assert -> delete.
 *
 * Same harness as verify-seed.mjs, and for the same reason: `prisma migrate
 * reset` is off-limits here, so the only honest way to prove behaviour from
 * scratch is to build the database from scratch. This one also WRITES (sales,
 * devices, revocations), which is exactly why it must never touch data/fnb.db.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "fnb-sync-"));
const dbFile = path.join(dir, "verify.db");
const env = { ...process.env, FNB_DB_FILE: dbFile };
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });

try {
  console.log(`\n== throwaway database: ${dbFile}`);
  console.log("\n== migrate deploy");
  run("npx", ["prisma", "migrate", "deploy"]);
  console.log("\n== seed");
  run("npx", ["tsx", "prisma/seed.ts"]);
  console.log("\n== verify");
  run("npx", ["tsx", "prisma/verify-sync.ts"]);
} finally {
  rmSync(dir, { recursive: true, force: true });
  console.log(`\n== cleaned up ${dir}`);
}
