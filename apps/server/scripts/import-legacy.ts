/**
 * Legacy data migration. DRY RUN BY DEFAULT — writing requires --confirm.
 *
 *   npx tsx apps/server/scripts/import-legacy.ts                  # dry run, all stages
 *   npx tsx apps/server/scripts/import-legacy.ts --stage=catalog  # dry run, one stage
 *   npx tsx apps/server/scripts/import-legacy.ts --confirm        # APPLY, all stages
 *
 * Through npm the flags need a `--` separator or npm eats them:
 *   npm run import:legacy -w @fnb/server -- --stage=reference
 *
 * FNB_ADMIN_USER must name an existing user (the one db:bootstrap created).
 *
 * BEFORE --confirm:  npm run backup -w @fnb/server
 * On a fresh production database the faster rollback is deleting the database
 * file and re-running `db:deploy` + `db:bootstrap`.
 *
 * Requires the legacy dump loaded into a scratch MariaDB database first — see
 * the header of scripts/legacy/source.ts.
 *
 * Design notes worth keeping:
 *
 *  - THE DRY RUN EXECUTES THE REAL WRITE PATH AND ROLLS IT BACK. A dry run that
 *    runs different code from the apply proves nothing about the apply: it
 *    cannot surface a unique-constraint violation, a missing foreign key, or a
 *    null in a required column. This one surfaces all three, then throws to
 *    discard the transaction.
 *
 *  - ONE ActivityLog ENTRY PER STAGE, inside the same transaction as that
 *    stage's writes. The ledger invariant is satisfied without 48,000 log rows.
 *
 *  - Stage order matters: each resolves ids the previous ones recorded.
 *
 *  - CONSEQUENCE, and it is not obvious: each stage commits in its OWN
 *    transaction, so a dry run ROLLS BACK before the next stage reads it. A
 *    full `--dry-run` across all stages therefore cannot validate anything past
 *    the first — later stages find nothing in LegacyMap and report everything
 *    as skipped. Work stage by stage instead:
 *
 *      --stage=reference            (read the report)
 *      --stage=reference --confirm
 *      --stage=tenancy              (read the report)
 *      --stage=tenancy --confirm
 *      ...
 *
 *    Stages that depend on a predecessor assert it and fail loudly rather than
 *    reporting a misleading pile of skips.
 */
import { prisma } from "../src/db";
import { Report } from "./legacy/report";
import { assertReachable } from "./legacy/source";
import type { Prisma } from "../src/generated/prisma/client";
import { referenceStage } from "./legacy/stages/reference";
import { tenancyStage } from "./legacy/stages/tenancy";
import { catalogStage } from "./legacy/stages/catalog";
import { pricingStage } from "./legacy/stages/pricing";
import { menusStage } from "./legacy/stages/menus";

export type Stage = {
  name: string;
  run: (tx: Prisma.TransactionClient, report: Report, adminId: string) => Promise<void>;
};

export const STAGE_ORDER = [
  "reference",
  "tenancy",
  "catalog",
  "pricing",
  "menus",
  "counts",
  "transactions",
  "trail",
] as const;

export type StageName = (typeof STAGE_ORDER)[number];

/** Populated as each stage lands. Keys must be members of STAGE_ORDER. */
const STAGES: Partial<Record<StageName, Stage>> = {
  reference: referenceStage,
  tenancy: tenancyStage,
  catalog: catalogStage,
  pricing: pricingStage,
  menus: menusStage,
};

class DryRunRollback extends Error {
  constructor() {
    super("dry run — rolling back");
  }
}

async function runStage(stage: Stage, adminId: string, confirm: boolean): Promise<void> {
  const report = new Report();
  try {
    await prisma.$transaction(
      async (tx) => {
        await stage.run(tx, report, adminId);
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
      // The trail stage writes 21,991 rows; Prisma's 5s default is nowhere near.
      { timeout: 15 * 60_000, maxWait: 60_000 },
    );
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  report.print(confirm ? "APPLIED" : "DRY RUN", stage.name);
}

async function main() {
  const argv = process.argv.slice(2);
  const confirm = argv.includes("--confirm");
  const only = argv.find((a) => a.startsWith("--stage="))?.split("=")[1];

  const selected: StageName[] = only ? [only as StageName] : [...STAGE_ORDER];
  for (const name of selected) {
    if (!(STAGE_ORDER as readonly string[]).includes(name)) {
      throw new Error(`Unknown stage "${name}". Known: ${STAGE_ORDER.join(", ")}`);
    }
  }

  assertReachable();

  const adminUser = process.env.FNB_ADMIN_USER;
  if (!adminUser) throw new Error("FNB_ADMIN_USER must name the bootstrap admin (see db:bootstrap).");
  const admin = await prisma.user.findUnique({ where: { username: adminUser }, select: { id: true } });
  if (!admin) throw new Error(`No user "${adminUser}". Run db:bootstrap first.`);

  if (!confirm) {
    console.log("DRY RUN — every stage runs for real inside a transaction, then rolls back.");
    console.log("Nothing is written. Pass --confirm to apply.\n");
  } else {
    console.log("APPLYING. Did you run `npm run backup -w @fnb/server` first?\n");
  }

  const pending: StageName[] = [];
  for (const name of selected) {
    const stage = STAGES[name];
    if (!stage) {
      pending.push(name);
      continue;
    }
    await runStage(stage, admin.id, confirm);
  }
  if (pending.length) {
    console.log(`Not yet implemented, skipped: ${pending.join(", ")}`);
  }
}

main()
  .catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : e}\n`);
    process.exitCode = 1;
  });
