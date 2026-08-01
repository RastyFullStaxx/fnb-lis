/**
 * A deterministic fingerprint of what this database says the numbers ARE.
 *
 *   FNB_DB_FILE=<path> npx tsx scripts/audit-digest.ts
 *
 * Prints one JSON object to stdout. Run it against a live database and against
 * a restored backup, compare the two, and you have proved something a file
 * copy cannot: not that the backup opens, but that it still produces the
 * reconciliation the client signed off on.
 *
 * That distinction is the whole reason this exists. `PRAGMA integrity_check`
 * answers "is this a valid SQLite file". It does not answer "is the Full Audit
 * for July still the same Full Audit", which is the only question this client
 * actually cares about.
 *
 * Reads only. Runs `buildFullAudit` — the real reconciliation path — rather
 * than re-deriving anything, so the digest cannot drift from the report.
 * Nothing here touches packages/core.
 */
import { createHash } from "node:crypto";
import { prisma } from "../src/db";
import { buildFullAudit, committedCountDates } from "../src/services/report-assembly";
import { isCostBasis, type CostBasis, type ReconReport } from "@fnb/core";

/**
 * Only the fields that ARE the answer, named against ReconRow/ReconTotals in
 * packages/core/src/reconciliation.ts. Deliberately not a hash of the whole
 * response: adding a display field to the report must not make every historic
 * digest incomparable, or the drill starts crying wolf and gets ignored.
 *
 * `digestedFields` is returned alongside so a mis-typed field name shows up as
 * a visible zero rather than as a hash of nulls that matches itself forever —
 * a check that always passes is worse than no check.
 */
function digestReport(report: ReconReport): { digest: string; fields: number } {
  const material = {
    totals: report.totals,
    rows: report.rows.map((row) => [
      row.locationItemId,
      row.beginFull,
      row.beginOpenEquiv,
      row.beginCost,
      row.purchased,
      row.forfeited,
      row.transferIn,
      row.transferOut,
      row.endFull,
      row.endOpenEquiv,
      row.endCost,
      row.usage,
      row.usageCost,
      row.soldDirect,
      row.soldPortion,
      row.revenue,
      row.nonRevenue,
      row.nonRevenueCost,
      row.production,
      row.variance,
      row.varianceCost,
      row.varianceRetail,
    ]),
  };
  const nonNull = material.rows.length === 0
    ? Object.values(material.totals).filter((v) => v !== null && v !== undefined).length
    : material.rows[0]!.filter((v) => v !== null && v !== undefined).length;
  return {
    digest: createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 16),
    fields: nonNull,
  };
}

const main = async () => {
  const locations = await prisma.location.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, clientId: true, client: { select: { costBasis: true } } },
    orderBy: { id: "asc" }, // stable across runs and across machines
  });

  const periods: Array<Record<string, unknown>> = [];
  for (const loc of locations) {
    const dates = await committedCountDates(loc.id);
    // The most recent auditable period: the last two committed counts. This is
    // the period a user would actually be looking at.
    if (dates.length < 2) {
      periods.push({ location: loc.id, name: loc.name, period: null, digest: null });
      continue;
    }
    const begin = dates[dates.length - 2]!;
    const end = dates[dates.length - 1]!;
    const basis: CostBasis = isCostBasis(loc.client.costBasis) ? loc.client.costBasis : "PRICE";
    const report = await buildFullAudit(loc.id, begin, end, undefined, null, basis);
    const { digest, fields } = digestReport(report);
    periods.push({
      location: loc.id,
      name: loc.name,
      period: `${begin}..${end}`,
      rows: report.rows.length,
      digestedFields: fields,
      digest,
    });
  }

  // Row counts across every table a restore must not silently drop. A digest
  // covers the reconciliation; these cover everything the reconciliation does
  // not read (users, devices, the audit trail itself).
  const counts = {
    users: await prisma.user.count(),
    clients: await prisma.client.count(),
    locations: await prisma.location.count(),
    locationItems: await prisma.locationItem.count(),
    countSessions: await prisma.countSession.count(),
    countLines: await prisma.countLine.count(),
    purchases: await prisma.purchase.count(),
    purchaseLines: await prisma.purchaseLine.count(),
    sales: await prisma.saleRecord.count(),
    forfeits: await prisma.forfeit.count(),
    transfers: await prisma.transfer.count(),
    transferLines: await prisma.transferLine.count(),
    menuItems: await prisma.menuItem.count(),
    activityLog: await prisma.activityLog.count(),
    devices: await prisma.device.count(),
  };

  process.stdout.write(JSON.stringify({ counts, periods }, null, 2));
  await prisma.$disconnect();
};

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
