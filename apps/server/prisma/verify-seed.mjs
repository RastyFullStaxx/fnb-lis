/**
 * Drives verify-seed.ts against a THROWAWAY database:
 *   temp file -> migrate deploy -> seed -> assert -> delete.
 *
 * Exists because `prisma migrate reset` is off-limits in this project, so the
 * only honest way to prove a from-scratch seed is to build one from scratch.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "fnb-seed-"));
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
  run("npx", ["tsx", "prisma/verify-seed.ts"]);
} finally {
  rmSync(dir, { recursive: true, force: true });
  console.log(`\n== cleaned up ${dir}`);
}
