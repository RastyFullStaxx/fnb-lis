import { chainTip, computeHash, GENESIS, verifyChain } from "../src/services/activity-chain";
import { prisma } from "../src/db";

/**
 * Seal the ActivityLog rows written before hash-chaining existed.
 *
 *   npm run seal-history -w @fnb/server -- --confirm
 *
 * ── READ THIS BEFORE RUNNING IT ──
 *
 * Sealing existing history does NOT prove that history is authentic. It cannot:
 * the rows are simply hashed as they stand right now. If something was already
 * altered before this runs, this bakes the altered version in and reports it as
 * a perfectly valid chain.
 *
 * What it DOES buy is that from this moment on, those rows can no longer be
 * edited or deleted without detection — the same protection new entries get.
 *
 * So the honest framing is "trusted-on-seal", and the value depends entirely on
 * running it while you still have reason to believe the history is good. On a
 * development database that is obviously fine. On a production database that has
 * been running unattended for a year, it is a weaker claim, and worth writing
 * down which it was — the run records itself in the trail.
 *
 * Ordering: by timestamp, then by id as a deterministic tie-break. Two rows
 * written in the same millisecond otherwise have no defined order, and a
 * verifier that walked them differently would report a false break.
 *
 * Idempotent: rows that already carry a `seq` are left alone, so re-running is
 * safe and a partial run can simply be repeated.
 */

const CONFIRMED = process.argv.includes("--confirm");

const main = async () => {
  const unchained = await prisma.activityLog.findMany({
    where: { seq: null },
    orderBy: [{ ts: "asc" }, { id: "asc" }],
  });

  if (unchained.length === 0) {
    console.log("Nothing to seal — every entry is already chained.");
    return;
  }

  const tip = await chainTip(prisma);
  console.log(`\n${unchained.length} unchained entr${unchained.length === 1 ? "y" : "ies"} found.`);
  console.log(`Oldest: ${unchained[0]!.ts.toISOString()}  (${unchained[0]!.action})`);
  console.log(`Newest: ${unchained[unchained.length - 1]!.ts.toISOString()}  (${unchained[unchained.length - 1]!.action})`);

  /**
   * The existing chain, if any, started at GENESIS. Sealing OLDER rows in front
   * of it would require rewriting every hash that already exists, so instead the
   * backfill is appended AFTER the current tip: the seal covers the old rows,
   * just not in their original chronological position within the chain.
   *
   * That is a deliberate trade. Rewriting a live chain to insert history in the
   * middle would mean recomputing hashes an operator may already have published
   * as an anchor — which is exactly the operation the chain exists to make
   * visible. Better to append and say so than to rewrite quietly.
   */
  if (tip.seq > 0) {
    console.log(`\nNOTE: ${tip.seq} entries are already chained. The sealed rows are appended`);
    console.log(`AFTER them, so chain order will not match chronological order for this batch.`);
  }

  if (!CONFIRMED) {
    console.log("\nThis is a dry run. Nothing was written.");
    console.log("Sealing does NOT prove these entries are authentic — it freezes them AS THEY ARE");
    console.log("so that future edits become detectable. Only run it while you still believe them.");
    console.log("\nRe-run with --confirm to seal.\n");
    return;
  }

  let seq = tip.seq;
  let prev = tip.hash;

  // One transaction: a half-sealed chain is worse than an unsealed one, because
  // the verifier would report a break at the point the run stopped.
  await prisma.$transaction(async (tx) => {
    for (const row of unchained) {
      seq += 1;
      const material = {
        seq,
        ts: row.ts,
        userId: row.userId,
        userName: row.userName,
        clientId: row.clientId,
        locationId: row.locationId,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        summary: row.summary,
        detailsJson: row.detailsJson,
      };
      const hash = computeHash(material, prev);
      await tx.activityLog.update({ where: { id: row.id }, data: { seq, prevHash: prev, hash } });
      prev = hash;
    }

    // The seal records itself, so nobody later has to wonder whether the old
    // rows were verified from birth or trusted at this moment.
    seq += 1;
    const marker = {
      seq,
      ts: new Date(),
      userId: null,
      userName: "(server console)",
      clientId: null,
      locationId: null,
      action: "activity.sealHistory",
      entity: "ActivityLog",
      entityId: null,
      summary: `Sealed ${unchained.length} pre-chain entries — trusted as-is at this point, not verified from origin`,
      detailsJson: JSON.stringify({
        sealed: unchained.length,
        from: unchained[0]!.ts.toISOString(),
        to: unchained[unchained.length - 1]!.ts.toISOString(),
        startedFromGenesis: tip.hash === GENESIS,
      }),
    };
    await tx.activityLog.create({
      data: { ...marker, prevHash: prev, hash: computeHash(marker, prev) },
    });
  });

  const verdict = await verifyChain();
  console.log(`\nSealed ${unchained.length} entries.`);
  console.log(`Chain verifies: ${verdict.ok}  (${verdict.checked} linked, ${verdict.unchained} unchained)`);
  if (verdict.ok) {
    console.log(`\nAnchor — publish this somewhere outside the database:`);
    console.log(`  seq ${verdict.tip!.seq}  ${verdict.tip!.hash}`);
  }
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
