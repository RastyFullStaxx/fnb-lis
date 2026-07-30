/** Headless first-run rehearsal: register → snapshot → apply. Not shipped. */
import Database from "better-sqlite3";
import { migrateLocal } from "./migrate";
import { OUTBOX_DDL } from "./sync/outbox";
import { applySnapshot } from "./sync/apply-snapshot";
import { fetchSnapshot, registerDevice } from "./provision";

const db = process.env.TEST_DB!;
migrateLocal(db, "../server/prisma/migrations");
const raw = new Database(db);
raw.exec(OUTBOX_DDL);

// Fixed fingerprint: a real machine keeps its own across relaunches, and
// re-registering on every run would burn a licence slot per attempt.
const reg = await registerDevice(
  {
    remoteUrl: process.env.TEST_URL!,
    username: process.env.TEST_USER!,
    password: process.env.TEST_PASS!,
    deviceName: "Provisioning rehearsal PC",
  },
  "rehearsal-fixed-fingerprint-0001",
);
console.log("registered device:", reg.result.deviceId, "| locations:", reg.result.locations.length);

const loc = reg.result.locations.find((l) => l.name === "Main Bar") ?? reg.result.locations[0]!;
const payload = await fetchSnapshot(reg.remoteUrl, reg.result.cookie, loc.id);
const applied = applySnapshot(raw, payload);
console.log("applied to mirror:", applied.total, "rows");
console.log(JSON.stringify(applied.tables));

/**
 * The check this whole exercise exists for (docs §7.5).
 *
 * The desktop computes reconciliation LOCALLY, from the same @fnb/core the
 * server uses. If the mirror and the server ever disagree on a number, the one
 * report the client trusts absolutely contradicts itself depending on which
 * screen they read it from. Reproducing the pinned anchors off the mirror is
 * the only thing that actually proves the copy is faithful.
 */
raw.close();
process.env.FNB_DB_FILE = db;
const { buildFullAudit } = await import("../../server/src/services/report-assembly");
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

let bad = 0;
for (const [begin, end, wantCost, wantRetail] of [
  ["2026-06-01", "2026-06-08", -330.6857142857142, -869.5714285714284],
  ["2026-07-14", "2026-07-20", -537, -1410],
] as const) {
  const a = await buildFullAudit(loc.id, begin, end);
  const okCost = near(a.totals.varianceCost, wantCost);
  const okRetail = near(a.totals.varianceRetail, wantRetail);
  if (!okCost || !okRetail) bad++;
  console.log(
    `${okCost && okRetail ? "  ok  " : " FAIL "} ${begin}→${end}  cost ${a.totals.varianceCost} (want ${wantCost})  retail ${a.totals.varianceRetail} (want ${wantRetail})`,
  );
}
console.log(bad === 0 ? "\nMIRROR MATCHES THE SERVER" : `\nMIRROR DIVERGES on ${bad} anchor(s)`);
process.exit(bad === 0 ? 0 : 1);
