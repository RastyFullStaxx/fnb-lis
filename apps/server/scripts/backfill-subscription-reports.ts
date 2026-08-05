import { derivePackageType, REPORT_TIER_PRESETS, type PackageType } from "@fnb/core";
import { logActivity } from "../src/services/activity";
import { prisma } from "../src/db";

/**
 * One-time backfill: give every pre-existing Subscription its
 * SubscriptionReport rows (docs/2026-08-04-report-tier-gating-phases.md,
 * Phase 6.1).
 *
 *   npm run backfill:subscription-reports -w @fnb/server            (dry run)
 *   npm run backfill:subscription-reports -w @fnb/server -- --confirm
 *
 * ── WHY THIS EXISTS ──
 * Report tier gating (canViewReportForSubscription, @fnb/core) checks a
 * subscription's own SubscriptionReport rows, not its packageType label.
 * Phase 5.1 seeds those rows on subscription CREATION going forward, but
 * every Subscription that already existed before this feature shipped has
 * none. With zero enabled rows, canViewReportForSubscription() returns false
 * for every non-ADMIN role on every report — every report goes dark for
 * every existing client the moment Phase 3's server gate deploys. This
 * script is what stands between deploy and that outage.
 *
 * ── WHAT "BEFORE" LOOKED LIKE ──
 * Before this feature, visibility was role-gated only (canViewReport) — every
 * non-audit-viewer role could see every report, regardless of tier. So for
 * any existing client whose derived tier is NOT Full, applying that tier's
 * preset is a real access CHANGE, not a no-op restatement of the status quo.
 * That narrowing is the point of the feature, but per the plan doc it must
 * not be a surprise on deploy day — hence NARROWED below, reported loudly in
 * both dry-run and confirm mode rather than only decided by this script.
 *
 * ── IDEMPOTENT ──
 * A subscription that already has SubscriptionReport rows — whether from
 * Phase 5.1 firing on creation, or from an admin's own hand-edit via
 * PUT /clients/:id/subscription/reports — is left completely alone. This
 * script only ever fills a subscription that currently has ZERO report rows.
 * Re-running it is always safe and never overwrites a hand-edited set.
 *
 * ── DRY RUN BY DEFAULT ──
 * Without --confirm, this only reports what it would do. Nothing is written.
 * Same convention as seal-activity-history.ts's --confirm gate.
 */

const CONFIRMED = process.argv.includes("--confirm");

interface PlanRow {
  subscriptionId: string;
  clientId: string;
  clientName: string;
  packageType: PackageType;
  presetSlugs: readonly string[];
  /** true if the preset is a strict subset of "everything" — i.e. this
   * client is about to LOSE access to reports it could see under the old,
   * role-only gate (every non-Full tier). Flagged, not blocked — narrowing
   * to the checklist is the feature working as designed, but it must be a
   * known, reported change on deploy day, not a silent one. */
  narrows: boolean;
}

async function buildPlan(): Promise<PlanRow[]> {
  // Only subscriptions with zero report rows need anything — this is what
  // makes the whole script idempotent without a separate "already done" flag.
  const candidates = await prisma.subscription.findMany({
    where: { reports: { none: {} } },
    include: { client: { select: { id: true, name: true } } },
  });

  return candidates.map((sub) => {
    const packageType = derivePackageType(
      sub.billingCycle as "STANDALONE" | "MONTHLY",
      sub.maxEntities,
      sub.maxUsers,
    );
    const presetSlugs = REPORT_TIER_PRESETS[packageType];
    return {
      subscriptionId: sub.id,
      clientId: sub.clientId,
      clientName: sub.client.name,
      packageType,
      presetSlugs,
      // FULL gets every slug (REPORT_TIER_PRESETS.FULL = [...REPORT_SLUGS]),
      // so only a non-Full tier can possibly narrow relative to the old
      // "everyone sees everything" behavior.
      narrows: packageType !== "FULL",
    };
  });
}

async function main() {
  const plan = await buildPlan();

  if (plan.length === 0) {
    console.log("No subscriptions need backfilling — every existing Subscription already has SubscriptionReport rows.");
    return;
  }

  const narrowed = plan.filter((r) => r.narrows);

  console.log(`${plan.length} subscription(s) have zero SubscriptionReport rows and will be seeded:\n`);
  for (const row of plan) {
    const flag = row.narrows ? "  ⚠ NARROWS ACCESS (was: everything, will be: tier preset)" : "";
    console.log(`  ${row.clientName} — ${row.packageType} — ${row.presetSlugs.length} report(s)${flag}`);
  }

  if (narrowed.length > 0) {
    console.log(
      `\n${narrowed.length} of ${plan.length} client(s) above are on a non-Full tier. Before this feature shipped, ` +
        `every role-eligible user could see every report regardless of tier — so for these clients, applying the tier ` +
        `preset below REMOVES report access they currently have, not just adds rows. This is the feature working as ` +
        `designed (docs/2026-08-04-report-tier-gating-plan.md), but per Phase 6.3 it must be a reviewed decision before ` +
        `deploy, not a surprise on deploy day. Confirm each of these clients' current derived tier is actually correct ` +
        `for them before running with --confirm.`,
    );
  }

  if (!CONFIRMED) {
    console.log("\nDry run only — nothing written. Re-run with --confirm to apply.");
    return;
  }

  let seeded = 0;
  for (const row of plan) {
    await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction: if something else (Phase 5.1 firing
      // on a concurrent creation, or an admin's hand-edit) seeded this
      // subscription between buildPlan() and here, skip it rather than
      // stomping rows that now exist.
      const stillEmpty = (await tx.subscriptionReport.count({ where: { subscriptionId: row.subscriptionId } })) === 0;
      if (!stillEmpty) return;

      await tx.subscriptionReport.createMany({
        data: row.presetSlugs.map((reportSlug) => ({ subscriptionId: row.subscriptionId, reportSlug })),
      });

      await logActivity(
        {
          clientId: row.clientId,
          action: "subscription.reportsBackfill",
          entity: "Subscription",
          entityId: row.subscriptionId,
          summary: `Backfilled "${row.clientName}" enabled reports to the ${row.packageType} tier preset (${row.presetSlugs.length} report(s)) via one-time script`,
          details: { viaBackfillScript: true, packageType: row.packageType, reportSlugs: row.presetSlugs, narrowed: row.narrows },
        },
        tx,
      );

      seeded += 1;
    });
  }

  console.log(`\nSeeded ${seeded} of ${plan.length} subscription(s). Recorded in the activity trail as subscription.reportsBackfill.`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
