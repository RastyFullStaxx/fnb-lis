# Legacy Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the legacy FnB/LIS MySQL records into the rebuild — master data live, history at its true dates — and unblock production go-live by giving a fresh database a reference-data bootstrap.

**Architecture:** Three commands. `db:bootstrap` creates reference data and the first ADMIN (extracted from `seed.ts`, which currently entangles them with demo fixtures). `import:legacy` runs six ordered, individually re-runnable stages against a scratch MariaDB copy of `fnb.sql`, dry-run by default, idempotent via a new `LegacyMap` table. `verify:legacy` proves the migrated numbers against real legacy reports.

**Tech Stack:** TypeScript, `tsx`, Prisma 7 + better-sqlite3 adapter, MariaDB (XAMPP, read-only source), Node 22. **Zero new npm dependencies.**

**Spec:** [2026-08-23-legacy-migration-design.md](../specs/2026-08-23-legacy-migration-design.md)

## Global Constraints

Copied verbatim from the project's standing rules — every task's requirements implicitly include these.

- **Never commit or push.** The user commits between sessions. Every "Checkpoint" step below is a stop, not a `git commit`.
- **No automated tests during the build.** Verification is golden fixtures + `verify:*` harnesses + live checks. Do not add a test framework. Test cycles in this plan are replaced by harness runs and dry-run report inspection.
- **Never alter reconciliation math** — `packages/core/reconciliation.ts`, `weighing.ts`, `pricing.ts`, `rounding.ts`. This work does not touch them.
- All rounding via `phpRound`. No `Math.round` / `toFixed` in domain code.
- Committed records are immutable: void + `correctionOfId`. Every mutation writes `ActivityLog` **in the same `$transaction`**.
- SQLite portability: no enums, no `Json`, `Float` not `Decimal`, business dates TEXT `YYYY-MM-DD`.
- **Windows dev loop:** `prisma migrate dev` does **not** regenerate the client — run `npm run db:generate -w @fnb/server` after. Stop the dev server before migrating; kill orphan `node` processes if the SQLite file stays locked.
- Typecheck both workspaces before declaring any task done: `npm run typecheck -w @fnb/server` and `-w @fnb/web`.
- Re-run `npm run verify:seed -w @fnb/server` after touching anything the golden fixtures depend on, and say so.
- Roles are `ADMIN | OWNER | MANAGER | STAFF | ACCOUNTANT | AUDIT_VIEWER | AUDIT_VIEWER_LIMITED` (`@fnb/core` `ROLES`). The schema comment on `User.role` is stale — trust `constants.ts`.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `apps/server/prisma/bootstrap.ts` | Reference data (units, categories, settings) + first ADMIN. Imported by `seed.ts`, runnable alone. |
| `apps/server/scripts/legacy/source.ts` | Read-only access to the scratch MariaDB copy. One `query<T>()` helper. |
| `apps/server/scripts/legacy/units.ts` | The explicit `bottle_uom` → `Unit.name` table and category-type mapping. Pure data + lookup, no I/O. |
| `apps/server/scripts/legacy/map.ts` | `LegacyMap` read/write helpers — `resolve()`, `record()`. |
| `apps/server/scripts/legacy/report.ts` | Accumulates the dry-run/apply report and prints it. |
| `apps/server/scripts/legacy/stages/reference.ts` | Stage: categories. |
| `apps/server/scripts/legacy/stages/tenancy.ts` | Stage: clients, locations, modules, subscriptions, users. |
| `apps/server/scripts/legacy/stages/catalog.ts` | Stage: items, variants, weights. |
| `apps/server/scripts/legacy/stages/pricing.ts` | Stage: LocationItem. |
| `apps/server/scripts/legacy/stages/menus.ts` | Stage: menu items, recipe versions, recipe lines. |
| `apps/server/scripts/legacy/stages/counts.ts` | Stage: count sessions + lines. The hardest stage. |
| `apps/server/scripts/legacy/stages/transactions.ts` | Stage: sales, purchases, forfeits. |
| `apps/server/scripts/legacy/stages/trail.ts` | Stage: activity log. |
| `apps/server/scripts/import-legacy.ts` | CLI: arg parsing, stage ordering, transaction boundaries. |
| `apps/server/prisma/verify-legacy.mjs` | Parity harness, sibling to `verify-seed.mjs`. |

**Modified:** `apps/server/prisma/schema.prisma` (add `LegacyMap`) · `apps/server/prisma/seed.ts` (import from `bootstrap.ts`) · `apps/server/package.json` (scripts) · `docs/security-runbook.md` (§0 gains `db:bootstrap`) · `docs/build-log.md` (final entry).

Stages are separate files because each is independently re-runnable and independently reviewable, and because a single `import-legacy.ts` holding all six would be the kind of file that becomes unmaintainable at exactly the moment it matters.

---

## Task 1: Bootstrap extraction  ✅ DONE 2026-08-23

Ships first and is independently valuable: **production cannot currently be logged into**, migration or not.

**Files:**
- Create: `apps/server/prisma/bootstrap.ts`
- Modify: `apps/server/prisma/seed.ts:1-30` (imports), `apps/server/prisma/seed.ts:227-463` (delete the three extracted functions), `apps/server/prisma/seed.ts:1489-1495` (call imported versions)
- Modify: `apps/server/package.json` (add `db:bootstrap`)
- Modify: `docs/security-runbook.md` §0 "Host" checklist

**Interfaces:**
- Produces: `seedUnits()`, `seedCategories()`, `seedSettings()`, `seedAdmin()`, `bootstrapAll()` — all `async () => Promise<void>`, all exported from `prisma/bootstrap.ts`, all idempotent (upsert-based).
- Produces: `G_PER_OZ = 28.349523125`, `gramsFromOz(oz: number): number`, `densityPerGram(perOz: number): number` — moved out of `seed.ts:1485-1487` and exported, because the importer needs the identical constant. Two definitions of the ounce would drift.

- [x] **Step 1: Record the current golden-fixture baseline**

Before touching anything, capture the numbers you must not move.

```bash
npm run verify:seed -w @fnb/server
```

Expected: PASS. Save the full output to compare against in Step 6. If it does not pass before you start, stop and report — you cannot attribute a later failure to your change.

- [x] **Step 2: Create `prisma/bootstrap.ts`**

Move `seedUnits` (`seed.ts:227-262`), `seedCategories` (`seed.ts:263-357`) and `seedSettings` (`seed.ts:358-463`) **verbatim** — no edits, no "improvements". Export each. Add the two units the legacy data needs and the admin bootstrap:

```ts
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/auth/password";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

// … seedUnits / seedCategories / seedSettings moved here verbatim …
// In seedUnits, append to the `units` array:
//   { name: "portion", kind: "COUNT", factorToBase: 1 },
//   { name: "order",   kind: "COUNT", factorToBase: 1 },
// Both are legacy `bottle_uom` values with no existing equivalent
// (5 and 1 rows respectively). Added here, never invented mid-import.

/**
 * One ADMIN for a fresh production database. There is no mustChangePassword
 * column and this does not add one — the password is random, printed once, and
 * changed through the app.
 */
export async function seedAdmin() {
  const username = process.env.FNB_ADMIN_USER;
  if (!username) throw new Error("FNB_ADMIN_USER is required for bootstrap");
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`[bootstrap] admin "${username}" already exists — leaving it alone`);
    return;
  }
  const password = randomBytes(18).toString("base64url");
  await prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword(password),
      firstName: process.env.FNB_ADMIN_FIRST ?? "System",
      lastName: process.env.FNB_ADMIN_LAST ?? "Administrator",
      email: process.env.FNB_ADMIN_EMAIL ?? null,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });
  console.log("─".repeat(60));
  console.log(`  ADMIN CREATED: ${username}`);
  console.log(`  PASSWORD:      ${password}`);
  console.log("  Shown once. Store it, then change it in the app.");
  console.log("─".repeat(60));
}

export async function bootstrapAll() {
  await seedUnits();
  await seedCategories();
  await seedSettings();
  await seedAdmin();
}
```

Verify the import path for `hashPassword` against `apps/server/src/auth/password.ts` before writing it — do not assume the export name.

- [x] **Step 3: Add the runnable entry point**

At the bottom of `bootstrap.ts`, guard it so importing from `seed.ts` does not run it:

```ts
const isDirectRun = process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/bootstrap.ts");
if (isDirectRun) {
  bootstrapAll()
    .then(() => console.log("Bootstrap complete."))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
```

- [x] **Step 4: Rewire `seed.ts`**

Delete the three moved function bodies. Add at the top:

```ts
import { seedUnits, seedCategories, seedSettings } from "./bootstrap";
```

`main()` keeps calling `seedUnits()`, `seedCategories()`, `seedSettings()` in the same order at `seed.ts:1492-1494`. **Do not** call `seedAdmin()` from `seed.ts` — demo accounts stay demo accounts.

Note: `bootstrap.ts` creates its own `PrismaClient`. If `seed.ts` also holds one, both are open during a seed run. That is acceptable for a script; do not refactor the seeder's client management as part of this task.

- [x] **Step 5: Add the npm script**

In `apps/server/package.json`, next to `db:deploy`:

```json
"db:bootstrap": "tsx prisma/bootstrap.ts"
```

- [x] **Step 6: Prove the golden fixtures did not move**

```bash
npm run db:generate -w @fnb/server && npm run typecheck -w @fnb/server && npm run verify:seed -w @fnb/server
```

Expected: typecheck clean, `verify:seed` PASS with output identical to Step 1. **A single changed number here means the extraction was not verbatim — revert and redo it.** Also run:

```bash
npm run verify:sync -w @fnb/server && npm run verify:security -w @fnb/server
```

- [x] **Step 7: Prove bootstrap works on an empty database**

```bash
FNB_DB_FILE=data/bootstrap-test.db npx prisma migrate deploy --schema apps/server/prisma/schema.prisma
```

Then run bootstrap against that same throwaway file and confirm it creates units, categories, settings and one admin. Delete `data/bootstrap-test.db` afterwards. This is the only proof that the go-live path actually works; skipping it re-creates the exact gap this task exists to close.

- [x] **Step 8: Update the runbook**

In `docs/security-runbook.md` §0 "Host", after the `db:deploy` step in Phase D4, add `npm run db:bootstrap -w @fnb/server` with a one-line note that it creates reference data and the first ADMIN, and that `db:seed` must still never run in production.

- [x] **Step 9: Checkpoint**

Report to the user: files changed, `verify:seed` result (identical or not), and that the production login gap is closed. **Do not commit.**

---

## Task 2: `LegacyMap` schema, the legacy source reader, and the CLI  ✅ DONE 2026-08-23

**Files:**
- Modify: `apps/server/prisma/schema.prisma` (append `LegacyMap`)
- Create: `apps/server/scripts/legacy/source.ts`
- Create: `apps/server/scripts/legacy/map.ts`
- Create: `apps/server/scripts/import-legacy.ts`

**Interfaces:**
- Produces: `query<T>(sql: string): T[]` from `source.ts`; `loadDump(): void` from `source.ts`.
- Produces: `resolve(db: Tx, table: string, legacyId: string | number): Promise<string | null>` and `record(db: Tx, table: string, legacyId: string | number, newId: string): Promise<void>` from `map.ts`, where `Tx = Prisma.TransactionClient | PrismaClient`.
- Produces: `type Stage = { name: string; run: (tx: Prisma.TransactionClient, report: Report, adminId: string) => Promise<void> }` and the `STAGE_ORDER` array from `import-legacy.ts`. **Every later task registers its stage against this exact signature** — do not vary it.

- [x] **Step 1: Add the model**

Append to `apps/server/prisma/schema.prisma`:

```prisma
/// Maps a legacy MySQL row to the record it became, so `import:legacy` is
/// idempotent. Without it a second run duplicates 8,525 count lines.
/// Migration-only: no application route reads this table.
model LegacyMap {
  id          String @id @default(cuid())
  legacyTable String
  legacyId    String
  newId       String

  @@unique([legacyTable, legacyId])
}
```

- [x] **Step 2: Migrate and regenerate**

Stop the dev server first. Then:

```bash
npx prisma migrate dev --name legacy-map --schema apps/server/prisma/schema.prisma
```

```bash
npm run db:generate -w @fnb/server
```

`migrate dev` does not regenerate the client — the second command is not optional. If the SQLite file stays locked, kill orphan `node` processes by command line, not by name.

- [x] **Step 3: Load the dump into a scratch MariaDB database** — XAMPP's MariaDB cannot complete startup (InnoDB LSN-in-future); used an ISOLATED MariaDB 11.4 instance on port 3399 with a throwaway datadir at `C:/temp/fnb-legacy-db`. Setup + teardown documented in `scripts/legacy/source.ts`.

This is a one-time operator step, not code. Document it in the script's header comment:

```bash
"C:/xampp/mysql/bin/mysql.exe" -u root -e "DROP DATABASE IF EXISTS fnb_legacy; CREATE DATABASE fnb_legacy CHARACTER SET utf8mb4;"
```

```bash
"C:/xampp/mysql/bin/mysql.exe" -u root fnb_legacy < "C:/xampp/htdocs/fnb-main/fnb.sql"
```

- [x] **Step 4: Write `source.ts`**

```ts
import { execFileSync } from "node:child_process";

/**
 * Read-only access to the legacy database.
 *
 * Deliberately NOT a hand-written .sql parser. Two were attempted during design
 * and both silently mis-read fnb.sql — one reported 114 rows where there were
 * 48,322 (multi-line tuples), the other 494 catalog rows where there were 2,156
 * (only the first INSERT chunk per table). Both looked like they worked. A
 * migration with a silently wrong reader produces a database that is plausibly,
 * undetectably incorrect. MariaDB is already installed; it parses its own dumps.
 */
const MYSQL = process.env.FNB_MYSQL_BIN ?? "C:/xampp/mysql/bin/mysql.exe";
const DB = process.env.FNB_LEGACY_DB ?? "fnb_legacy";
const USER = process.env.FNB_MYSQL_USER ?? "root";

export function query<T>(sql: string): T[] {
  const out = execFileSync(
    MYSQL,
    [`-u${USER}`, "--batch", "--raw", "--skip-column-names", DB, "-e", sql],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as T);
}
```

Every caller selects a single `JSON_OBJECT(...)` column. `--raw` is required or MySQL escapes the JSON and `JSON.parse` fails.

- [x] **Step 5: Write `map.ts`**

```ts
import type { Prisma, PrismaClient } from "../../src/generated/prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

export async function resolve(db: Tx, table: string, legacyId: string | number) {
  const row = await db.legacyMap.findUnique({
    where: { legacyTable_legacyId: { legacyTable: table, legacyId: String(legacyId) } },
  });
  return row?.newId ?? null;
}

export async function record(db: Tx, table: string, legacyId: string | number, newId: string) {
  await db.legacyMap.upsert({
    where: { legacyTable_legacyId: { legacyTable: table, legacyId: String(legacyId) } },
    update: { newId },
    create: { legacyTable: table, legacyId: String(legacyId), newId },
  });
}
```

Confirm the generated compound-unique argument name (`legacyTable_legacyId`) against `apps/server/src/generated/prisma` after Step 2 rather than assuming it.

- [x] **Step 6: Write the CLI — dry run by rollback, not by simulation**

`apps/server/scripts/import-legacy.ts`:

```ts
/**
 * Legacy migration CLI. DRY RUN BY DEFAULT — writing requires --confirm.
 *
 *   npx tsx apps/server/scripts/import-legacy.ts                  # dry run, all stages
 *   npx tsx apps/server/scripts/import-legacy.ts --stage=catalog  # dry run, one stage
 *   npx tsx apps/server/scripts/import-legacy.ts --confirm        # APPLY, all stages
 *
 * Take a backup first:  npm run backup -w @fnb/server
 */
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { Report } from "./legacy/report";

const prisma = new PrismaClient();

export type Stage = {
  name: string;
  run: (tx: Prisma.TransactionClient, report: Report, adminId: string) => Promise<void>;
};

/** Order matters: each stage resolves ids the previous ones recorded. */
export const STAGE_ORDER = [
  "reference", "tenancy", "catalog", "pricing",
  "menus", "counts", "transactions", "trail",
] as const;

class DryRunRollback extends Error {}

async function runStage(stage: Stage, adminId: string, confirm: boolean) {
  const report = new Report();
  try {
    await prisma.$transaction(
      async (tx) => {
        await stage.run(tx, report, adminId);
        // Ledger invariant: one entry per stage, inside the same transaction
        // as its writes. One entry, not 48,000.
        await tx.activityLog.create({
          data: {
            userId: adminId,
            userName: "Legacy migration",
            action: `import.legacy.${stage.name}`,
            entity: "import",
            summary: `Legacy import stage "${stage.name}"`,
            detailsJson: JSON.stringify(report.totals()),
          },
        });
        if (!confirm) throw new DryRunRollback();
      },
      // 21,991 trail rows will not finish inside Prisma's 5s default.
      { timeout: 15 * 60_000, maxWait: 60_000 },
    );
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  report.print(confirm ? "APPLIED" : "DRY RUN");
}
```

**The dry run executes the real write path and rolls it back.** A dry run that runs *different* code from the apply proves nothing about the apply — it cannot surface a unique-constraint violation, a missing foreign key, or a null in a required column. This one surfaces all three, then discards the transaction.

Add `report.totals(): Record<string, number>` to `report.ts` (Task 3) returning the `created` map as a plain object.

- [x] **Step 7: Wire arg parsing and stage selection**

```ts
async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const only = args.find((a) => a.startsWith("--stage="))?.split("=")[1];
  const selected = only ? [only] : [...STAGE_ORDER];
  for (const name of selected) {
    if (!STAGE_ORDER.includes(name as (typeof STAGE_ORDER)[number]))
      throw new Error(`Unknown stage "${name}". Known: ${STAGE_ORDER.join(", ")}`);
  }
  const adminUser = process.env.FNB_ADMIN_USER;
  if (!adminUser) throw new Error("FNB_ADMIN_USER must name the bootstrap admin");
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: adminUser } });
  if (!confirm) console.log("DRY RUN — nothing will be written. Pass --confirm to apply.
");
  for (const name of selected) await runStage(STAGES[name], admin.id, confirm);
}

main().catch((e) => { console.error(e); process.exitCode = 1; })
      .finally(() => prisma.$disconnect());
```

`STAGES` is a `Record<string, Stage>` that later tasks populate as they create each stage file. Until Task 3 lands, register no stages and confirm the CLI exits cleanly with an empty selection.

**Rollback:** `npm run backup -w @fnb/server` before any `--confirm`. On a fresh production database the faster path is deleting the database file and re-running `migrate deploy` + `db:bootstrap`. State this in the file header.

- [x] **Step 8: Smoke-check the reader** — 8,525 audits via JSON_OBJECT; all 14 legacy `bottle_uom` values present and all covered by UOM_MAP

```bash
npx tsx -e "import('./apps/server/scripts/legacy/source.ts').then(m=>{const r=m.query(\"SELECT JSON_OBJECT('n', COUNT(*)) FROM client_bottle_audits\");console.log(r)})"
```

Expected: `[ { n: 8525 } ]`. Any other number means the dump did not load fully — stop and fix that before writing a single stage.

- [x] **Step 9: Typecheck and checkpoint**

```bash
npm run typecheck -w @fnb/server
```

Report the row count from Step 8. **Do not commit.**

---

## Task 3: Units, category mapping, and the report accumulator  ✅ DONE 2026-08-23

**Files:**
- Create: `apps/server/scripts/legacy/units.ts`
- Create: `apps/server/scripts/legacy/report.ts`
- Create: `apps/server/scripts/legacy/stages/reference.ts`

**Interfaces:**
- Consumes: `query` (Task 2), `record`/`resolve` (Task 2).
- Produces: `UOM_MAP: Record<string, string>`, `mapUom(raw: string): string` (throws on unknown), `productTypeFor(categoryType: number): string`, `densityFor(liquidWeight: number): number | null` from `units.ts`.
- Produces: `Report` class with `count(model, n)`, `skip(reason, detail)`, `flag(message)`, `print()` from `report.ts`.

- [x] **Step 1: Write `units.ts`**

```ts
/**
 * Legacy `bottle_uom` is free text and does not match Unit.name. Fourteen
 * distinct values are in use across 2,156 client_bottles rows.
 *
 * This table is exhaustive and mapUom THROWS on anything absent. Auto-creating
 * a unit from an unrecognised string is how `mil` — a one-row typo for `ml` —
 * would become a real Unit with no conversion factor, silently detaching a
 * variant from every calculation that converts.
 */
export const UOM_MAP: Record<string, string> = {
  ml: "ml",           // 1,525 rows
  kg: "kg",           //   364
  grams: "g",         //    75
  liter: "L",         //    58
  bottle: "bottle",   //    37
  piece: "pc",        //    33  — NOT "Piece", which is asset-register vocabulary
  can: "can",         //    28
  pack: "pack",       //    25
  portion: "portion", //     5  — added by db:bootstrap (Task 1)
  oz: "oz",           //     2
  case: "case",       //     1
  box: "box",         //     1
  order: "order",     //     1  — added by db:bootstrap (Task 1)
  mil: "ml",          //     1  — typo, normalised
};

export function mapUom(raw: string): string {
  const key = (raw ?? "").trim().toLowerCase();
  const mapped = UOM_MAP[key];
  if (!mapped) {
    throw new Error(
      `Unknown legacy bottle_uom "${raw}". Add it to UOM_MAP deliberately — ` +
      `do not let the importer invent a Unit.`,
    );
  }
  return mapped;
}

/** category_type: 1 = food (12 rows), 2 = beverage (32). No type 3 exists. */
export function productTypeFor(categoryType: number): string {
  if (categoryType === 1) return "Food";
  if (categoryType === 2) return "Beverage";
  throw new Error(`Unexpected legacy category_type ${categoryType}`);
}

/**
 * liquid_weight 0.00 means "not weighable", NOT "density zero".
 *
 * Twelve legacy categories (Groceries, Liquer, …) carry 0.00. Importing that
 * literally would make every weigh count on them compute
 * (scale - tare) x 0 = 0 ml — a total, silent loss of open-container content
 * that integrity_check and every type check would pass. Null is the
 * "derived, not configured" fallback resolveDensityFactor already expects.
 */
export function densityFor(liquidWeightPerOz: number): number | null {
  // Converts as well as guards: legacy is ml-per-OUNCE, this database stores
  // ml-per-GRAM (seed.ts:1487). Returning the raw legacy number here is the
  // single most damaging thing this file could do — see spec §6.5.
  return liquidWeightPerOz > 0 ? densityPerGram(liquidWeightPerOz) : null;
}
```

- [x] **Step 2: Write `report.ts`**

```ts
export class Report {
  private created = new Map<string, number>();
  private skipped: Array<{ reason: string; detail: string }> = [];
  private flags: string[] = [];

  count(model: string, n = 1) { this.created.set(model, (this.created.get(model) ?? 0) + n); }
  skip(reason: string, detail: string) { this.skipped.push({ reason, detail }); }
  flag(message: string) { this.flags.push(message); }

  print(mode: "DRY RUN" | "APPLIED") {
    console.log(`\n===== ${mode} =====`);
    for (const [model, n] of [...this.created].sort()) console.log(`  ${model.padEnd(24)} ${n}`);
    if (this.skipped.length) {
      console.log(`\n  SKIPPED (${this.skipped.length}) — every row listed, none silent:`);
      for (const s of this.skipped) console.log(`    [${s.reason}] ${s.detail}`);
    }
    if (this.flags.length) {
      console.log(`\n  NEEDS A HUMAN (${this.flags.length}):`);
      for (const f of this.flags) console.log(`    ${f}`);
    }
  }
}
```

- [x] **Step 3: Write the reference stage**

`stages/reference.ts` reads legacy `categories` and upserts `Category`:

```sql
SELECT JSON_OBJECT('category_id', category_id, 'category_name', category_name,
                   'category_type', category_type, 'liquid_weight', liquid_weight)
FROM categories
```

For each row: `name` = `category_name`, `productType` = `productTypeFor(category_type)`, `defaultDensityFactor` = `densityFor(Number(liquid_weight))`, `defaultPerishable` = `productType === "Food"`. Upsert on `name` (unique, and confirmed to have no duplicates across the 45 legacy rows). Record in `LegacyMap` under `"categories"`. Increment `report.count("Category")`.

If a category name already exists from `db:bootstrap` with a *different* `defaultDensityFactor`, do not overwrite it — `report.flag()` it with both values and keep the bootstrap value. The seeded densities are the verified ones from `architecture.md` §6.

- [x] **Step 4: Dry-run the stage and read the report**

Wire a minimal `import-legacy.ts` that runs only this stage under `--dry-run`, then:

```bash
npx tsx apps/server/scripts/import-legacy.ts --stage=reference
```

Expected: 44-45 categories counted, zero skips, and any density conflicts flagged. **Read the flag list.** One legacy category row fails naive parsing but MariaDB reads it correctly — confirm the count is 45, not 44.

- [x] **Step 5: Typecheck and checkpoint**

```bash
npm run typecheck -w @fnb/server
```

Report the category count and every flag raised. **Do not commit.**

---

## Task 4: Tenancy stage  ✅ DONE 2026-08-23 (applied to dev db)

**Files:**
- Create: `apps/server/scripts/legacy/stages/tenancy.ts`
- Modify: `apps/server/scripts/import-legacy.ts` (register the stage)

**Interfaces:**
- Consumes: `query`, `resolve`, `record`, `Report`.
- Produces: `LOCATION_PLAN` — the literal branch→location mapping, exported so `counts.ts` and `pricing.ts` reuse it rather than re-deriving it.

- [x] **Step 1: Encode the mapping as data, not logic**

```ts
/**
 * Three Clients, five Locations. Legacy `clients` conflates business and venue;
 * the rebuild separates Client (tenant: roles, suppliers, subscription) from
 * Location (venue). This is the pattern seed.ts:1497 documents as supported.
 *
 * Mansion branches 73 and 74 are ONE venue: 74 shares 308 of its 308 catalog
 * items with 73 and exists only to hold a second audit cadence, which the
 * rebuild expresses as a date range rather than a second tenant.
 */
export const LOCATION_PLAN = [
  { client: "Mansion Sports Bar & Lounge", location: "Sports Bar", branches: ["73", "74"], module: "BAR",     legacyClients: ["35", "36"] },
  { client: "Mansion Sports Bar & Lounge", location: "Kitchen",    branches: ["90"],       module: "KITCHEN", legacyClients: ["52"] },
  { client: "Xylo",                        location: "Bar",        branches: ["93"],       module: "BAR",     legacyClients: ["55"] },
  { client: "Xylo",                        location: "Kitchen",    branches: ["87"],       module: "KITCHEN", legacyClients: ["49"] },
  { client: "Sample Kitchen",              location: "Main",       branches: ["88"],       module: "KITCHEN", legacyClients: ["50"] },
] as const;

/** Branch id -> the location it belongs to. Built from LOCATION_PLAN, never hand-maintained. */
export const BRANCH_TO_LOCATION = new Map<string, string>(
  LOCATION_PLAN.flatMap((p) => p.branches.map((b) => [b, `${p.client}::${p.location}`] as const)),
);
```

`"Xylo"` is synthesised — legacy has no parent row, only "Xylo Bar" (55) and "Xylo Kitchen" (49). Record **both** legacy client ids against the one new Client in `LegacyMap`.

- [x] **Step 2: Create clients, locations, modules**

For each distinct `client` in `LOCATION_PLAN`: upsert `Client` by name; record every `legacyClients` id against it. For each entry: upsert `Location` by `(clientId, name)`; create the `LocationModule` row; record each branch id under `"branches"`.

- [x] **Step 3: Create subscriptions, flagged not guessed**

One `Subscription` per Client with `SubscriptionModule` rows for the modules its locations use, `maxEntities` = that client's location count, `billingCycle: "MONTHLY"`, `packageType: "BASIC"`.

Then, for every client:

```ts
report.flag(
  `Subscription for "${clientName}": packageType/maxUsers/maxDevices are commercial ` +
  `decisions the importer cannot know. Set them in Admin before go-live.`,
);
```

Guessing a billing tier silently is worse than leaving it flagged.

- [x] **Step 4: Import users, at the lowest role, disabled**

```sql
SELECT JSON_OBJECT('user_id', user_id, 'username', username,
                   'user_level', user_level, 'status', status)
FROM users
```

For each of the 7 rows:

```ts
await tx.user.create({
  data: {
    username: `legacy_${row.username}`,
    passwordHash: UNUSABLE_HASH,      // see below
    firstName: row.username, lastName: "(migrated)",
    role: "AUDIT_VIEWER_LIMITED",     // lowest role in @fnb/core ROLES
    status: "DISABLED",
  },
});
```

`UNUSABLE_HASH` is a constant string that cannot be produced by `hashPassword` (e.g. `"!migrated-no-credential"`). Verify against `apps/server/src/auth/password.ts` that `verifyPassword` **rejects a malformed hash** rather than throwing an unhandled error — `security.md` states malformed hashes are rejected, but confirm it before relying on it.

`legacy_` prefix avoids colliding with the bootstrap ADMIN or any real account.

Then flag every one:

```ts
report.flag(`User "legacy_${row.username}" imported DISABLED at AUDIT_VIEWER_LIMITED. ` +
            `Legacy user_level ${row.user_level} is undocumented — assign the real role deliberately.`);
```

- [x] **Step 5: Record the exclusions explicitly**

```ts
for (const c of ["copyTest", "anotherTest", "theTest"])
  report.skip("test-client", c);
report.skip("below-threshold", "The Bar 2023 (branch 89): 10 catalog rows, 21 counts, 4 sales");
```

Also query for branches whose `client_id` has no row in `clients` and `report.skip("orphan-branch", …)` each. Expected: 31.

- [x] **Step 6: Dry-run and read the report**

```bash
npx tsx apps/server/scripts/import-legacy.ts --stage=tenancy
```

Expected: 3 Clients, 5 Locations, 5 LocationModules, 3 Subscriptions, 7 Users; 31 orphan-branch skips, 3 test-client skips, 1 below-threshold skip; 3 subscription flags + 7 user flags.

- [x] **Step 7: Apply, then verify in the app**

```bash
npx tsx apps/server/scripts/import-legacy.ts --stage=tenancy --confirm
```

Run the app (`npm run dev`) and confirm the three clients and five locations appear in the Clients admin screen with the right module badges. A stage that reports success but produces something the UI cannot display is not done.

- [x] **Step 8: Typecheck and checkpoint**

```bash
npm run typecheck -w @fnb/server
```

Report counts, skips and flags verbatim. **Do not commit.**

---

## Task 5: Catalog stage — items, variants, weights  ✅ DONE 2026-08-23 (applied to dev db)

**Files:**
- Create: `apps/server/scripts/legacy/stages/catalog.ts`

**Interfaces:**
- Consumes: `mapUom`, `resolve("categories", …)`, `Report`.
- Produces: `LegacyMap` entries under `"bottles"` (→ `Item.id`) and `"bottle_sizes"` (→ `ItemVariant.id`, keyed `"<bottle_id>|<size>|<uom>"`).

- [x] **Step 1: Import items**

```sql
SELECT JSON_OBJECT('bottle_id', bottle_id, 'bottle_name', bottle_name,
                   'category_id', category_id, 'is_deleted', is_deleted)
FROM bottles
```

1,205 rows. `isActive` = `is_deleted != 1`. **Do not skip deleted items** — a deleted bottle still appears in historical counts, and skipping it would break the count stage with an unresolvable reference.

Resolve `categoryId` through `LegacyMap`. If a bottle's `category_id` has no mapped category, `report.skip("unmapped-category", …)` and skip the item — but expect zero of these; investigate any that appear.

- [x] **Step 2: Import variants with their weights**

```sql
SELECT JSON_OBJECT('bottle_id', s.bottle_id, 'bottle_size', s.bottle_size,
                   'bottle_uom', s.bottle_uom, 'tare_weight', s.tare_weight,
                   'lw', (SELECT lw2.liquid_weight FROM bottle_liquid_weights lw2
                          WHERE lw2.bottle_id = s.bottle_id
                            AND lw2.bottle_uom = s.bottle_uom LIMIT 1))
FROM bottle_sizes s
```

For each of the 1,251 rows:

```ts
const unitName = mapUom(row.bottle_uom);
const unit = await tx.unit.findUniqueOrThrow({ where: { name: unitName } });
// Product type still resolves through the item's CATEGORY (needed elsewhere),
// but it no longer decides contentTracked — see the comment below.
const item = await tx.item.findUniqueOrThrow({
  where: { id: itemId },
  select: { category: { select: { productType: true } } },
});
const productType = item.category.productType;
await tx.itemVariant.upsert({
  where: { itemId_size_unitId: { itemId, size: Number(row.bottle_size), unitId: unit.id } },
  update: {},
  create: {
    itemId,
    size: Number(row.bottle_size),
    unitId: unit.id,
    // NOT `productType === "Beverage"`. Legacy category_type 2 includes
    // Cigarette, Heets, Soda, Local Beer and (junk) Pants; only 247 of 1,251
    // variants carry a tare weight at all. Content-tracking a cigarette pack
    // would divide a count by its "size" and corrupt every period it appears in.
    //
    // This matches the seed's own pattern exactly: seed.ts marks contentTracked
    // true for precisely the items that have a tareWeight (Absolut, JD, Bacardi,
    // Bombay, Cuervo, House Red Wine, Grenadine) and false for beer, tonic, cola
    // and juice, which are never poured in fractions.
    //
    // ✅ RESOLVED 2026-08-23 — see the note after this block. Kept for the record:
    // ⚠️ OPEN QUESTION — resolve before the menus stage (Task 7) applies:
    // 66 Red Wine variants have NO tare weight, so this rule makes them
    // untracked. If a legacy recipe pours 150ml from a 750ml wine, an untracked
    // ingredient consumes `serving x qty` = 150 units instead of 0.2 bottles.
    // The menus stage must therefore REPORT every recipe ingredient whose
    // variant is untracked but whose serving is smaller than the variant size —
    // that list is the evidence for whether this rule needs widening. Do not
    // widen it on intuition; it feeds the reconciliation.
    contentTracked: Number(row.tare_weight) > 0 || size > 1,
    // RESOLVED from the legacy source, not by preference. reports.php:819 divides
    // recipe servings by bottle size UNCONDITIONALLY — legacy has no
    // contentTracked concept at all:
    //     $shotscontrol += ($loopshot->serving / $audit->bsize) * $qty
    // Dividing by size 1 is a no-op, so the rule only bites at size > 1. The
    // evidence was 81 recipe ingredients, all wine: a 750ml bottle poured at
    // 150ml is 0.2 bottles, not 150 units.
    // Legacy is on the OUNCE scale; this database stores GRAMS (seed.ts:487,1487).
    // Unconverted, a 750ml bottle computes ~1253ml of content. See spec §6.5.
    tareWeight: Number(row.tare_weight) > 0 ? gramsFromOz(Number(row.tare_weight)) : null,
    tareWeightUnit: Number(row.tare_weight) > 0 ? "g" : null,
    densityFactor: densityFor(Number(row.lw ?? 0)),   // densityFor now returns per-gram
  },
});
```

`tareWeight` gets the same zero-is-not-a-value treatment as density: a `0` tare would make `(scale − 0) × factor` report a full bottle as its own gross weight in content.

**Import `gramsFromOz` and `densityPerGram` from `prisma/bootstrap.ts`** (Task 1 exports them) rather than redefining the constant — one definition of `G_PER_OZ = 28.349523125`, shared by the seeder and the importer, or they drift.

- [x] **Step 3: Dry-run and inspect**

```bash
npx tsx apps/server/scripts/import-legacy.ts --stage=catalog
```

Expected: ~1,205 Items, ~1,251 ItemVariants, zero unknown-UOM errors. **If `mapUom` throws, that is the design working** — add the value to `UOM_MAP` deliberately in `units.ts` and re-run; never catch and default it.

- [x] **Step 4: Apply, then spot-check three variants against the source**

```bash
npx tsx apps/server/scripts/import-legacy.ts --stage=catalog --confirm
```

Pick one `ml` beverage, one `kg` food, and the single `mil` row. For each, compare `size`, `unit.name`, `tareWeight` and `densityFactor` against the legacy row read directly from MariaDB. Report the three comparisons.

- [x] **Step 5: Typecheck and checkpoint**

```bash
npm run typecheck -w @fnb/server
```

**Do not commit.**

---

## Task 6: Pricing stage — `LocationItem`  ✅ DONE 2026-08-23 (applied to dev db)

**Files:**
- Create: `apps/server/scripts/legacy/stages/pricing.ts`

**Interfaces:**
- Consumes: `BRANCH_TO_LOCATION` (Task 4), variant `LegacyMap` entries (Task 5).
- Produces: `LegacyMap` entries under `"client_bottles"` → `LocationItem.id`.

- [x] **Step 1: Import per-location catalog**

```sql
SELECT JSON_OBJECT('client_bottle_id', client_bottle_id, 'bottle_id', bottle_id,
                   'branch_id', branch_id, 'bottle_size', bottle_size,
                   'bottle_uom', bottle_uom, 'tare_weight', tare_weight,
                   'liquid_weight', liquid_weight, 'default_cost', default_cost,
                   'default_retail', default_retail, 'is_deleted', is_deleted)
FROM client_bottles
```

2,156 rows. Skip any whose `branch_id` is not in `BRANCH_TO_LOCATION`, recording `report.skip("branch-not-migrated", …)`. Upsert on `@@unique([locationId, itemVariantId])`.

`cost` ← `default_cost`, `retail` ← `default_retail`. Per-venue `tare_weight` / `liquid_weight` go to `LocationItem.tareWeight` / `.densityFactor` (with the same zero → null rule), **not** to the global `ItemVariant` — a client editing the shared variant would silently rewrite other tenants' numbers, which is the reason those override columns exist.

- [x] **Step 2: Handle the Mansion catalog merge**

Branches 73 and 74 both map to `Mansion Sports Bar & Lounge::Sports Bar` and share 308 of 308 items. On unique-constraint collision, **prefer branch 73's row** and record the discarded one:

```ts
report.skip("mansion-merge-duplicate-catalog",
  `client_bottle_id ${row.client_bottle_id} (branch 74) — branch 73's pricing kept for the same variant`);
```

- [x] **Step 3: Dry-run, apply, verify in the app**

```bash
npx tsx apps/server/scripts/import-legacy.ts --stage=pricing
```

Expected: ~1,850 LocationItems created (2,156 minus non-migrated branches minus ~308 Mansion duplicates). Then `--confirm`, then open Local Database in the app for Xylo Bar and confirm items show with cost and retail.

- [x] **Step 4: Typecheck and checkpoint**

```bash
npm run typecheck -w @fnb/server
```

Report the created count, the Mansion duplicate count, and the branch-not-migrated count. **Do not commit.**

---

## Task 7: Menus and recipes stage  ✅ DONE 2026-08-23 (applied to dev db)

**Files:**
- Create: `apps/server/scripts/legacy/stages/menus.ts`

**Interfaces:**
- Consumes: `BRANCH_TO_LOCATION`, `LocationItem` map (Task 6).
- Produces: `LegacyMap` under `"client_menus"` → `MenuItem.id` and `"client_menus_v1"` → `RecipeVersion.id`.

- [x] **Step 1: Create menu items and one initial recipe version each**

```sql
SELECT JSON_OBJECT('menu_id', menu_id, 'cocktail_name', cocktail_name,
                   'branch_id', branch_id, 'default_cost', default_cost,
                   'default_retail', default_retail, 'is_deleted', is_deleted)
FROM client_menus
```

889 rows. `MenuItem` gets `name` and `isActive`. Then one `RecipeVersion` with `versionNo: 1`, `srp` ← `default_retail`, `costAtPublish` ← `default_cost`, `publishedById` = the bootstrap admin's id, `note: "Migrated from legacy client_menus"`.

- [x] **Step 2: Create recipe lines**

```sql
SELECT JSON_OBJECT('menu_ingridient_id', menu_ingridient_id, 'menu_id', menu_id,
                   'bottle_id', bottle_id, 'bottle_size', bottle_size,
                   'bottle_uom', bottle_uom, 'serving', serving)
FROM client_menus_ingridients
```

1,808 rows. `servingQty` ← `serving`, `sortOrder` by `menu_ingridient_id` ascending. Resolve `locationItemId` from `(branch of the menu, bottle_id, size, uom)`.

An ingredient whose `LocationItem` does not exist at that location cannot be created — `report.skip("ingredient-not-in-location-catalog", …)` with the menu name and bottle id.

**Also report every ingredient whose variant is NOT `contentTracked` but whose `serving` is less than the variant `size`** — `report.flag()`, grouped by category. This is the evidence for the open question recorded in Task 5: an untracked ingredient consumes `serving × qty` rather than `(serving / size) × qty`, so if this list contains real pours (150 ml from a 750 ml wine) the `contentTracked` rule needs widening before any of this is applied. **Report the count prominently**: a recipe missing ingredients silently understates consumption in every Full Audit that includes it, which is exactly the class of error this system exists to catch.

- [x] **Step 3: Dry-run, read the skip list, apply**

```bash
npx tsx apps/server/scripts/import-legacy.ts --stage=menus
```

If more than a handful of ingredients are unresolvable, stop and report before applying — it means Task 6 dropped catalog rows it should not have.

- [x] **Step 4: Typecheck and checkpoint**

```bash
npm run typecheck -w @fnb/server
```

**Do not commit.**

---

## Task 8: Counts stage

The hardest stage. Legacy has no session concept; the grouping decision here determines every historical Full Audit anchor.

**Files:**
- Create: `apps/server/scripts/legacy/stages/counts.ts`

**Interfaces:**
- Consumes: `BRANCH_TO_LOCATION`, `LocationItem` map.
- Produces: `LegacyMap` under `"client_bottle_audits"` → `CountLine.id`, `"count_session"` → `CountSession.id` keyed `"<locationId>|<date>"`.

- [ ] **Step 1: Read the audits, grouped**

```sql
SELECT JSON_OBJECT('client_bottle_audit_id', client_bottle_audit_id,
                   'bottle_id', bottle_id, 'branch_id', branch_id,
                   'bottle_size', bottle_size, 'bottle_uom', bottle_uom,
                   'qty', qty, 'scale_weight', scale_weight,
                   'liquid_weight', liquid_weight, 'tare_weight', tare_weight,
                   'remaining_ml', remaining_ml, 'default_cost', default_cost,
                   'audit_type', audit_type, 'is_deleted', is_deleted,
                   'date_audit', DATE_FORMAT(date_audit, '%Y-%m-%d'))
FROM client_bottle_audits
ORDER BY branch_id, date_audit, client_bottle_audit_id
```

8,525 rows. `DATE_FORMAT` in SQL, not date formatting in JS — business dates are TEXT `YYYY-MM-DD` and must not pass through a `Date` object that could shift them by a timezone.

- [ ] **Step 2: Synthesise one COMMITTED session per (location, date)**

```ts
// Legacy has no session. Grouping by (location, countDate) is the only rule the
// data supports — and it FIXES BY CONSTRUCTION the double-anchor defect found
// on 2026-08-22, where buildFullAudit summed two same-date committed sessions
// and reported a 99-bottle shortage that never happened.
const key = `${locationId}|${row.date_audit}`;
```

Each session: `countDate` = the legacy date, `status: "COMMITTED"`, `committedAt` = midnight of that date, `committedById` / `createdById` = the bootstrap admin, `createdByName: "Legacy migration"`, `name: "Migrated legacy count"`.

- [ ] **Step 3: Map lines by audit type**

```ts
const isWeigh = Number(row.audit_type) === 2;
await tx.countLine.create({
  data: {
    countSessionId,
    locationItemId,
    countType: isWeigh ? "WEIGH" : "FULL",
    qtyFull: isWeigh ? 0 : Number(row.qty ?? 0),
    // OUNCES, deliberately NOT converted — unlike the catalog (Task 5).
    // A count line carries its own scale/tare/density snapshot, so it is
    // self-describing and internally consistent whatever scale it uses, and
    // weighing.ts is unit-agnostic: (s.k - t.k) x (d/k) = (s - t) x d.
    // seed.ts:1472-1484 does exactly this for the golden fixtures and says why.
    // Converting would add rounding drift to historical figures the client has
    // paper copies of, for no benefit.
    scaleWeight: isWeigh ? Number(row.scale_weight) : null,
    scaleUnit: isWeigh ? "oz" : null,
    tareWeight: isWeigh ? Number(row.tare_weight) : null,
    densityFactor: isWeigh ? (Number(row.liquid_weight) > 0 ? Number(row.liquid_weight) : null) : null,
    // Legacy already computed this. Carry it rather than recomputing: the
    // migrated record must reproduce what the legacy report showed, and
    // recomputing would silently "correct" historical figures the client
    // has paper copies of.
    remainingContent: isWeigh ? Number(row.remaining_ml ?? 0) : 0,
    unitCost: Number(row.default_cost ?? 0),   // snapshot FROM THE SOURCE ROW
    unitRetail: 0,
    status: Number(row.is_deleted) === 1 ? "VOID" : "ACTIVE",
    createdById: adminId,
    createdByName: "Legacy migration",
  },
});
```

**`unitCost` comes from the audit row, never from today's `LocationItem`.** Reading it from current pricing would restate three years of valuation at 2026 prices — a difference no error message reports and no user notices until a historical report disagrees with the paper copy.

`remaining_ml` is carried, not recomputed. Note in the report how many WEIGH lines have a `remaining_ml` that differs from `phpRound((scale − tare) × density)` by more than 1 — that count is a data-quality signal for Task 11, not something to fix here.

- [ ] **Step 4: Handle the one collision**

Branches 73 and 74 both counted on **2023-05-01**. Keep branch 73's session; for every branch-74 line on that date:

```ts
report.skip("mansion-merge-duplicate-count",
  `client_bottle_audit_id ${row.client_bottle_audit_id} (branch 74, 2023-05-01) — branch 73's session kept`);
```

Merging both into one session would sum two independent counts into a single anchor — precisely the defect this grouping exists to avoid.

- [ ] **Step 5: Dry-run and check the session shape**

```bash
npx tsx apps/server/scripts/import-legacy.ts --stage=counts
```

Expected: sessions ≈ the number of distinct (location, date) pairs; ~8,525 lines minus the 2023-05-01 branch-74 skips. Confirm **no location has two sessions on one date** — assert it in the stage and fail loudly if violated.

- [ ] **Step 6: Apply, then run a real Full Audit**

```bash
npx tsx apps/server/scripts/import-legacy.ts --stage=counts --confirm
```

In the app, open Reports → Full Audit for Xylo Bar between two consecutive migrated count dates. It must render with sensible beginning/ending inventory. Numbers are verified properly in Task 11; this is a smoke check that the anchors resolve at all.

- [ ] **Step 7: Typecheck, re-run golden fixtures, checkpoint**

```bash
npm run typecheck -w @fnb/server && npm run verify:seed -w @fnb/server
```

`verify:seed` builds a throwaway database and cannot be affected by imported data — if it fails here, something in the shared code path changed and must be investigated before continuing. **Do not commit.**

---

## Task 9: Transactions stage — sales, purchases, forfeits

**Files:**
- Create: `apps/server/scripts/legacy/stages/transactions.ts`

**Interfaces:**
- Consumes: `BRANCH_TO_LOCATION`, `LocationItem` map, `MenuItem` map (Task 7).
- Produces: `LegacyMap` under `"client_sales"`, `"purchases"`, `"purchase_items"`, `"client_forfeited_bottles"`.

- [ ] **Step 1: Sales — the three-way kind mapping**

```sql
SELECT JSON_OBJECT('client_sales_id', client_sales_id, 'branch_id', branch_id,
                   'bottle_id', bottle_id, 'menu_id', menu_id,
                   'bottle_size', bottle_size, 'bottle_uom', bottle_uom,
                   'price', price, 'discount', discount,
                   'total_quantity', total_quantity, 'item_type', item_type,
                   'sales_type', sales_type, 'non_ml', non_ml,
                   'is_deleted', is_deleted,
                   'real_date', DATE_FORMAT(real_date, '%Y-%m-%d'))
FROM client_sales
```

5,886 rows.

```ts
// architecture.md deviation #4: legacy encoded "production" as a 100% discount.
// A fragile magic value becomes a typed kind — consumption counted, revenue 0.
function kindFor(row: LegacySale): "SALE" | "NON_REVENUE" | "PRODUCTION" {
  if (Number(row.discount) === 100) return "PRODUCTION";
  return Number(row.sales_type) === 2 ? "NON_REVENUE" : "SALE";
}
```

`item_type` 1 → set `locationItemId`, 2 → set `menuItemId` **and** `recipeVersionId` (the v1 version created in Task 7). The two are XOR — never both.

`contentOverride` ← `non_ml`, and **only when `kind === "NON_REVENUE"`** — the schema restricts it to that kind, and the reconciliation excludes rows with `contentOverride > 0` from qty sums. Setting it on a SALE row would silently drop that sale from the variance calculation.

`unitPrice` ← `price` (source snapshot), `discountPct` ← `discount`, `qty` ← `total_quantity`, `saleDate` ← `real_date`, `source: "IMPORT"`, `status` ← `is_deleted === 1 ? "VOID" : "ACTIVE"`.

- [ ] **Step 2: Purchases**

44 headers, 1,115 lines. `Purchase.purchaseDate` ← the line's `real_date` (**not** `date_created` — legacy `date_created` is when the row was typed, `real_date` is the delivery). Status `COMMITTED`, `committedById` = admin. `PurchaseLine`: `qty`, `unitCost` ← `cost`, `lineTotal` = `phpRound(qty × unitCost)` — import `phpRound` from `@fnb/core`, do not use `Math.round` or `toFixed`.

If a purchase's lines carry differing `real_date` values, use the earliest and `report.flag()` the purchase id with the range.

- [ ] **Step 3: Forfeits**

1 row. `forfeitDate` ← `date_forfeited`, resolve `locationItemId`, carry `remaining_ml` as content.

- [ ] **Step 4: Dry-run, inspect the kind split, apply**

```bash
npx tsx apps/server/scripts/import-legacy.ts --stage=transactions
```

Report the SALE / NON_REVENUE / PRODUCTION split. A PRODUCTION count of zero means the `discount = 100` detection is wrong — investigate before applying, because those rows would otherwise import as full-revenue sales and inflate every variance.

- [ ] **Step 5: Typecheck and checkpoint**

```bash
npm run typecheck -w @fnb/server
```

**Do not commit.**

---

## Task 10: Trail stage

**Files:**
- Create: `apps/server/scripts/legacy/stages/trail.ts`

**Interfaces:**
- Consumes: `query`, `Report`.
- Produces: nothing later stages depend on. Run last.

- [ ] **Step 1: Import the legacy trail as unchained entries**

```sql
SELECT JSON_OBJECT('trail_id', trail_id, 'user_id', user_id, 'name', name,
                   'description', description,
                   'date', DATE_FORMAT(date, '%Y-%m-%dT%H:%i:%s'))
FROM trail ORDER BY trail_id
```

21,991 rows. Create `ActivityLog` rows with `ts` ← `date`, `action` ← `legacy.${name}`, `entity: "legacy"`, `summary` ← `description`, `userName` ← the migrated username, and **`seq`, `prevHash` and `hash` all left null**.

```ts
// ActivityLog is hash-chained. Legacy rows carry no hash, and fabricating one
// would assert an integrity guarantee that does not exist. The verifier already
// reports hashless entries as `unchained` rather than corrupt — that is exactly
// this case, and `npm run seal-history` is the mechanism built for it.
```

Do **not** invent an archive table. Reuse the mechanism that already exists.

- [ ] **Step 2: Batch the writes**

21,991 individual `create` calls inside one transaction will be slow and may hold the SQLite write lock long enough to matter. Use `createMany` in chunks of 500, still inside the stage's single `$transaction`.

- [ ] **Step 3: Dry-run, apply, then seal**

```bash
npx tsx apps/server/scripts/import-legacy.ts --stage=trail --confirm
```

```bash
npm run seal-history -w @fnb/server
```

Read the dry-run output, then:

```bash
npm run seal-history -w @fnb/server -- --confirm
```

State plainly in the checkpoint what sealing does and does not prove: it freezes the entries as they stand so they cannot later be edited undetected. It does **not** certify that the legacy history was authentic — which is why the seal records itself as `activity.sealHistory`.

- [ ] **Step 4: Verify the chain**

Run whatever chain verification `verify:security` performs over `ActivityLog` and confirm it reports the migrated entries as sealed, not corrupt:

```bash
npm run verify:security -w @fnb/server
```

- [ ] **Step 5: Typecheck and checkpoint**

```bash
npm run typecheck -w @fnb/server
```

**Do not commit.**

---

## Task 11: `verify:legacy` harness and documentation

**Files:**
- Create: `apps/server/prisma/verify-legacy.mjs`
- Modify: `apps/server/package.json` (add `verify:legacy`)
- Modify: `docs/build-log.md` (append the shipped entry)
- Modify: `docs/security-runbook.md` §0 (migration step in the go-live sequence)

**Interfaces:**
- Consumes: the migrated database. Standalone, like `verify-seed.mjs`.

- [ ] **Step 1: Build the harness on the existing pattern**

Read `apps/server/prisma/verify-seed.mjs` first and follow its structure — same argument handling, same assert/report style, same exit-code convention. Do not invent a second harness idiom.

For each migrated location with at least two committed count sessions, take consecutive pairs as periods, run the real `buildFullAudit` over each, and assert the report renders with resolvable anchors and no NaN in beginning, ending, usage, or variance.

- [ ] **Step 2: Add the two legacy XLSX fixture comparisons**

`docs/reference/Bar-Full-Detailed-Audit-January-25-to-31J-2025.xlsx` and `Bar-Inventory-Report-January-25-to-31LJ-2025.xlsx` are real legacy output. Read them with `exceljs` (already a dependency), extract per-item beginning/ending/usage/variance, and compare against the rebuild's figures for the same location and period.

**Report differences, do not assert equality blindly.** Two classes are legitimate and must be named in the output rather than hidden:

1. **Date semantics** — legacy used `BETWEEN begin AND end-1day` for purchases and sales but `BETWEEN begin AND end` for forfeits; the rebuild uses half-open `[begin, end)` uniformly (`architecture.md` §6).
2. **The 2023-05-01 Mansion anchor** — correctly different, per Task 8 Step 4.

Anything else is a migration bug. Print it as `MISMATCH` with item, period, expected and actual.

- [ ] **Step 3: Add the script**

```json
"verify:legacy": "node prisma/verify-legacy.mjs"
```

- [ ] **Step 4: Run the full verification suite**

```bash
npm run verify:seed -w @fnb/server && npm run verify:sync -w @fnb/server && npm run verify:security -w @fnb/server && npm run verify:legacy -w @fnb/server
```

```bash
npm run typecheck -w @fnb/server && npm run typecheck -w @fnb/web && npm run build
```

- [ ] **Step 5: Document what shipped**

Append to `docs/build-log.md`: the three commands, the `LegacyMap` table, the counts actually imported per model, every flag the import raised that still needs a human (subscription tiers, user roles), and the two legitimate deviation classes. Add the migration step to `docs/security-runbook.md` §0 between `db:bootstrap` and first login.

- [ ] **Step 6: Final checkpoint**

Report: every verification command and its result, the imported counts per model, the outstanding human-decision flags, and any `MISMATCH` lines with your assessment of each. **Do not commit** — hand the diff to the user.

---

## Post-implementation, before go-live

Not tasks — operator steps that belong to the client, recorded here so they are not forgotten:

1. An ADMIN sets the subscription tier for each of the three clients (flagged by Task 4).
2. An ADMIN enables each migrated user and assigns its real role (flagged by Task 4).
3. **Each venue performs a fresh physical count** in the new system. This is the opening balance — the migration deliberately does not provide one, because the most recent legacy count for five of six branches is from 2023. See spec §1.
4. `security-runbook.md` §1 pre-flight in full, including the backup and restore drill.
