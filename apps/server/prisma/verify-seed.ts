/**
 * Seed verification — run the seeder into a THROWAWAY database and assert two
 * things about the result:
 *
 *   1. The golden fixture is byte-identical (docs/golden-fixtures.md). This is
 *      the project's only verification anchor; a seeder that moves it is broken
 *      no matter how good its data looks.
 *   2. Every section and every report has data somewhere, so "fully loaded"
 *      is a measured claim rather than an impression.
 *
 * Usage:  npm run verify:seed -w @fnb/server
 *
 * Never touches data/fnb.db — it points FNB_DB_FILE at a temp file, which the
 * caller (verify-seed.mjs) creates and deletes.
 */
import { prisma } from "../src/db";
import { REPORT_TIER_PRESETS } from "@fnb/core";
import { buildFullAudit } from "../src/services/report-assembly";
import { nonMovingReport } from "../src/services/report-lists";

const GOLDEN = { begin: "2026-06-01", end: "2026-06-08", cost: -330.6857142857142, retail: -869.5714285714284 };

/**
 * A second anchor, added after a near-miss: seeding a void/correct pair dated
 * inside the 07-14 → 07-20 window shifted that period's variance by exactly the
 * corrected quantity while the June fixture sat there looking fine. One anchor
 * is not enough to catch a seed change that lands in a different period.
 */
const LATEST = { begin: "2026-07-14", end: "2026-07-20", cost: -537, retail: -1410 };

let failures = 0;
const ok = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
};

const main = async () => {
  const loc = await prisma.location.findFirst({
    where: { name: "Main Bar", client: { name: "Prime Hospitality Group" } },
  });
  if (!loc) {
    console.error("FAIL: Main Bar not seeded — the golden fixture has no anchor.");
    process.exit(1);
  }

  console.log("\nGolden fixture — Main Bar 2026-06-01 → 2026-06-08");
  const audit = await buildFullAudit(loc.id, GOLDEN.begin, GOLDEN.end);
  ok("variance at cost", audit.totals.varianceCost === GOLDEN.cost, `${audit.totals.varianceCost} (want ${GOLDEN.cost})`);
  ok("variance at retail", audit.totals.varianceRetail === GOLDEN.retail, `${audit.totals.varianceRetail} (want ${GOLDEN.retail})`);

  console.log("\nLatest closed period — Main Bar 2026-07-14 → 2026-07-20");
  const latest = await buildFullAudit(loc.id, LATEST.begin, LATEST.end);
  const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
  ok("variance at cost", near(latest.totals.varianceCost, LATEST.cost), `${latest.totals.varianceCost} (want ${LATEST.cost})`);
  ok("variance at retail", near(latest.totals.varianceRetail, LATEST.retail), `${latest.totals.varianceRetail} (want ${LATEST.retail})`);

  console.log("\nCoverage — every table that drives a screen or a report");
  const counts: Array<[string, Promise<number>]> = [
    ["users", prisma.user.count()],
    ["clients", prisma.client.count()],
    ["subscriptions", prisma.subscription.count()],
    // Report tier gating, Phase 6.2 — every seeded subscription must come out
    // with SubscriptionReport rows attached (seed.ts's upsertClientWithSubscription
    // now seeds them directly, mirroring the Phase 6.1 backfill script's shape).
    // A regression here means a fresh database would ship with every report
    // gated dark for every non-ADMIN role, same failure the Phase 6.1 backfill
    // exists to prevent for pre-existing databases.
    ["subscription reports (report tier gating)", prisma.subscriptionReport.count()],
    ["locations", prisma.location.count()],
    ["categories", prisma.category.count()],
    ["units", prisma.unit.count()],
    ["items", prisma.item.count()],
    ["item variants", prisma.itemVariant.count()],
    ["location items (catalog)", prisma.locationItem.count()],
    ["suppliers", prisma.supplier.count()],
    ["count sessions", prisma.countSession.count()],
    ["count lines", prisma.countLine.count()],
    ["purchases", prisma.purchase.count()],
    ["purchase lines", prisma.purchaseLine.count()],
    ["transfers", prisma.transfer.count()],
    ["transfer lines", prisma.transferLine.count()],
    ["transfer receipt lines", prisma.transferReceiptLine.count()],
    ["sale records", prisma.saleRecord.count()],
    ["menu items (recipes)", prisma.menuItem.count()],
    ["recipe versions", prisma.recipeVersion.count()],
    ["recipe lines", prisma.recipeLine.count()],
    ["import batches", prisma.importBatch.count()],
    ["import rows", prisma.importRow.count()],
    ["item aliases", prisma.itemAlias.count()],
    ["activity log", prisma.activityLog.count()],
    ["settings", prisma.setting.count()],
  ];
  for (const [label, p] of counts) {
    const n = await p;
    ok(label, n > 0, `${n} rows`);
  }

  console.log("\nCoverage — every subscription has SubscriptionReport rows (report tier gating, Phase 6)");
  // A blanket n > 0 above only proves SOME rows exist; a subscription with
  // zero rows would still pass that check as long as another one had rows.
  // This is the actual claim Phase 6 needs verified: no subscription — old,
  // new, or re-seeded — is left with an empty enabled-report set, since that
  // is exactly the state that gates every report dark for every non-ADMIN
  // role (canViewReportForSubscription, @fnb/core).
  const subsMissingReports = await prisma.subscription.count({ where: { reports: { none: {} } } });
  ok("no subscription has zero enabled reports", subsMissingReports === 0, `${subsMissingReports} subscription(s) with none`);

  // Spot-check the two tiers the demo data actually exercises (Prime = Full,
  // Casa Verde = Medium) against REPORT_TIER_PRESETS directly, so a preset
  // that drifts from what seed.ts actually wrote is caught here rather than
  // only surfacing later as a report that unexpectedly 404s for a demo user.
  const primeSub = await prisma.subscription.findFirst({
    where: { client: { name: "Prime Hospitality Group" } },
    include: { reports: true },
  });
  ok(
    "Prime (Full tier) has every report enabled",
    !!primeSub && primeSub.reports.length === REPORT_TIER_PRESETS.FULL.length,
    primeSub ? `${primeSub.reports.length} rows (want ${REPORT_TIER_PRESETS.FULL.length})` : "no subscription found",
  );
  const casaSub = await prisma.subscription.findFirst({
    where: { client: { name: "Casa Verde Restaurant" } },
    include: { reports: true },
  });
  ok(
    "Casa Verde (Medium tier) matches the Medium preset",
    !!casaSub && casaSub.reports.length === REPORT_TIER_PRESETS.MEDIUM.length,
    casaSub ? `${casaSub.reports.length} rows (want ${REPORT_TIER_PRESETS.MEDIUM.length})` : "no subscription found",
  );

  console.log("\nCoverage — report-specific shapes");
  const sales = await prisma.saleRecord.groupBy({ by: ["kind"], _count: true });
  const kinds = new Set(sales.map((s) => s.kind));
  for (const k of ["SALE", "NON_REVENUE", "PRODUCTION"]) ok(`sale kind ${k}`, kinds.has(k));
  ok(
    "discounted sales (Sales → Discounted view)",
    (await prisma.saleRecord.count({ where: { discountPct: { gt: 0 } } })) > 0,
  );
  ok("forfeited bottles", (await prisma.forfeit.count()) > 0);
  ok("asset register (assetCode set)", (await prisma.locationItem.count({ where: { assetCode: { not: null } } })) > 0);
  ok("par levels set (Par Level report)", (await prisma.locationItem.count({ where: { parLevel: { not: null } } })) > 0);
  ok("voided records (correction trail)", (await prisma.saleRecord.count({ where: { status: "VOID" } })) > 0);
  ok("open count session (dashboard next-action)", (await prisma.countSession.count({ where: { status: "OPEN" } })) > 0);
  ok("draft purchase (dashboard next-action)", (await prisma.purchase.count({ where: { status: "DRAFT" } })) > 0);
  ok(
    "import needing review (dashboard next-action)",
    (await prisma.importBatch.count({ where: { status: "NEEDS_REVIEW" } })) > 0,
  );

  console.log("\nCoverage — the Depot as a second BAR location");
  const depot = await prisma.location.findFirst({
    where: { name: "Depot", client: { name: "Prime Hospitality Group" } },
  });
  if (!depot) {
    ok("depot exists", false);
  } else {
    const some = async (n: Promise<number>) => (await n) > 0;
    ok("depot catalog", await some(prisma.locationItem.count({ where: { locationId: depot.id } })));
    ok(
      "depot par levels (Par Level report)",
      await some(prisma.locationItem.count({ where: { locationId: depot.id, parLevel: { not: null } } })),
    );
    ok("depot counts (its own audit periods)", await some(prisma.countSession.count({ where: { locationId: depot.id } })));
    ok("depot purchases", await some(prisma.purchase.count({ where: { locationId: depot.id } })));
    ok("depot transfers in", await some(prisma.transfer.count({ where: { toLocationId: depot.id } })));
    // Dead stock has to exist somewhere for Non-Moving to mean anything.
    const nonMoving = await nonMovingReport(depot.id);
    ok("depot non-moving rows (dead stock)", nonMoving.rows.length > 0, `${nonMoving.rows.length} rows`);
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
};

await main();
