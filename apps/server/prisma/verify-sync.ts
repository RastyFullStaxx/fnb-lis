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

  // The licence is one computer by default (proposal §18).
  const secondMachine = agent();
  const overCap = await secondMachine.call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username: "owner",
      password: PASSWORD,
      device: { fingerprint: "MACHINE-SECOND-02", name: "Second PC" },
    }),
  });
  ok("a second machine is refused by the licence cap", overCap.status === 403, `status ${overCap.status}`);

  // ── 4. Snapshot ──
  console.log("\nSnapshot — everything a mirror needs to reconcile offline");
  const snap = await desktop.call(`/api/locations/${loc.id}/sync/snapshot`);
  ok("snapshot is served", snap.status === 200, `status ${snap.status}`);
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
  const ack = await desktop.call(`/api/locations/${loc.id}/sync/ack`, { method: "POST" });
  ok("device can ack a completed push", ack.status === 200, `status ${ack.status}`);

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

  console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
};

await main();
