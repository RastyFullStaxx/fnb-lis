/**
 * Prove the latest backup can actually be restored — and that the numbers
 * survived the round trip.
 *
 *   npm run restore-drill -w @fnb/server
 *
 * An untested backup is a belief, not a backup. This is the test, and it is
 * deliberately more than `PRAGMA integrity_check`:
 *
 *   1. integrity_check            — is it a valid SQLite file?
 *   2. NOT VACUOUS                — does it contain anything at all?
 *   3. row counts vs its manifest — did anything silently fall out?
 *   4. FULL AUDIT DIGEST          — does it still produce the same reconciliation?
 *   5. drift vs live              — reported, not asserted: the measured RPO.
 *
 * Step 2 exists because steps 3 and 4 are self-referential by design: they
 * compare the restore against a manifest taken from the same backup, so zeros
 * match zeros and an EMPTY database once drilled green. Relative checks are
 * only evidence once an absolute floor has been cleared.
 *
 * Step 4 is the one that matters and the one nobody does. Restoring a file
 * proves the file opens. Re-running the real reconciliation against the restored
 * copy and matching it to what the backup recorded proves the Full Audit — the
 * single report this client trusts absolutely — survives a restore intact.
 * Anything less is checking the packaging, not the contents.
 *
 * Everything in 1–4 compares the restore against the backup's OWN manifest,
 * never against the live database. Live moves; a backup does not. Comparing to
 * live makes the drill fail on ordinary business activity, and a check that
 * cries wolf is a check nobody runs.
 *
 * Never touches the live database: the backup is copied to a scratch path and
 * every query against it is read-only.
 *
 * Record the elapsed time in docs/build-log.md. That number is your REAL RTO,
 * as opposed to the aspirational one in docs/security-runbook.md §2.
 */
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");

if (existsSync(path.join(serverRoot, ".env"))) {
  process.loadEnvFile(path.join(serverRoot, ".env"));
}

const liveDb = process.env.FNB_DB_FILE
  ? path.resolve(process.env.FNB_DB_FILE)
  : path.join(serverRoot, "data", "fnb.db");

const backupRoot = process.env.FNB_BACKUP_DIR
  ? path.resolve(process.env.FNB_BACKUP_DIR)
  : path.join(serverRoot, "data", "backups");

let failures = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
};

/** The digest script, run against one database file, as JSON. */
function digestOf(dbFile) {
  const out = execFileSync("npx", ["tsx", "scripts/audit-digest.ts"], {
    cwd: serverRoot,
    env: { ...process.env, FNB_DB_FILE: dbFile },
    encoding: "utf-8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

const started = Date.now();

const allBackups = existsSync(backupRoot)
  ? readdirSync(backupRoot)
      .filter((f) => /^fnb-\d{8}-\d{6}\.db$/.test(f))
      .sort()
      .reverse()
  : [];

/**
 * Only backups that carry a manifest are drillable. A backup whose manifest
 * step failed is still a valid database — it just cannot be checked against
 * what it contained — so skipping past it to one that CAN be verified beats
 * refusing to drill at all and reporting a false diagnosis about the newest
 * file. The skipped ones are named, because silently drilling an older backup
 * while a newer one is quietly unverifiable is exactly the sort of comfort this
 * whole exercise exists to remove.
 */
const backups = allBackups.filter((f) => existsSync(path.join(backupRoot, f.replace(/\.db$/, ".manifest.json"))));
const skipped = allBackups.filter((f) => !backups.includes(f));

if (allBackups.length === 0) {
  console.error(`No backups found in ${backupRoot}. Run "npm run backup -w @fnb/server" first.`);
  process.exit(1);
}
if (skipped.length > 0) {
  console.warn(`\n!! ${skipped.length} backup(s) have NO manifest and cannot be verified: ${skipped.join(", ")}`);
}
if (backups.length === 0) {
  console.error(`\nNo verifiable backup in ${backupRoot} — every one is missing its manifest.`);
  process.exit(1);
}

const latest = path.join(backupRoot, backups[0]);
const scratch = mkdtempSync(path.join(tmpdir(), "fnb-restore-"));
const restored = path.join(scratch, "restored.db");

console.log(`\n== restoring ${backups[0]} (${(statSync(latest).size / 1024 / 1024).toFixed(1)} MB)`);

try {
  copyFileSync(latest, restored);

  console.log("\n== 1. structural");
  {
    const db = new Database(restored, { readonly: true });
    try {
      ok("integrity_check", db.pragma("integrity_check", { simple: true }) === "ok");
      ok("foreign_key_check finds no orphans", db.pragma("foreign_key_check").length === 0);

      // The schema this code expects. A backup taken before a migration
      // restores fine and then fails at runtime in a much more confusing way.
      const applied = db
        .prepare("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name")
        .all()
        .map((r) => r.migration_name);
      const onDisk = readdirSync(path.join(serverRoot, "prisma", "migrations"))
        .filter((d) => /^\d{14}_/.test(d))
        .sort();
      const missing = onDisk.filter((m) => !applied.includes(m));
      ok(
        "schema is current with prisma/migrations",
        missing.length === 0,
        missing.length ? `missing: ${missing.join(", ")}` : `${applied.length} applied`,
      );
    } finally {
      db.close();
    }
  }

  /**
   * Compared against the backup's OWN manifest, not against the live database.
   *
   * Checking a restored copy against live looks right and is wrong: the two
   * legitimately diverge the moment anyone uses the app, so the drill would fail
   * on ordinary business activity and everyone would learn to ignore it. (That
   * is not hypothetical — the first version of this script did exactly that and
   * failed on eight activity rows written by a browser session.)
   *
   * The manifest is written by backup.mjs from the backup itself, so this
   * asserts the only thing a restore can actually promise: what went in comes
   * back out.
   */
  // NOT process.exit() — that skips the `finally` below and leaves a full
  // unencrypted copy of the production database sitting in the OS temp
  // directory, world-readable on most systems, on every early return. Throw
  // instead, so the cleanup always runs.
  const manifestPath = latest.replace(/\.db$/, ".manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `No manifest beside ${backups[0]}. Take a fresh backup and drill that.`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const copy = digestOf(restored);

  /**
   * Is there anything here to verify AT ALL?
   *
   * Every check below compares the restore against a manifest derived from the
   * same backup, which is deliberate (comparing to a moving live database
   * cries wolf on ordinary business activity) — but it means the comparisons
   * are self-referential and CANNOT fail on an empty backup: zeros match zeros,
   * the digest loop never iterates, and the drill reported "PASSED" on a
   * database with every table emptied. Reproduced before this guard existed.
   *
   * So the floor is asserted first, in absolute terms, before anything
   * relative is allowed to count as evidence.
   */
  console.log("\n== 2. the backup is not vacuous");
  ok("it contains users", (manifest.counts.users ?? 0) > 0, `${manifest.counts.users ?? 0}`);
  ok("it contains locations", (manifest.counts.locations ?? 0) > 0, `${manifest.counts.locations ?? 0}`);
  ok("it contains an audit trail", (manifest.counts.activityLog ?? 0) > 0, `${manifest.counts.activityLog ?? 0} rows`);
  ok(
    "it contains counted stock",
    (manifest.counts.countLines ?? 0) > 0,
    `${manifest.counts.countLines ?? 0} count lines`,
  );
  const withDigest = manifest.periods.filter((p) => p.digest).length;
  ok(
    "at least one location has an auditable period to compare",
    withDigest > 0,
    `${withDigest} of ${manifest.periods.length} locations`,
  );

  console.log("\n== 3. contents match what was backed up");
  for (const [table, n] of Object.entries(manifest.counts)) {
    ok(`${table}: ${n} rows`, copy.counts[table] === n, copy.counts[table] === n ? "" : `restored has ${copy.counts[table]}`);
  }

  console.log("\n== 3. the Full Audit still reconciles identically");
  ok(
    "same number of auditable locations",
    copy.periods.length === manifest.periods.length,
    `${copy.periods.length} vs ${manifest.periods.length}`,
  );
  for (const was of manifest.periods) {
    const now = copy.periods.find((p) => p.location === was.location);
    if (!was.digest) {
      ok(`${was.name}: no committed period to audit`, true, "skipped");
      continue;
    }
    // Guard against a digest that is silently hashing nothing — a check that
    // always passes is worse than no check.
    ok(`${was.name}: digest covers real fields`, was.digestedFields > 5, `${was.digestedFields} fields, ${was.rows} rows`);
    ok(
      `${was.name} (${was.period}): reconciliation identical`,
      Boolean(now) && now.digest === was.digest,
      now ? `${was.digest} vs ${now.digest}` : "location missing from restore",
    );
  }

  /**
   * How far behind live this backup is — reported, never asserted. This is the
   * measured RPO: the work that would be lost if the server died right now and
   * this were the copy you restored.
   */
  console.log("\n== 4. how much would be lost (measured RPO)");
  try {
    const live = digestOf(liveDb);
    const drift = Object.entries(live.counts)
      .map(([t, n]) => [t, n - (manifest.counts[t] ?? 0)])
      .filter(([, d]) => d !== 0);
    if (drift.length === 0) {
      console.log("       backup is current with live — nothing would be lost");
    } else {
      for (const [t, d] of drift) console.log(`       ${t}: live is ahead by ${d}`);
      console.log("       ^ this is what a restore from this backup would discard.");
    }
  } catch {
    console.log("       (live database unavailable — skipped)");
  }
} catch (err) {
  // Caught rather than left to propagate so the `finally` below still shreds
  // the restored copy, and so the operator gets a sentence instead of a stack.
  failures += 1;
  console.error(`\n FAIL  ${err instanceof Error ? err.message : String(err)}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  failures === 0
    ? `\nRESTORE DRILL PASSED in ${elapsed}s — record this as the measured RTO.\n`
    : `\n${failures} check(s) FAILED after ${elapsed}s. This backup is NOT restorable.\n`,
);
process.exit(failures === 0 ? 0 : 1);
