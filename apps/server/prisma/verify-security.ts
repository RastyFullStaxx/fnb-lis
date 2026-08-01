/**
 * Security verification — drives the real Hono app in-process against a
 * THROWAWAY database and proves the controls that protect the audit trail:
 *
 *   1. Response hardening headers are actually sent.       (middleware/security.ts)
 *   2. The session cookie is HttpOnly + SameSite, and Secure follows the
 *      TRANSPORT rather than an env var.                   (routes/auth.ts)
 *   3. Login does not leak which usernames exist — neither by message, status,
 *      nor response time.                                  (auth/password.ts)
 *   4. Failed sign-ins from one network hit a per-IP ceiling; successful ones
 *      never do.                                           (app.ts)
 *   5. Permission guards land on the routes they were written for, and not on
 *      their neighbours.                                   (routes/settings.ts)
 *   6. A password reset ends that account's live sessions. (routes/admin.ts)
 *   7. Tenant, role and device boundaries hold on the routes that carry
 *      credentials or another establishment's books.
 *   8. Forged proxy headers cannot write a false IP into the audit trail.
 *
 * Usage:  npm run verify:security -w @fnb/server
 *
 * No test framework by project rule — one runnable script that exits non-zero
 * when a guarantee breaks.
 */
import { createHmac, randomBytes } from "node:crypto";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { resetRateLimits } from "../src/middleware/security";
import { base32Decode } from "../src/auth/totp";

/**
 * The current TOTP code for a secret — computed HERE rather than imported, so
 * the harness is not grading the implementation against itself. Only the base32
 * decoding is shared; the HMAC, the dynamic truncation and the time step are
 * independent, which is where a TOTP bug would actually live.
 */
function totpNow(secretB32: string): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const mac = createHmac("sha1", base32Decode(secretB32)).update(buf).digest();
  const off = mac[mac.length - 1]! & 0x0f;
  const code =
    ((mac[off]! & 0x7f) << 24) | ((mac[off + 1]! & 0xff) << 16) | ((mac[off + 2]! & 0xff) << 8) | (mac[off + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

const PASSWORD = "Fnb!2026";

let failures = 0;
const ok = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
};

const app = createApp();

/** Hono's app.request, with cookie handling so a session survives calls. */
function agent(origin = "http://localhost") {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    setCookie(value: string) {
      cookie = value;
    },
    async call(path: string, init: RequestInit = {}) {
      const res = await app.request(`${origin}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          host: new URL(origin).host,
          ...(cookie ? { cookie } : {}),
          ...(init.headers ?? {}),
        },
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0]!;
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* non-JSON error page */
      }
      return { status: res.status, body: body as never, headers: res.headers, rawSetCookie: setCookie };
    },
  };
}

const login = async (a: ReturnType<typeof agent>, username: string) =>
  a.call("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password: PASSWORD }) });

/**
 * Clear the PER-ACCOUNT lockout (5 failures / 1 hour, routes/auth.ts).
 *
 * Checks that deliberately fail sign-ins leave the account locked, which is the
 * control working — but it then contaminates every later check that signs in as
 * the same person, turning one real failure into a cascade of misleading ones.
 * Reset explicitly between sections rather than hoping the usernames never
 * collide.
 */
const clearLockout = async (username: string) => {
  await prisma.user.updateMany({
    where: { username },
    data: { failedLoginCount: 0, failedLoginAt: null },
  });
};

const main = async () => {
  console.log("\n== 1. response hardening headers");
  {
    const res = await agent().call("/api/health");
    const csp = res.headers.get("content-security-policy") ?? "";
    ok("Content-Security-Policy is sent", csp.length > 0);
    ok("CSP restricts script-src to self", csp.includes("script-src 'self'"), csp.slice(0, 60));
    ok(
      "CSP has no 'unsafe-inline'/'unsafe-eval' in script-src",
      !/script-src[^;]*unsafe-(inline|eval)/.test(csp),
    );
    ok("CSP forbids framing", csp.includes("frame-ancestors 'none'"));
    ok("X-Frame-Options: DENY", res.headers.get("x-frame-options") === "DENY");
    ok("X-Content-Type-Options: nosniff", res.headers.get("x-content-type-options") === "nosniff");
    ok("Referrer-Policy is set", (res.headers.get("referrer-policy") ?? "").length > 0);
    // HSTS over plaintext would pin the operator's browser to https://localhost
    // and lock them out of the desktop server.
    ok("no HSTS on a plaintext request", res.headers.get("strict-transport-security") === null);
  }

  console.log("\n== 2. session cookie flags follow the transport");
  {
    resetRateLimits();
    const http = agent("http://localhost");
    const res = await login(http, "admin");
    const raw = res.rawSetCookie ?? "";
    ok("login succeeds", res.status === 200, `status ${res.status}`);
    ok("cookie is HttpOnly", /HttpOnly/i.test(raw));
    ok("cookie is SameSite=Lax", /SameSite=Lax/i.test(raw));
    ok("cookie is NOT Secure over http (desktop would break)", !/;\s*Secure/i.test(raw));

    const https = agent("https://books.example.com");
    const secureRes = await login(https, "admin");
    ok("cookie IS Secure over https", /;\s*Secure/i.test(secureRes.rawSetCookie ?? ""), secureRes.rawSetCookie ?? "");
  }

  console.log("\n== 3. login does not enumerate usernames");
  {
    resetRateLimits();
    const a = agent();
    const missing = await a.call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "no-such-person", password: PASSWORD }),
    });
    const wrongPw = await a.call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "manager", password: "definitely-wrong-1" }),
    });
    ok("same status for unknown user and wrong password", missing.status === wrongPw.status, `${missing.status} vs ${wrongPw.status}`);
    ok(
      "same message for unknown user and wrong password",
      (missing.body as { error: string }).error === (wrongPw.body as { error: string }).error,
    );

    // Timing. The unknown-user branch must still pay for a scrypt derivation,
    // or the response time answers the question the message refuses to.
    const time = async (username: string) => {
      const started = process.hrtime.bigint();
      await agent().call("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password: "definitely-wrong-1" }),
      });
      return Number(process.hrtime.bigint() - started) / 1e6;
    };
    // Legacy hashes are upgraded on successful sign-in (needsRehash). Sign in
    // once first so the timing comparison below measures the CONVERGED state —
    // an account still holding a weaker hash verifies faster than the
    // burnPasswordTime branch, which is the oracle inverted rather than closed.
    resetRateLimits();
    await clearLockout("manager");
    await login(agent(), "manager");
    const upgraded = await prisma.user.findUnique({ where: { username: "manager" } });
    ok(
      "a legacy password hash is upgraded on sign-in",
      (upgraded?.passwordHash ?? "").startsWith("scrypt:32768:"),
      (upgraded?.passwordHash ?? "").split(":").slice(0, 4).join(":"),
    );

    const samples = 5;
    let missMs = 0;
    let hitMs = 0;
    for (let i = 0; i < samples; i++) {
      resetRateLimits();
      missMs += await time("no-such-person");
      resetRateLimits();
      hitMs += await time("manager");
    }
    missMs /= samples;
    hitMs /= samples;
    /**
     * A bound, not a claim of zero.
     *
     * The KDF cost is now equal on both paths (burnPasswordTime runs the same
     * N as a real verify, and legacy hashes upgrade on sign-in). What remains is
     * that a REAL account has a failed-login counter to increment and a missing
     * one does not — roughly 50 ms of database write that no amount of
     * restructuring removes without either weakening the lockout or giving an
     * unauthenticated caller a way to make the server do pointless writes.
     *
     * That residual is bounded to a handful of samples by the per-IP limiter
     * (10 failures / 15 min), which is what makes it impractical rather than
     * merely small. This assertion exists to catch a REGRESSION — the original
     * bug was 5 ms vs 100 ms, a 20× signal — not to assert perfect symmetry.
     */
    const ratio = hitMs / Math.max(missMs, 0.001);
    ok(
      "no order-of-magnitude timing signal between unknown user and wrong password",
      ratio < 2.5 && ratio > 0.4,
      `miss ${missMs.toFixed(1)}ms vs hit ${hitMs.toFixed(1)}ms (ratio ${ratio.toFixed(2)})`,
    );
  }

  console.log("\n== 4. per-IP login limiter");
  {
    resetRateLimits();
    const a = agent();
    let sawLimit = false;
    let attempts = 0;
    for (let i = 0; i < 40 && !sawLimit; i++) {
      attempts++;
      const res = await a.call("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: `victim${i}`, password: "guess" }),
      });
      if (res.status === 429) sawLimit = true;
    }
    ok("repeated failed sign-ins are eventually refused", sawLimit, `after ${attempts} attempts`);

    // Credential stuffing sprays DIFFERENT usernames, so the per-account
    // lockout never fires — this ceiling is the control that does.
    ok("the limiter is per-IP, not per-account", sawLimit && attempts <= 40);

    resetRateLimits();
    await clearLockout("owner");
    const good = agent();
    let allOk = true;
    let firstBad = 0;
    for (let i = 0; i < 15; i++) {
      const res = await login(good, "owner");
      if (res.status !== 200) {
        allOk = false;
        firstBad = firstBad || res.status;
      }
    }
    ok(
      "successful sign-ins never trip the limiter (shift change at one NAT)",
      allOk,
      allOk ? "" : `got ${firstBad}`,
    );
  }

  console.log("\n== 5. permission guards land on the right routes");
  {
    resetRateLimits();
    const staff = agent();
    await login(staff, "staff");

    // The regression this harness exists to pin: settingsRoutes' master.write
    // guard used to leak onto preferencesRoutes, which mounts on the same
    // /api/settings prefix.
    const prefs = await staff.call("/api/settings/preferences");
    ok("STAFF can read their own preferences", prefs.status === 200, `status ${prefs.status}`);

    const putPrefs = await staff.call("/api/settings/preferences", {
      method: "PUT",
      body: JSON.stringify({ fontSize: "large", unitSystem: "metric", preferredVolumeUnit: "ml", preferredMassUnit: "g" }),
    });
    ok("STAFF can save their own preferences", putPrefs.status === 200, `status ${putPrefs.status}`);

    const client = await prisma.client.findFirst({ where: { status: "ACTIVE" } });
    const acct = agent();
    await login(acct, "accountant");
    const basis = await acct.call(`/api/settings/cost-basis?clientId=${client!.id}`);
    ok("ACCOUNTANT can READ the cost basis (valuation labels depend on it)", basis.status === 200, `status ${basis.status}`);

    const writeBasis = await acct.call(`/api/settings/cost-basis?clientId=${client!.id}`, {
      method: "PUT",
      body: JSON.stringify({ costBasis: "LAST_COST" }),
    });
    ok("ACCOUNTANT still cannot WRITE the cost basis", writeBasis.status === 403, `status ${writeBasis.status}`);

    const staffCompany = await staff.call(`/api/settings/company?clientId=${client!.id}`);
    ok("STAFF still cannot read company settings", staffCompany.status === 403, `status ${staffCompany.status}`);
  }

  console.log("\n== 6. password reset ends live sessions");
  {
    resetRateLimits();
    const victim = agent();
    await login(victim, "staff");
    const before = await victim.call("/api/auth/me");
    ok("session works before the reset", before.status === 200, `status ${before.status}`);

    const staffUser = await prisma.user.findUnique({ where: { username: "staff" } });
    const admin = agent();
    await login(admin, "admin");
    const reset = await admin.call(`/api/admin/users/${staffUser!.id}`, {
      method: "PUT",
      body: JSON.stringify({ password: "Rotated!2026x" }),
    });
    ok("admin can reset the password", reset.status === 200, `status ${reset.status}`);

    const after = await victim.call("/api/auth/me");
    ok("the old session is dead after the reset", after.status === 401, `status ${after.status}`);

    const logged = await prisma.activityLog.findFirst({
      where: { entity: "User", entityId: staffUser!.id, action: "user.update" },
      orderBy: { ts: "desc" },
    });
    ok("the eviction is in the audit trail", (logged?.summary ?? "").includes("session"), logged?.summary ?? "(none)");

    // Put it back so later checks can still sign in as staff.
    await admin.call(`/api/admin/users/${staffUser!.id}`, {
      method: "PUT",
      body: JSON.stringify({ password: PASSWORD }),
    });
  }

  console.log("\n== 7. tenant / role / device boundaries");
  {
    resetRateLimits();
    const location = await prisma.location.findFirst({ where: { status: "ACTIVE" } });

    const anon = agent();
    const noAuth = await anon.call(`/api/locations/${location!.id}/reports/count-dates`);
    ok("unauthenticated report read is refused", noAuth.status === 401, `status ${noAuth.status}`);

    const anonAdmin = agent();
    const noAuthAdmin = await anonAdmin.call("/api/admin/clients");
    ok("unauthenticated admin read is refused", noAuthAdmin.status === 401, `status ${noAuthAdmin.status}`);

    // The snapshot carries every colleague's device-PIN and recovery-answer
    // hash. A browser session must never be able to pull it.
    const staff = agent();
    await login(staff, "staff");
    const snap = await staff.call(`/api/locations/${location!.id}/sync/snapshot`);
    ok("a browser session cannot pull the credential snapshot", snap.status === 403, `status ${snap.status}`);

    const owner = agent();
    await login(owner, "owner");
    const ownerSnap = await owner.call(`/api/locations/${location!.id}/sync/snapshot`);
    ok("not even an OWNER browser session can pull it", ownerSnap.status === 403, `status ${ownerSnap.status}`);

    // An OWNER must not be able to mint an ADMIN or reach another tenant.
    const escalate = await owner.call("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: "escalated.admin",
        password: "Whatever!2026",
        firstName: "E",
        lastName: "E",
        role: "ADMIN",
        clientIds: [],
      }),
    });
    ok("an OWNER cannot create an ADMIN", escalate.status === 403, `status ${escalate.status}`);

    const clients = await owner.call("/api/admin/clients");
    ok("an OWNER cannot list every establishment", clients.status === 403, `status ${clients.status}`);

    // Audit viewers are narrowed to the reconciliation set.
    const viewer = agent();
    await login(viewer, "readonly");
    const sales = await viewer.call(`/api/locations/${location!.id}/reports/sales?from=2026-01-01&to=2026-12-31`);
    ok("an AUDIT_VIEWER cannot open the sales report", sales.status === 404, `status ${sales.status}`);
    const audit = await viewer.call("/api/auth/me");
    ok("an AUDIT_VIEWER can still sign in", audit.status === 200, `status ${audit.status}`);
  }

  console.log("\n== 8. CSRF origin check + request size");
  {
    resetRateLimits();
    const a = agent("http://localhost");
    await login(a, "manager");
    const crossOrigin = await a.call("/api/settings/preferences", {
      method: "PUT",
      headers: { origin: "https://evil.example.com" },
      body: JSON.stringify({ fontSize: "large", unitSystem: "metric", preferredVolumeUnit: "ml", preferredMassUnit: "g" }),
    });
    ok("cross-origin mutation is rejected", crossOrigin.status === 403, `status ${crossOrigin.status}`);

    const huge = await a.call("/api/settings/preferences", {
      method: "PUT",
      body: JSON.stringify({ fontSize: "large", pad: "x".repeat(2 * 1024 * 1024) }),
    });
    ok("an oversized JSON body is refused", huge.status === 413, `status ${huge.status}`);
  }

  console.log("\n== 9. forged proxy headers cannot poison the audit trail");
  {
    resetRateLimits();
    await clearLockout("accountant");
    const a = agent();
    const res = await a.call("/api/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ username: "accountant", password: PASSWORD }),
    });
    ok("the spoofed-header login succeeded (so a log row exists to inspect)", res.status === 200, `status ${res.status}`);
    const accountant = await prisma.user.findUnique({ where: { username: "accountant" } });
    const entry = await prisma.activityLog.findFirst({
      where: { entity: "User", entityId: accountant!.id, action: "auth.login" },
      orderBy: { ts: "desc" },
    });
    const details = entry?.detailsJson ? (JSON.parse(entry.detailsJson) as { ip?: string }) : {};
    ok(
      "a spoofed X-Forwarded-For is NOT recorded as the login IP",
      Boolean(entry) && details.ip !== "203.0.113.9",
      `recorded "${details.ip}"`,
    );
  }

  console.log("\n== 10. two-factor authentication (ADMIN + OWNER)");
  {
    // MFA is off for every check above because FNB_MFA_KEY is unset — that IS
    // the feature switch (auth/totp.ts). Turn it on only here, so the rest of
    // the harness proves the ordinary paths are unaffected by its absence.
    process.env.FNB_MFA_KEY = randomBytes(32).toString("base64");
    resetRateLimits();
    await clearLockout("admin");
    await clearLockout("owner");
    await clearLockout("staff");

    const location = await prisma.location.findFirst({ where: { status: "ACTIVE" } });

    // ── The gate, before anyone has enrolled ──
    const admin = agent();
    const adminLogin = await login(admin, "admin");
    ok("an unenrolled ADMIN can still SIGN IN (never lock out the last admin)", adminLogin.status === 200, `status ${adminLogin.status}`);
    ok(
      "and /me says setup is outstanding",
      (adminLogin.body as { mfaSetupRequired?: boolean }).mfaSetupRequired === true,
    );

    const blocked = await admin.call(`/api/locations/${location!.id}/reports/count-dates`);
    ok("but the rest of the app is refused", blocked.status === 403, `status ${blocked.status}`);
    ok(
      "with a code the client can route on",
      (blocked.body as { code?: string }).code === "MFA_SETUP_REQUIRED",
      String((blocked.body as { code?: string }).code),
    );
    const adminBlocked = await admin.call("/api/admin/clients");
    ok("admin routes are refused too", adminBlocked.status === 403, `status ${adminBlocked.status}`);

    /**
     * The gate must NOT reach non-API paths. In production this same app also
     * serves the built SPA (index.ts), and a pathless guard refused GET
     * /account/security — the very page the gate redirects people to. They got
     * raw 403 JSON instead of the enrolment screen, which is as locked out as
     * having no screen at all. Caught in a browser, pinned here.
     */
    /**
     * Per-user DISPLAY preferences stay reachable. PreferencesProvider fetches
     * them globally, including on the enrolment screen itself, and they carry
     * no security value (font size, unit system). Blocking them rendered the
     * enrolment page at the wrong font size for a user who chose "large" for
     * poor eyesight — and made the client's 403 handler, rather than the login
     * redirect, the thing driving them there, which showed up as a dashboard
     * flash and a full page reload mid-sign-in.
     */
    const prefsWhileGated = await admin.call("/api/settings/preferences");
    ok("display preferences stay reachable while un-enrolled", prefsWhileGated.status === 200, `status ${prefsWhileGated.status}`);
    const companyWhileGated = await admin.call(`/api/settings/company?clientId=${location!.clientId}`);
    ok("but the rest of /api/settings is still gated", companyWhileGated.status === 403, `status ${companyWhileGated.status}`);

    const spaRoute = await admin.call("/account/security");
    ok(
      "the gate does not block the SPA route it sends people to",
      !(spaRoute.status === 403 && (spaRoute.body as { code?: string })?.code === "MFA_SETUP_REQUIRED"),
      `status ${spaRoute.status}`,
    );

    const owner = agent();
    await login(owner, "owner");
    const ownerBlocked = await owner.call("/api/admin/users");
    ok("an unenrolled OWNER is refused the same way", ownerBlocked.status === 403, `status ${ownerBlocked.status}`);

    // STAFF is deliberately NOT in MFA_REQUIRED_ROLES.
    const staff = agent();
    await login(staff, "staff");
    const staffOk = await staff.call("/api/settings/preferences");
    ok("STAFF is not required to enrol and works normally", staffOk.status === 200, `status ${staffOk.status}`);

    // ── Enrolment ──
    const wrongPw = await admin.call("/api/auth/mfa/enroll", {
      method: "POST",
      body: JSON.stringify({ currentPassword: "not-my-password" }),
    });
    ok("enrolment refuses a wrong password", wrongPw.status === 401, `status ${wrongPw.status}`);
    await clearLockout("admin");

    const enrolled = await admin.call("/api/auth/mfa/enroll", {
      method: "POST",
      body: JSON.stringify({ currentPassword: PASSWORD }),
    });
    ok("enrolment starts with the right password", enrolled.status === 200, `status ${enrolled.status}`);
    const secret = (enrolled.body as { secret: string }).secret;
    ok("a base32 secret is issued", /^[A-Z2-7]{32}$/.test(secret ?? ""), secret);

    // Still blocked: an unconfirmed enrolment must not count as enrolled, or a
    // mis-scan would leave someone with a factor they cannot produce.
    const midEnrol = await admin.call("/api/admin/clients");
    ok("an UNCONFIRMED enrolment does not lift the gate", midEnrol.status === 403, `status ${midEnrol.status}`);

    const badConfirm = await admin.call("/api/auth/mfa/confirm", {
      method: "POST",
      body: JSON.stringify({ code: "000000" }),
    });
    ok("confirm refuses a wrong code", badConfirm.status === 401, `status ${badConfirm.status}`);

    const confirmed = await admin.call("/api/auth/mfa/confirm", {
      method: "POST",
      body: JSON.stringify({ code: totpNow(secret) }),
    });
    ok("confirm accepts a real code", confirmed.status === 200, `status ${confirmed.status}`);
    const backupCodes = (confirmed.body as { backupCodes: string[] }).backupCodes ?? [];
    ok("ten recovery codes are issued once", backupCodes.length === 10, `${backupCodes.length} codes`);

    const unblocked = await admin.call("/api/admin/clients");
    ok("the gate lifts once enrolled", unblocked.status === 200, `status ${unblocked.status}`);

    // ── The two-step login ──
    resetRateLimits();
    const fresh = agent();
    const step1 = await fresh.call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: PASSWORD }),
    });
    ok("password alone returns a challenge, not a session", (step1.body as { mfaRequired?: boolean }).mfaRequired === true);
    ok("and sets NO session cookie", !/fnb_session=[^;]+/.test(step1.rawSetCookie ?? ""), step1.rawSetCookie ?? "(none)");
    const challenge = (step1.body as { challenge: string }).challenge;

    // Prove the cookie really isn't a session: an agent that just did step 1
    // must still be anonymous.
    const notYet = await fresh.call("/api/auth/me");
    ok("the half-finished login is not signed in", notYet.status === 401, `status ${notYet.status}`);

    const badCode = await fresh.call("/api/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ challenge, code: "000000" }),
    });
    ok("a wrong code is refused", badCode.status === 401, `status ${badCode.status}`);

    const good = await fresh.call("/api/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ challenge, code: totpNow(secret) }),
    });
    ok("the right code completes the login", good.status === 200, `status ${good.status}`);
    const nowIn = await fresh.call("/api/auth/me");
    ok("and the session works", nowIn.status === 200, `status ${nowIn.status}`);

    // Single-use: the challenge died with the attempt that spent it.
    const replay = await fresh.call("/api/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ challenge, code: totpNow(secret) }),
    });
    ok("the challenge cannot be replayed", replay.status === 401, `status ${replay.status}`);

    // ── Recovery codes ──
    resetRateLimits();
    await clearLockout("admin");
    const viaBackup = agent();
    const bstep1 = await viaBackup.call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: PASSWORD }),
    });
    const bchallenge = (bstep1.body as { challenge: string }).challenge;
    const usedCode = backupCodes[0]!;
    const bgood = await viaBackup.call("/api/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ challenge: bchallenge, code: usedCode }),
    });
    ok("a recovery code completes the login", bgood.status === 200, `status ${bgood.status}`);

    const logged = await prisma.activityLog.findFirst({
      where: { action: "auth.login" },
      orderBy: { ts: "desc" },
    });
    ok(
      "recovery-code sign-in is distinguishable in the trail (worth alerting on)",
      (logged?.summary ?? "").includes("recovery code"),
      logged?.summary ?? "(none)",
    );

    resetRateLimits();
    await clearLockout("admin");
    const reuse = agent();
    const rstep1 = await reuse.call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: PASSWORD }),
    });
    const rbad = await reuse.call("/api/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ challenge: (rstep1.body as { challenge: string }).challenge, code: usedCode }),
    });
    ok("the same recovery code cannot be used twice", rbad.status === 401, `status ${rbad.status}`);

    // ── Disable rules ──
    resetRateLimits();
    await clearLockout("admin");
    const selfOff = await admin.call("/api/auth/mfa", {
      method: "DELETE",
      body: JSON.stringify({ currentPassword: PASSWORD, code: totpNow(secret) }),
    });
    ok("a required role cannot switch its own second factor off", selfOff.status === 403, `status ${selfOff.status}`);

    // ── The desktop is exempt ──
    resetRateLimits();
    const desktop = agent();
    // admin reaches every client, so resolveDevice requires an explicit one —
    // it will not guess which establishment a machine belongs to.
    const deviceLogin = await desktop.call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: "admin",
        password: PASSWORD,
        device: {
          fingerprint: "mfa-harness-device-0001",
          name: "MFA harness PC",
          clientId: location!.clientId,
        },
      }),
    });
    ok(
      "a registered desktop signs in without a code (offline by design)",
      deviceLogin.status === 200 && !("mfaRequired" in (deviceLogin.body as object)),
      `status ${deviceLogin.status}`,
    );

    // ── Admin reset, the lost-phone path ──
    resetRateLimits();
    const adminUser = await prisma.user.findUnique({ where: { username: "admin" } });
    const reset = await admin.call(`/api/admin/users/${adminUser!.id}/mfa`, {
      method: "DELETE",
      body: JSON.stringify({ reason: "harness: lost phone" }),
    });
    ok("an administrator can reset a second factor", reset.status === 200, `status ${reset.status}`);
    const resetLog = await prisma.activityLog.findFirst({
      where: { action: "mfa.adminReset" },
      orderBy: { ts: "desc" },
    });
    ok("the reset carries a reason into the trail", (resetLog?.summary ?? "").includes("lost phone"), resetLog?.summary ?? "(none)");
    const leftoverChallenges = await prisma.mfaChallenge.count({ where: { userId: adminUser!.id } });
    ok("and kills any half-finished login against the old factor", leftoverChallenges === 0, `${leftoverChallenges} left`);

    // ── The switch itself ──
    delete process.env.FNB_MFA_KEY;
    resetRateLimits();
    await clearLockout("owner");
    const noKey = agent();
    await login(noKey, "owner");
    const noKeyCall = await noKey.call("/api/admin/users");
    ok("with no FNB_MFA_KEY the whole feature is off (fail-safe)", noKeyCall.status === 200, `status ${noKeyCall.status}`);
  }

  console.log("\n== 11. every registered route, probed unauthenticated");
  {
    /**
     * The check that scales. Sections above test the routes someone thought to
     * test; this one enumerates what the app ACTUALLY registered and probes all
     * of it, so a new route that ships without a guard fails the build instead
     * of waiting for a reviewer to notice.
     *
     * Both authorization bugs found on 2026-08-01 were middleware landing
     * somewhere its author had not pictured — a class of mistake that review
     * catches only by luck, and that this catches by construction.
     */
    delete process.env.FNB_MFA_KEY;
    resetRateLimits();

    const location = await prisma.location.findFirst({ where: { status: "ACTIVE" } });

    /** Routes that are anonymous BY DESIGN. Anything else must refuse. */
    const ANONYMOUS = new Set([
      "GET /api/health",
      "POST /api/auth/login",
      "POST /api/auth/mfa/verify",
      // Logout is deliberately harmless without a session: it clears a cookie
      // that isn't there and returns ok, rather than 401-ing someone who is
      // trying to sign out of an already-dead session.
      "POST /api/auth/logout",
    ]);

    const registered = (app as unknown as { routes: Array<{ method: string; path: string }> }).routes ?? [];
    const seen = new Set<string>();
    const targets: Array<{ method: string; path: string }> = [];
    for (const r of registered) {
      if (r.method === "ALL" || r.path.includes("*")) continue;
      const key = `${r.method} ${r.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ method: r.method, path: r.path });
    }

    // Params get plausible values. When auth is enforced the id never matters —
    // the request is refused before anything looks it up.
    const fill = (p: string) =>
      p
        .replace(/:locationId/g, location!.id)
        .replace(/:[A-Za-z]+/g, "clzzzzzzz0000zzzzzzzzzzzz");

    let exposed = 0;
    let refused = 0;
    let unproven = 0;
    const leaks: string[] = [];
    const weak: string[] = [];

    for (const t of targets) {
      const key = `${t.method} ${t.path}`;
      if (ANONYMOUS.has(key)) continue;
      const res = await agent().call(fill(t.path), {
        method: t.method,
        ...(t.method === "GET" || t.method === "HEAD" ? {} : { body: "{}" }),
      });
      if (res.status >= 200 && res.status < 300) {
        exposed += 1;
        leaks.push(`${key} -> ${res.status}`);
      } else if (res.status === 401 || res.status === 403 || res.status === 404) {
        refused += 1;
      } else {
        // Usually 400: body validation ran before the auth check. Not a hole —
        // the guard still runs — but this probe did not PROVE it, so it is
        // reported rather than counted as a pass.
        unproven += 1;
        weak.push(`${key} -> ${res.status}`);
      }
    }

    ok(
      `no route serves data without a session (${targets.length} routes probed)`,
      exposed === 0,
      exposed === 0 ? `${refused} refused, ${unproven} validated-first` : leaks.slice(0, 8).join(" | "),
    );
    // Visible, not asserted: these are almost certainly fine, and pretending
    // this probe proved them would be the kind of false comfort the whole
    // harness exists to avoid.
    if (unproven > 0) {
      console.log(`       note: ${unproven} route(s) answered 4xx-other before auth could be observed`);
      console.log(`       ${weak.slice(0, 5).join(" | ")}${weak.length > 5 ? " …" : ""}`);
    }
  }

  console.log(
    failures === 0
      ? "\nAll security checks passed.\n"
      : `\n${failures} security check(s) FAILED.\n`,
  );
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
};

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
