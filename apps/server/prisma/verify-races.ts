/**
 * Direct test of the TOCTOU guard, at the level the HTTP probes cannot reach.
 *
 * The route's outer `status !== "OPEN"` check catches the easy case, so an HTTP
 * race almost always ends there. What needs proving is the narrow window the
 * outer check cannot cover: the commit landing AFTER that check but BEFORE the
 * insert. This drives the two transactions directly so the interleaving is
 * chosen rather than hoped for.
 *
 * Run via `npm run verify:races -w @fnb/server`, which builds a throwaway
 * database first — same pattern as verify:seed / verify:sync / verify:security.
 * This is the one class of guarantee that cannot be checked by reading the code
 * or by a golden fixture: the guard is a self-write whose only visible purpose
 * is to take a lock, so it looks removable to anyone who has not seen it fail.
 */
import { prisma } from "../src/db";
import { holdParentOpen, transitionStatus } from "../src/lib/two-way";

const nid = () =>
  "c" + Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

const ok = (label: string, pass: boolean, detail = "") =>
  console.log(`  ${pass ? "ok  " : "FAIL"} ${label}${detail ? "  — " + detail : ""}`);

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => { if (!pass) failures++; ok(label, pass, detail); };

async function main() {
  const loc = await prisma.location.findFirstOrThrow({ where: { status: "ACTIVE" } });
  const li = await prisma.locationItem.findFirstOrThrow({ where: { locationId: loc.id, isActive: true } });
  const user = await prisma.user.findFirstOrThrow({ where: { username: "manager" } });
  const made: string[] = [];

  const mkSession = async (status: string) => {
    const id = nid();
    await prisma.countSession.create({
      data: {
        id, locationId: loc.id, countDate: "2026-08-04", status,
        createdById: user.id, createdByName: "probe",
        ...(status === "COMMITTED" ? { committedAt: new Date(), committedById: user.id } : {}),
      },
    });
    made.push(id);
    return id;
  };

  console.log("\n1. holdParentOpen — the guard itself");
  const openId = await mkSession("OPEN");
  let passed = true;
  try {
    await prisma.$transaction(async (tx) => {
      await holdParentOpen(
        () => tx.countSession.updateMany({ where: { id: openId, status: "OPEN" }, data: { status: "OPEN" } }),
        "count",
      );
    });
  } catch { passed = false; }
  check("passes while the session is OPEN", passed);

  const doneId = await mkSession("COMMITTED");
  let threw: unknown = null;
  try {
    await prisma.$transaction(async (tx) => {
      await holdParentOpen(
        () => tx.countSession.updateMany({ where: { id: doneId, status: "OPEN" }, data: { status: "OPEN" } }),
        "count",
      );
      await tx.countLine.create({
        data: { id: nid(), countSessionId: doneId, locationItemId: li.id, countType: "FULL", qtyFull: 1,
                unitCost: 0, unitRetail: 0, createdById: user.id, createdByName: "probe" },
      });
    });
  } catch (e) { threw = e; }
  const orphan = await prisma.countLine.count({ where: { countSessionId: doneId } });
  check("refuses once the session is COMMITTED", threw !== null, threw ? String((threw as Error).message).slice(0, 70) : "no throw");
  check("and the line was rolled back, not written", orphan === 0, `lines on committed session: ${orphan}`);

  console.log("\n2. The actual interleaving: commit fires while the insert holds the row");
  const raceId = await mkSession("OPEN");
  let commitLanded: number | null = null;
  const insertTx = prisma.$transaction(async (tx) => {
    await holdParentOpen(
      () => tx.countSession.updateMany({ where: { id: raceId, status: "OPEN" }, data: { status: "OPEN" } }),
      "count",
    );
    // The window the old code left open. The guard above already holds the
    // row's write lock, so the commit below cannot slip in here.
    await new Promise((r) => setTimeout(r, 400));
    await tx.countLine.create({
      data: { id: nid(), countSessionId: raceId, locationItemId: li.id, countType: "FULL", qtyFull: 7,
              unitCost: 0, unitRetail: 0, createdById: user.id, createdByName: "probe" },
    });
  });
  await new Promise((r) => setTimeout(r, 80)); // let the insert tx get inside its window
  const commitTx = prisma.$transaction(async (tx) => {
    await transitionStatus(
      () => tx.countSession.updateMany({ where: { id: raceId, status: "OPEN" },
              data: { status: "COMMITTED", committedAt: new Date(), committedById: user.id } }),
      "count", "committed",
    );
    commitLanded = Date.now();
  }).catch((e) => { commitLanded = -1; return e; });

  await Promise.allSettled([insertTx, commitTx]);
  const session = await prisma.countSession.findUniqueOrThrow({ where: { id: raceId } });
  const lines = await prisma.countLine.findMany({ where: { countSessionId: raceId } });
  const lineBeforeCommit = session.committedAt ? lines.every((l) => l.createdAt <= session.committedAt!) : true;
  check("the line survived (it started first)", lines.length === 1, `lines: ${lines.length}`);
  check("the commit was serialised behind it, not lost", session.status === "COMMITTED", `status: ${session.status}`);
  check("no line is newer than committedAt", lineBeforeCommit);

  console.log("\n3. Invariant, over sessions built through the route flow");
  // Scoped to this probe's own sessions on purpose.
  //
  // A global scan of this comparison is NOT a soundness check: the seeder
  // constructs fixtures directly, stamping `committedAt` on the session and
  // then inserting its lines milliseconds later, so seeded history trips it by
  // construction (480 of 486 hits on the dev database were sub-second gaps of
  // exactly that shape, plus 6 deliberately backdated sessions). `createdAt`
  // is wall-clock insertion time, not evidence of the route ordering, unless
  // the rows actually went through the route.
  const scoped = await prisma.countLine.findMany({
    where: { countSessionId: { in: made } },
    select: { createdAt: true, countSession: { select: { committedAt: true } } },
  });
  const violations = scoped.filter(
    (l) => l.countSession.committedAt !== null && l.createdAt > l.countSession.committedAt,
  ).length;
  check("no line newer than its session's committedAt", violations === 0, `checked ${scoped.length} line(s)`);

  // cleanup
  await prisma.countLine.deleteMany({ where: { countSessionId: { in: made } } });
  await prisma.countSession.deleteMany({ where: { id: { in: made } } });
  console.log(`\n${failures === 0 ? "PASS" : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
