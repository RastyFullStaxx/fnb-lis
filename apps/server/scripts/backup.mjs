/**
 * Take a verified, tiered backup of the live database and its uploads.
 *
 *   npm run backup -w @fnb/server
 *
 * Built on better-sqlite3's online backup API rather than the `sqlite3` CLI,
 * which is NOT installed on the Windows dev machine (checked) and would be one
 * more thing to provision on every host. The API is the same SQLite backup
 * mechanism, and it is safe against a live writer — a plain file copy of a
 * WAL-mode database is not, it yields a torn database that opens fine and is
 * missing the most recent commits.
 *
 * Three things this does that a copy command does not:
 *   1. Verifies the backup opens and passes integrity_check BEFORE keeping it.
 *      An unverified backup is a belief, not a backup.
 *   2. Copies new uploads. They are content-addressed by SHA-256 and therefore
 *      immutable, so "copy what isn't there" is a correct incremental sync.
 *   3. Prunes on a tiered schedule, so this can run hourly forever without
 *      either filling the disk or silently losing last month's history.
 *
 * What it deliberately does NOT do: back up .env. That file holds
 * ANTHROPIC_API_KEY and FNB_MFA_KEY, and putting the encryption key in the same
 * archive as the ciphertext it protects defeats the point. See
 * docs/security-runbook.md §2.
 */
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");

if (existsSync(path.join(serverRoot, ".env"))) {
  process.loadEnvFile(path.join(serverRoot, ".env"));
}

const dbFile = process.env.FNB_DB_FILE
  ? path.resolve(process.env.FNB_DB_FILE)
  : path.join(serverRoot, "data", "fnb.db");

/**
 * Default is a sibling of the database, which is enough for the "I broke it
 * five minutes ago" case and NOT enough for anything else — one failed disk
 * takes both. FNB_BACKUP_DIR should point at a different volume, and the
 * nightly copy at a different machine entirely.
 */
const backupRoot = process.env.FNB_BACKUP_DIR
  ? path.resolve(process.env.FNB_BACKUP_DIR)
  : path.join(serverRoot, "data", "backups");

const uploadsDir = process.env.FNB_UPLOADS_DIR
  ? path.resolve(process.env.FNB_UPLOADS_DIR)
  : path.join(serverRoot, "data", "uploads");

/** Retention, in the tiers docs/security-runbook.md §2 commits to. */
const KEEP_ALL_HOURS = 48;
const KEEP_DAILY_DAYS = 30;
const KEEP_WEEKLY_WEEKS = 52;

const HOUR = 3600_000;
const DAY = 24 * HOUR;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Parse the timestamp back out of a filename, so pruning needs no sidecar state. */
function parseStamp(name) {
  const m = /^fnb-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi, s);
}

/**
 * Keep everything recent, then one per day, then one per week. Written as
 * "claim a slot, keep the first that fills it" rather than deleting by age, so
 * a gap in the schedule (host was off) never causes a tier to end up empty.
 */
function prune(dir, now) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => ({ f, at: parseStamp(f) }))
    .filter((x) => x.at)
    .sort((a, b) => b.at - a.at); // newest first

  const keep = new Set();
  const dailySlots = new Set();
  const weeklySlots = new Set();

  for (const { f, at } of files) {
    const age = now - at;
    if (age <= KEEP_ALL_HOURS * HOUR) {
      keep.add(f);
      continue;
    }
    if (age <= KEEP_DAILY_DAYS * DAY) {
      const slot = Math.floor(at / DAY);
      if (!dailySlots.has(slot)) {
        dailySlots.add(slot);
        keep.add(f);
      }
      continue;
    }
    if (age <= KEEP_WEEKLY_WEEKS * 7 * DAY) {
      const slot = Math.floor(at / (7 * DAY));
      if (!weeklySlots.has(slot)) {
        weeklySlots.add(slot);
        keep.add(f);
      }
    }
  }

  let removed = 0;
  for (const { f } of files) {
    if (keep.has(f)) continue;
    rmSync(path.join(dir, f), { force: true });
    // The manifest is only meaningful beside its backup — orphaning it would
    // leave the directory looking like it holds more restore points than it does.
    rmSync(path.join(dir, f.replace(/\.db$/, ".manifest.json")), { force: true });
    removed += 1;
  }
  return { kept: keep.size, removed };
}

/** Uploads are SHA-named and immutable, so absence is the only thing to check. */
function syncUploads(src, dest) {
  if (!existsSync(src)) return 0;
  mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(src)) {
    const from = path.join(src, name);
    if (!statSync(from).isFile()) continue;
    const to = path.join(dest, name);
    if (existsSync(to)) continue;
    copyFileSync(from, to);
    copied += 1;
  }
  return copied;
}

const main = async () => {
  if (!existsSync(dbFile)) {
    console.error(`No database at ${dbFile}`);
    process.exit(1);
  }
  mkdirSync(backupRoot, { recursive: true });

  const target = path.join(backupRoot, `fnb-${stamp()}.db`);
  console.log(`source : ${dbFile}`);
  console.log(`target : ${target}`);

  const db = new Database(dbFile, { readonly: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }

  // Verify BEFORE the backup is allowed to count. A corrupt backup that sits in
  // the directory looking like a backup is worse than a missing one, because it
  // is the one you will reach for.
  const check = new Database(target, { readonly: true });
  let integrity;
  let counts;
  try {
    integrity = check.pragma("integrity_check", { simple: true });
    counts = check
      .prepare("SELECT COUNT(*) AS n FROM ActivityLog")
      .get().n;
  } finally {
    check.close();
  }

  if (integrity !== "ok") {
    rmSync(target, { force: true });
    console.error(`integrity_check FAILED (${integrity}) — backup discarded`);
    process.exit(1);
  }

  const bytes = statSync(target).size;
  console.log(`verified: integrity ok, ${counts} activity rows, ${(bytes / 1024 / 1024).toFixed(1)} MB`);

  /**
   * A manifest of what this backup SAYS, computed from the backup itself.
   *
   * Without it the restore drill has nothing honest to compare against. Checking
   * a restored copy against the LIVE database looks right and is wrong: the two
   * legitimately diverge the moment anyone uses the app, so the drill fails on
   * ordinary business activity and everyone learns to ignore it. The backup has
   * to be checked against its own recorded state.
   *
   * Written after integrity passes, so a manifest never describes a backup that
   * was discarded.
   */
  const manifest = execFileSync("npx", ["tsx", "scripts/audit-digest.ts"], {
    cwd: serverRoot,
    env: { ...process.env, FNB_DB_FILE: target },
    encoding: "utf-8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(target.replace(/\.db$/, ".manifest.json"), manifest);
  const parsed = JSON.parse(manifest);
  console.log(`manifest: ${parsed.periods.filter((p) => p.digest).length} auditable location(s) fingerprinted`);

  const copied = syncUploads(uploadsDir, path.join(backupRoot, "uploads"));
  if (copied > 0) console.log(`uploads : ${copied} new file(s) copied`);

  const { kept, removed } = prune(backupRoot, Date.now());
  console.log(`retained: ${kept} backup(s), pruned ${removed}`);
  console.log("OK");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
