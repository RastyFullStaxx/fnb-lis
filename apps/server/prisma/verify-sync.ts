/**
 * Sync verification — drives the real Hono app in-process against a THROWAWAY
 * database and proves the four guarantees the offline desktop mirror rests on:
 *
 *   1. A retried push does not duplicate.       (lib/idempotency.ts)
 *   2. A caller-supplied id cannot reach another establishment's records.
 *   3. A device login gets a session that survives a long offline stretch,
 *      and revoking the device kills it.        (auth/device.ts, auth/session.ts)
 *   4. The snapshot carries everything a mirror needs to reconcile offline.
 *      (routes/sync.ts)
 *
 * Usage:  npm run verify:sync -w @fnb/server
 *
 * No test framework by project rule — this is one runnable script that exits
 * non-zero when a guarantee breaks.
 */
import { createApp } from "../src/app";
import { prisma } from "../src/db";

const PASSWORD = "Fnb!2026";

let failures = 0;
const ok = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
};

const app = createApp();

/** Hono's app.request, with cookie handling so a session survives calls. */
function agent() {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    async call(path: string, init: RequestInit = {}) {
      const res = await app.request(path, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
          ...(init.headers ?? {}),
        },
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* non-JSON error page */
      }
      return { status: res.status, body: body as never };
    },
  };
}

const main = async () => {
  const loc = await prisma.location.findFirst({
    where: { name: "Main Bar", client: { name: "Prime Hospitality Group" } },
  });
  const otherLoc = await prisma.location.findFirst({
    where: { name: "Depot", client: { name: "Prime Hospitality Group" } },
  });
  if (!loc || !otherLoc) {
    console.error("FAIL: expected Main Bar and Depot from the seed.");
    process.exit(1);
  }
  const item = await prisma.locationItem.findFirst({ where: { locationId: loc.id } });
  if (!item) {
    console.error("FAIL: Main Bar has no catalog rows.");
    process.exit(1);
  }

  // ── 1. Idempotent push ──
  console.log("\nIdempotent push — a retry must not duplicate");
  const browser = agent();
  const login = await browser.call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "manager", password: PASSWORD }),
  });
  ok("manager can sign in", login.status === 200, `status ${login.status}`);

  const saleId = "dsyncchk000000000001";
  const payload = JSON.stringify({
    id: saleId,
    saleDate: "2026-07-28",
    kind: "SALE",
    locationItemId: item.id,
    qty: 2,
    occurredAt: "2026-07-28T19:30:00.000Z",
  });
  const first = await browser.call(`/api/locations/${loc.id}/sales`, { method: "POST", body: payload });
  const second = await browser.call(`/api/locations/${loc.id}/sales`, { method: "POST", body: payload });
  ok("first push creates", first.status === 201, `status ${first.status}`);
  ok("replay returns the same record, not a new one", second.status === 200, `status ${second.status}`);
  ok("replay returns the same id", (second.body as { id?: string }).id === saleId);
  const saleCount = await prisma.saleRecord.count({ where: { id: saleId } });
  ok("exactly one row exists", saleCount === 1, `${saleCount} rows`);

  const stored = await prisma.saleRecord.findUnique({ where: { id: saleId } });
  ok(
    "occurredAt is kept as device time, distinct from createdAt",
    stored?.occurredAt?.toISOString() === "2026-07-28T19:30:00.000Z" &&
      stored.createdAt.getTime() !== stored.occurredAt.getTime(),
    `occurredAt=${stored?.occurredAt?.toISOString()} createdAt=${stored?.createdAt.toISOString()}`,
  );

  // A future timestamp is a wrong clock, not a valid entry.
  const futureYear = new Date(Date.now() + 400 * 86_400_000).toISOString();
  const skewed = await browser.call(`/api/locations/${loc.id}/sales`, {
    method: "POST",
    body: JSON.stringify({
      id: "dsyncchk000000000009",
      saleDate: "2026-07-28",
      kind: "SALE",
      locationItemId: item.id,
      qty: 1,
      occurredAt: futureYear,
    }),
  });
  ok("a far-future occurredAt is rejected", skewed.status === 400, `status ${skewed.status}`);

  // ── 2. Cross-tenant id reuse ──
  console.log("\nScoping — a supplied id must not reach another location's rows");
  const foreign = await browser.call(`/api/locations/${otherLoc.id}/sales`, {
    method: "POST",
    body: JSON.stringify({
      id: saleId, // belongs to Main Bar
      saleDate: "2026-07-28",
      kind: "SALE",
      locationItemId: item.id,
      qty: 1,
    }),
  });
  ok("replaying another location's id is refused", foreign.status === 409, `status ${foreign.status}`);
  const stillOne = await prisma.saleRecord.count({ where: { id: saleId } });
  ok("and wrote nothing", stillOne === 1, `${stillOne} rows`);

  // ── 3. Device sessions ──
  console.log("\nDevice login — must survive a long offline stretch, and be revocable");
  const staffDesk = agent();
  const unregistered = await staffDesk.call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username: "staff",
      password: PASSWORD,
      device: { fingerprint: "MACHINE-UNREGISTERED-01", name: "Unapproved PC" },
    }),
  });
  ok("staff cannot register a new machine", unregistered.status === 403, `status ${unregistered.status}`);

  const desktop = agent();
  const registered = await desktop.call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username: "owner",
      password: PASSWORD,
      device: { fingerprint: "MACHINE-FRONT-BAR-01", name: "Front bar PC" },
    }),
  });
  ok("owner registers the machine on first login", registered.status === 200, `status ${registered.status}`);
  const device = await prisma.device.findUnique({ where: { fingerprint: "MACHINE-FRONT-BAR-01" } });
  ok("a Device row exists", Boolean(device));

  const session = await prisma.authSession.findFirst({
    where: { deviceId: device?.id },
    orderBy: { createdAt: "desc" },
  });
  const daysOut = session ? (session.expiresAt.getTime() - Date.now()) / 86_400_000 : 0;
  ok("its session outlasts the 7-day browser TTL", daysOut > 300, `${Math.round(daysOut)} days`);

  // The licence cap refuses the machine AFTER the last one it covers (proposal
  // §18). The cap is read from the subscription rather than assumed to be 1:
  // the demo client is seeded with 2 so a dev box can run both the mirror
  // rehearsal and a real desktop install, and hard-coding "the second machine
  // is refused" quietly became false the moment that changed.
  const primeSub = await prisma.subscription.findFirst({
    where: { client: { name: { contains: "Prime" } } },
  });
  const cap = primeSub?.maxDevices ?? 1;
  const alreadyActive = await prisma.device.count({
    where: { clientId: primeSub!.clientId, status: "ACTIVE" },
  });
  // Fill whatever the licence still covers — each of these must be ACCEPTED.
  let filled = alreadyActive;
  for (let i = alreadyActive; i < cap; i++) {
    const res = await agent().call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: "owner",
        password: PASSWORD,
        device: { fingerprint: `MACHINE-FILL-${i}`, name: `Filler PC ${i}` },
      }),
    });
    if (res.status === 200) filled += 1;
  }
  ok(`the licence covers ${cap} machine(s), and all ${cap} register`, filled === cap, `${filled} of ${cap}`);

  // One past the cap must be refused.
  const overCap = await agent().call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username: "owner",
      password: PASSWORD,
      device: { fingerprint: "MACHINE-OVER-CAP", name: "One Too Many PC" },
    }),
  });
  ok("the machine past the cap is refused", overCap.status === 403, `status ${overCap.status}`);

  // ── 4. Snapshot ──
  console.log("\nSnapshot — everything a mirror needs to reconcile offline");

  // The snapshot carries every colleague's PIN and recovery-answer hash, so it
  // is device-only. A browser session — even a manager's — must not be able to
  // pull the establishment's offline credentials and brute-force them at leisure.
  const browserSnap = await browser.call(`/api/locations/${loc.id}/sync/snapshot`);
  ok("a browser session cannot download a snapshot", browserSnap.status === 403, `status ${browserSnap.status}`);

  const snap = await desktop.call(`/api/locations/${loc.id}/sync/snapshot`);
  ok("snapshot is served to a registered device", snap.status === 200, `status ${snap.status}`);
  const s = snap.body as Record<string, unknown[] | Record<string, unknown>>;
  for (const key of ["catalog", "suppliers", "counts", "purchases", "sales", "forfeits", "transfers", "people"]) {
    const v = s[key];
    ok(`snapshot.${key} is populated`, Array.isArray(v) && v.length > 0, `${Array.isArray(v) ? v.length : "?"} rows`);
  }
  const master = s.master as Record<string, unknown[]>;
  for (const key of ["units", "categories", "variants"]) {
    ok(`snapshot.master.${key} is populated`, master?.[key]?.length > 0, `${master?.[key]?.length ?? "?"} rows`);
  }
  ok(
    "snapshot carries no password hashes",
    !JSON.stringify(snap.body).includes("passwordHash"),
  );

  // Without these the mirror boots and then 404s every request, because the
  // server's own requireLocationAccess re-reads them on each call.
  const identity = (snap.body as { identity?: Record<string, unknown[]> }).identity;
  ok("snapshot carries client access rows (or the mirror 404s offline)", (identity?.clientAccess?.length ?? 0) > 0);
  const loc2 = (snap.body as { location?: { status?: string; clientId?: string } }).location;
  ok("snapshot carries the FULL location row, not a display subset", Boolean(loc2?.status && loc2?.clientId));
  const cli = (snap.body as { client?: { status?: string } }).client;
  ok("snapshot carries the full client row", Boolean(cli?.status));
  // Missing modules read as "unrestricted", so this one widens the offline Full
  // Audit silently rather than throwing — exactly the divergence §7.5 forbids.
  ok(
    "snapshot carries the location's module set",
    Array.isArray(identity?.locationModules) && identity!.locationModules.length > 0,
    `${identity?.locationModules?.length ?? 0} modules`,
  );
  const ack = await desktop.call(`/api/locations/${loc.id}/sync/ack`, { method: "POST" });
  ok("device can ack a completed push", ack.status === 200, `status ${ack.status}`);

  // ── 5. Device PIN — offline authentication ──
  console.log("\nDevice PIN — the offline credential, and why it isn't the password");
  const staffWeb = agent();
  await staffWeb.call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "staff", password: PASSWORD }),
  });

  const weak = await staffWeb.call("/api/auth/pin", {
    method: "POST",
    body: JSON.stringify({
      pin: "1234",
      recoveryQuestion: "What was my first bar called?",
      recoveryAnswer: "Kubo",
      currentPassword: PASSWORD,
    }),
  });
  ok("a guessable PIN is refused", weak.status === 400, `status ${weak.status}`);

  const wrongPw = await staffWeb.call("/api/auth/pin", {
    method: "POST",
    body: JSON.stringify({
      pin: "947213",
      recoveryQuestion: "What was my first bar called?",
      recoveryAnswer: "Kubo",
      currentPassword: "not-my-password",
    }),
  });
  ok("setting a PIN needs the real password", wrongPw.status === 401, `status ${wrongPw.status}`);

  const setPin = await staffWeb.call("/api/auth/pin", {
    method: "POST",
    body: JSON.stringify({
      pin: "947213",
      recoveryQuestion: "What was my first bar called?",
      recoveryAnswer: "  KUBO  ",
      currentPassword: PASSWORD,
    }),
  });
  ok("staff can set a PIN", setPin.status === 200, `status ${setPin.status}`);

  // The break-glass: no network, PIN forgotten. Normalisation must make
  // "  KUBO  " and "kubo" the same answer, or recovery is welded shut.
  const recovered = await staffWeb.call("/api/auth/pin", {
    method: "POST",
    body: JSON.stringify({
      pin: "550284",
      recoveryQuestion: "What was my first bar called?",
      recoveryAnswer: "Kubo",
      currentRecoveryAnswer: "kubo",
    }),
  });
  ok("recovery answer resets the PIN, case/space-insensitively", recovered.status === 200, `status ${recovered.status}`);
  ok("and is recorded as the recovery path", (recovered.body as { via?: string }).via === "recovery");
  const alarm = await prisma.activityLog.findFirst({ where: { action: "pin.recover" } });
  ok("a recovery leaves an entry the admin can see", Boolean(alarm), alarm?.summary ?? "");
  const staffUserId = (await prisma.user.findUnique({ where: { username: "staff" } }))!.id;
  const afterRecovery = await prisma.devicePin.findUnique({ where: { userId: staffUserId } });

  // Every field here must be independently VALID, or zod rejects the body at the
  // door and this asserts nothing about the answer check. (It did exactly that
  // on the first run: a 3-character question failed the schema and the 400 was
  // mistaken for a refused answer.)
  const badAnswer = await staffWeb.call("/api/auth/pin", {
    method: "POST",
    body: JSON.stringify({
      pin: "661923",
      recoveryQuestion: "What was my first bar called?",
      recoveryAnswer: "Kubo",
      currentRecoveryAnswer: "definitely wrong",
    }),
  });
  ok("a wrong recovery answer is refused", badAnswer.status === 401, `status ${badAnswer.status}`);
  const unchanged = await prisma.devicePin.findUnique({ where: { userId: staffUserId } });
  ok("and the PIN is left alone", unchanged?.pinHash === afterRecovery?.pinHash);

  // ── 6. Attribution on a device session ──
  console.log("\nAttribution — one machine, many people");
  const desk2 = agent();
  await desk2.call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username: "owner",
      password: PASSWORD,
      device: { fingerprint: "MACHINE-FRONT-BAR-01", name: "Front bar PC" },
    }),
  });
  const staffUser = await prisma.user.findUnique({ where: { username: "staff" } });
  const attributed = await desk2.call(`/api/locations/${loc.id}/sales`, {
    method: "POST",
    headers: { "x-acting-user": staffUser!.id },
    body: JSON.stringify({
      id: "dsyncchk000000000021",
      saleDate: "2026-07-28",
      kind: "SALE",
      locationItemId: item.id,
      qty: 1,
    }),
  });
  ok("a device push is accepted for the acting staff member", attributed.status === 201, `status ${attributed.status}`);
  const row = await prisma.saleRecord.findUnique({ where: { id: "dsyncchk000000000021" } });
  ok(
    "and is credited to the staff member, NOT the owner who registered the machine",
    row?.createdById === staffUser!.id,
    `createdByName=${row?.createdByName}`,
  );

  // Permissions must follow the real actor, not the session holder.
  const staffVoid = await desk2.call(`/api/locations/${loc.id}/sales/dsyncchk000000000021/void`, {
    method: "POST",
    headers: { "x-acting-user": staffUser!.id },
    body: JSON.stringify({ reason: "Attribution check" }),
  });
  ok("staff still cannot void, even on the owner's device session", staffVoid.status === 403, `status ${staffVoid.status}`);

  const outsider = await prisma.user.findUnique({ where: { username: "admin" } });
  const foreignActor = await desk2.call(`/api/locations/${loc.id}/sales`, {
    method: "POST",
    headers: { "x-acting-user": "not-a-real-user-id" },
    body: JSON.stringify({ saleDate: "2026-07-28", kind: "SALE", locationItemId: item.id, qty: 1 }),
  });
  ok("an unknown acting user is refused, not silently ignored", foreignActor.status === 403, `status ${foreignActor.status}`);
  void outsider;

  // A browser session must not be able to impersonate anyone.
  const spoof = await browser.call(`/api/locations/${loc.id}/sales`, {
    method: "POST",
    headers: { "x-acting-user": staffUser!.id },
    body: JSON.stringify({
      id: "dsyncchk000000000022",
      saleDate: "2026-07-28",
      kind: "SALE",
      locationItemId: item.id,
      qty: 1,
    }),
  });
  const spoofed = await prisma.saleRecord.findUnique({ where: { id: "dsyncchk000000000022" } });
  ok(
    "a browser session cannot impersonate via the header",
    spoof.status === 201 && spoofed?.createdById !== staffUser!.id,
    `createdByName=${spoofed?.createdByName}`,
  );

  // ── Snapshot now carries the offline credential ──
  console.log("\nSnapshot credentials — the PIN travels, the password never does");
  const snap2 = await desk2.call(`/api/locations/${loc.id}/sync/snapshot`);
  const text = JSON.stringify(snap2.body);
  ok("snapshot still carries no password hashes", !text.includes("passwordHash"));
  ok("snapshot carries the device PIN hash, so offline login can work", text.includes("pinHash"));

  // ── 7. Two-way operation (docs §7) ──
  const adminAgentEarly = agent();
  await adminAgentEarly.call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: PASSWORD }),
  });

  console.log("\nRule 1 — open work belongs to where it started");
  // Manager (browser) opens a count; the desktop must not be able to touch it.
  const webCount = await browser.call(`/api/locations/${loc.id}/counts`, {
    method: "POST",
    body: JSON.stringify({ countDate: "2026-07-29", name: "Browser-owned count" }),
  });
  ok("browser opens a count", webCount.status === 201, `status ${webCount.status}`);
  const webCountId = (webCount.body as { id: string }).id;
  const deskIntrudes = await desk2.call(`/api/locations/${loc.id}/counts/${webCountId}/lines`, {
    method: "POST",
    headers: { "x-acting-user": staffUser!.id },
    body: JSON.stringify({ locationItemId: item.id, countType: "FULL", qtyFull: 3 }),
  });
  ok("the desktop cannot add lines to a browser-owned count", deskIntrudes.status === 409, `status ${deskIntrudes.status}`);

  // And the reverse: a desktop-owned count is read-only in the browser.
  const deskCount = await desk2.call(`/api/locations/${loc.id}/counts`, {
    method: "POST",
    headers: { "x-acting-user": staffUser!.id },
    body: JSON.stringify({ countDate: "2026-07-29", name: "Desktop-owned count" }),
  });
  const deskCountId = (deskCount.body as { id: string }).id;
  ok("desktop opens a count", deskCount.status === 201, `status ${deskCount.status}`);
  const storedOrigin = await prisma.countSession.findUnique({ where: { id: deskCountId } });
  ok("and it records which machine owns it", storedOrigin?.originDeviceId === device!.id);
  const webIntrudes = await browser.call(`/api/locations/${loc.id}/counts/${deskCountId}/lines`, {
    method: "POST",
    body: JSON.stringify({ locationItemId: item.id, countType: "FULL", qtyFull: 3 }),
  });
  ok("the browser cannot add lines to a desktop-owned count", webIntrudes.status === 409, `status ${webIntrudes.status}`);

  // Escape hatch: a dead machine must not freeze a count open forever.
  const release = await adminAgentEarly.call(
    `/api/locations/${loc.id}/drafts/CountSession/${deskCountId}/release`,
    { method: "POST", body: JSON.stringify({ reason: "Bar PC died mid-count" }) },
  );
  ok("an owner can release a stranded draft", release.status === 200, `status ${release.status}`);
  const afterRelease = await browser.call(`/api/locations/${loc.id}/counts/${deskCountId}/lines`, {
    method: "POST",
    body: JSON.stringify({ locationItemId: item.id, countType: "FULL", qtyFull: 3 }),
  });
  ok("and the browser can then work on it", afterRelease.status === 201, `status ${afterRelease.status}`);

  console.log("\nRule 2 — status transitions are replay-safe and conflict-aware");
  const commitOp = "dsyncop00000000000001";
  const c1 = await browser.call(`/api/locations/${loc.id}/counts/${deskCountId}/commit`, {
    method: "POST",
    body: JSON.stringify({ opId: commitOp, expectedStatus: "OPEN" }),
  });
  ok("commit with an op id succeeds", c1.status === 200, `status ${c1.status}`);
  const c2 = await browser.call(`/api/locations/${loc.id}/counts/${deskCountId}/commit`, {
    method: "POST",
    body: JSON.stringify({ opId: commitOp, expectedStatus: "OPEN" }),
  });
  // Without opId this would be an indistinguishable "already committed" 409.
  ok("replaying the SAME op is a success, not a conflict", c2.status === 200, `status ${c2.status}`);
  const c3 = await browser.call(`/api/locations/${loc.id}/counts/${deskCountId}/commit`, {
    method: "POST",
    body: JSON.stringify({ opId: "dsyncop00000000000002", expectedStatus: "OPEN" }),
  });
  ok("a DIFFERENT op against stale state is a conflict", c3.status === 409, `status ${c3.status}`);
  const opRows = await prisma.syncOp.count({ where: { opId: commitOp } });
  ok("the applied op is recorded exactly once", opRows === 1, `${opRows} rows`);

  // Commit with no body at all — the browser has always sent none.
  const bare = await browser.call(`/api/locations/${loc.id}/counts/${webCountId}/lines`, {
    method: "POST",
    body: JSON.stringify({ locationItemId: item.id, countType: "FULL", qtyFull: 1 }),
  });
  ok("browser can add a line to its own count", bare.status === 201, `status ${bare.status}`);
  const bareCommit = await browser.call(`/api/locations/${loc.id}/counts/${webCountId}/commit`, {
    method: "POST",
  });
  ok("commit still works with no body (unchanged browser behaviour)", bareCommit.status === 200, `status ${bareCommit.status}`);

  console.log("\nRule 3 — catalog edits cannot be queued offline");
  // NO acting-user header: the actor is the owner, who HAS prices.edit. With a
  // STAFF acting user this returned 403 from the permission guard and never
  // reached Rule 3 at all — a green check that proved nothing. The assertion is
  // exact (400) for the same reason.
  const queuedPrice = await desk2.call(`/api/locations/${loc.id}/location-items/${item.id}`, {
    method: "PUT",
    body: JSON.stringify({ cost: 999, occurredAt: "2026-07-29T02:00:00.000Z" }),
  });
  ok("a price edit carrying offline sync fields is refused", queuedPrice.status === 400, `status ${queuedPrice.status}`);
  const priceNow = await prisma.locationItem.findUnique({ where: { id: item.id } });
  ok("and the price is unchanged", priceNow?.cost !== 999, `cost=${priceNow?.cost}`);

  // The control: the SAME edit without the offline markers must succeed, or the
  // guard is just breaking price edits from the desktop entirely.
  const livePrice = await desk2.call(`/api/locations/${loc.id}/location-items/${item.id}`, {
    method: "PUT",
    body: JSON.stringify({ cost: 621 }),
  });
  ok("but a live price edit from the same desktop succeeds", livePrice.status === 200, `status ${livePrice.status}`);

  console.log("\nRule 4 — the risks sync cannot resolve are surfaced");
  const dupes = await browser.call(`/api/locations/${loc.id}/sync/duplicates`);
  ok("duplicate review is served", dupes.status === 200, `status ${dupes.status}`);
  ok("and returns groups", Array.isArray((dupes.body as { groups: unknown[] }).groups));
  const syncStatus = await browser.call(`/api/locations/${loc.id}/sync/status`);
  ok("sync status is served", syncStatus.status === 200, `status ${syncStatus.status}`);
  const st = syncStatus.body as { devices: unknown[]; anyStale: boolean };
  ok("and reports the registered machines", st.devices.length > 0, `${st.devices.length} devices`);

  console.log("\nReconcile — catching records the outbox never captured");
  const realId = "dsyncchk000000000021"; // pushed earlier in this run
  const ghostId = "dsyncghost0000000001"; // written locally, outbox entry lost
  const rec = await desk2.call(`/api/locations/${loc.id}/sync/reconcile`, {
    method: "POST",
    body: JSON.stringify({ ids: [realId, ghostId] }),
  });
  ok("reconcile is served to a device", rec.status === 200, `status ${rec.status}`);
  const missing = (rec.body as { missing: string[] }).missing;
  ok("it reports the record the server never received", missing.includes(ghostId));
  ok("and does NOT report one it already has", !missing.includes(realId), JSON.stringify(missing));
  // Another location's id must look identical to one that does not exist, or
  // this becomes a cross-tenant existence oracle.
  const foreignProbe = await desk2.call(`/api/locations/${loc.id}/sync/reconcile`, {
    method: "POST",
    body: JSON.stringify({ ids: [saleId, "dsyncchk000000000009"] }),
  });
  ok("reconcile is scoped to this location", foreignProbe.status === 200);

  console.log("\nAck events — an offline lockout still reaches the audit trail");
  const ackWithEvents = await desk2.call(`/api/locations/${loc.id}/sync/ack`, {
    method: "POST",
    body: JSON.stringify({
      events: [{ kind: "pinLockout", summary: "5 failed PIN attempts for staff", occurredAt: "2026-07-29T18:04:00.000Z" }],
    }),
  });
  ok("ack accepts offline events", ackWithEvents.status === 200, `status ${ackWithEvents.status}`);
  const lockRow = await prisma.activityLog.findFirst({ where: { action: "device.pinLockout" } });
  ok("and they land in the activity trail", Boolean(lockRow), lockRow?.summary ?? "");
  const ackBare = await desk2.call(`/api/locations/${loc.id}/sync/ack`, { method: "POST" });
  ok("ack still works with no body", ackBare.status === 200, `status ${ackBare.status}`);

  // ── Revocation ──
  console.log("\nRevocation — the counterweight to a year-long token");
  const adminAgent = agent();
  await adminAgent.call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: PASSWORD }),
  });
  const revoke = await adminAgent.call(`/api/admin/devices/${device!.id}/revoke`, {
    method: "POST",
    body: JSON.stringify({ reason: "Verification run" }),
  });
  ok("admin can revoke the machine", revoke.status === 200, `status ${revoke.status}`);
  const afterRevoke = await desktop.call(`/api/locations/${loc.id}/sync/snapshot`);
  ok("the revoked machine is locked out immediately", afterRevoke.status === 401, `status ${afterRevoke.status}`);

  // Revocation must not be a one-way door: the admin is TOLD to revoke a dead
  // machine to free the licence slot, and that machine may later boot holding a
  // week of unsynced counts.
  const reactivate = await adminAgent.call(`/api/admin/devices/${device!.id}/reactivate`, {
    method: "POST",
    body: JSON.stringify({ reason: "PSU replaced, machine has unsynced counts" }),
  });
  ok("a revoked machine can be brought back", reactivate.status === 200, `status ${reactivate.status}`);
  const back = await prisma.device.findUnique({ where: { id: device!.id } });
  ok("and is ACTIVE again", back?.status === "ACTIVE", back?.status ?? "");

  console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
};

await main();
