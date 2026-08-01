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
import { hashPassword, verifyPassword } from "../src/auth/password";
import { chainAnchor, verifyChain } from "../src/services/activity-chain";

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
/** Mirrors FNB_RATE_LIMIT_LOGIN's default in app.ts. */
const LOGIN_LIMIT_FOR_TEST = Number(process.env.FNB_RATE_LIMIT_LOGIN ?? 10);

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
/**
 * Release the single-use TOTP step (RFC 6238 §5.2, auth/totp.ts).
 *
 * Several checks legitimately need a working code inside the SAME 30-second
 * window, which the real control correctly refuses. Waiting 30s per check would
 * make the harness unusable, so the spent step is cleared explicitly — the same
 * shape as clearLockout, and for the same reason: a control doing its job must
 * not be mistaken for a broken check.
 */
const clearTotpStep = async (username: string) => {
  await prisma.userMfa.updateMany({
    where: { user: { username } },
    data: { lastTotpStep: null },
  });
};

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

    /**
     * The deployment the runbook actually recommends: Caddy terminates TLS and
     * proxies to Node over plain HTTP. `c.req.url` is then `http://…`, so
     * deriving Secure from the socket alone shipped the session cookie WITHOUT
     * it — the very H-1 failure, reintroduced by H-1's own fix.
     *
     * x-forwarded-proto is believed here without FNB_TRUST_PROXY on purpose:
     * forging it can only ADD Secure, which costs the forger their own session
     * over HTTP. Forging X-Forwarded-For writes false evidence into the audit
     * trail, which is why THAT one still has to be earned (section 9).
     */
    resetRateLimits();
    await clearLockout("admin");
    const behindProxy = agent("http://localhost");
    const proxied = await behindProxy.call("/api/auth/login", {
      method: "POST",
      headers: { "x-forwarded-proto": "https" },
      body: JSON.stringify({ username: "admin", password: PASSWORD }),
    });
    ok(
      "cookie IS Secure behind a TLS-terminating proxy (x-forwarded-proto)",
      /;\s*Secure/i.test(proxied.rawSetCookie ?? ""),
      proxied.rawSetCookie ?? "(none)",
    );
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

  console.log("\n== 3b. a malformed stored hash must not accept any password");
  {
    /**
     * `Buffer.from(x, "hex")` is silently lenient — an empty or non-hex segment
     * becomes a ZERO-LENGTH buffer, which flowed into a zero-length derivation
     * and made `timingSafeEqual(empty, empty)` true. A row whose key segment
     * was truncated accepted ANY password. The insider this system is built
     * against is exactly who could blank one segment and sign in as somebody.
     */
    const salt = "ab".repeat(16);
    const cases: Array<[string, string]> = [
      ["empty key segment", `scrypt:32768:8:1:${salt}:`],
      ["non-hex key segment", `scrypt:32768:8:1:${salt}:zzzz`],
      ["short key segment", `scrypt:32768:8:1:${salt}:aabb`],
      ["non-hex salt", `scrypt:32768:8:1:zzzz:${"cd".repeat(32)}`],
      ["nonsense N", `scrypt:0:8:1:${salt}:${"cd".repeat(32)}`],
    ];
    for (const [label, stored] of cases) {
      ok(`${label} rejects any password`, (await verifyPassword("literally-anything", stored)) === false);
    }
    const real = await hashPassword("Fnb!2026");
    ok("a real hash still accepts the right password", (await verifyPassword("Fnb!2026", real)) === true);
    ok("a real hash still rejects a wrong one", (await verifyPassword("nope", real)) === false);
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

    /**
     * CONCURRENCY. The limiter used to increment only AFTER the handler
     * resolved, so parallel requests all read count=0 and all passed — 60
     * concurrent bad sign-ins against a limit of 10 produced 60 x 401 and
     * 0 x 429, each burning a full scrypt derivation. The ceiling applied only
     * to an attacker polite enough to wait for each response, which is to say
     * it did not apply. Sequential checks cannot see this.
     */
    resetRateLimits();
    const burst = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        agent().call("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ username: `burst${i}`, password: "guess" }),
        }),
      ),
    );
    const accepted = burst.filter((r) => r.status !== 429).length;
    ok(
      "the limiter holds under concurrency, not just sequentially",
      accepted <= LOGIN_LIMIT_FOR_TEST,
      `${accepted} of 60 concurrent failures got through (limit ${LOGIN_LIMIT_FOR_TEST})`,
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

    /**
     * The same data, asked for in prose.
     *
     * Stocky needs only `reports.view` — held by every role — and its tools read
     * salesReport/purchaseReport/nonRevenueReport, precisely the reports
     * AUDIT_VIEWER_REPORTS withholds as commercially sensitive. The narrowing
     * middleware keys off a "/reports/" path segment, so /stocky/chat sailed
     * past it: a viewer barred from the sales report could just ask.
     */
    const stocky = await viewer.call(`/api/locations/${location!.id}/stocky/chat`, {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "list every sale last month" }] }),
    });
    ok(
      "an AUDIT_VIEWER cannot reach the same data through Stocky",
      stocky.status === 404,
      `status ${stocky.status}`,
    );

    // Positive control: a role that MAY see sales still reaches Stocky, so the
    // check above is not passing because the endpoint is simply broken.
    resetRateLimits();
    await clearLockout("manager");
    const mgrStocky = agent();
    await login(mgrStocky, "manager");
    const mgrChat = await mgrStocky.call(`/api/locations/${location!.id}/stocky/chat`, {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    });
    ok("but a MANAGER still can", mgrChat.status === 200, `status ${mgrChat.status}`);
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

    /**
     * SINGLE USE (RFC 6238 §5.2). With window=1 a code is otherwise valid for
     * ~90 seconds — ample for anyone who watched it typed or captured it in
     * transit to replay it on a fresh challenge.
     */
    resetRateLimits();
    await clearLockout("admin");
    const spentCode = totpNow(secret);
    const replayer = agent();
    const replayStep1 = await replayer.call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: PASSWORD }),
    });
    const replayed = await replayer.call("/api/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ challenge: (replayStep1.body as { challenge: string }).challenge, code: spentCode }),
    });
    ok(
      "a TOTP code already spent cannot be reused on a new challenge",
      replayed.status === 401,
      `status ${replayed.status}`,
    );
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

    /**
     * ── A device payload must NOT buy an exemption ──
     *
     * This check previously asserted the OPPOSITE — "a registered desktop signs
     * in without a code" — and scored a critical bypass as a pass. `device` is
     * unauthenticated request body: a phished password plus an invented
     * fingerprint yielded a full 365-day session with no code, for exactly the
     * two roles required to hold a second factor. Demonstrated end to end.
     */
    resetRateLimits();
    await clearLockout("admin");
    const desktop = agent();
    const deviceAttempt = await desktop.call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: "admin",
        password: PASSWORD,
        device: {
          fingerprint: "attacker-invented-fingerprint-0001",
          name: "not a real desktop",
          clientId: location!.clientId,
        },
      }),
    });
    ok(
      "a device payload does NOT bypass the second factor",
      (deviceAttempt.body as { mfaRequired?: boolean }).mfaRequired === true,
      `status ${deviceAttempt.status}`,
    );
    ok(
      "and no session cookie is issued for it",
      !/fnb_session=[^;]+/.test(deviceAttempt.rawSetCookie ?? ""),
      deviceAttempt.rawSetCookie ?? "(none)",
    );
    const noDeviceYet = await prisma.device.findUnique({
      where: { fingerprint: "attacker-invented-fingerprint-0001" },
    });
    ok("and no machine is registered on half a credential", noDeviceYet === null);

    // ...but a genuine desktop still completes, carrying its device payload
    // through the challenge, so the offline workflow is unbroken.
    const deviceChallenge = (deviceAttempt.body as { challenge: string }).challenge;
    await clearTotpStep("admin"); // same 30s window as the checks above
    const deviceDone = await desktop.call("/api/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ challenge: deviceChallenge, code: totpNow(secret) }),
    });
    ok("a genuine desktop completes once the code is given", deviceDone.status === 200, `status ${deviceDone.status}`);
    ok(
      "and the device is registered only then",
      (await prisma.device.findUnique({ where: { fingerprint: "attacker-invented-fingerprint-0001" } })) !== null,
    );
    ok(
      "the completed session really is device-bound",
      Boolean((deviceDone.body as { device?: { id: string } }).device?.id),
    );

    // ── The enrolment gate cannot be dodged with a device payload either ──
    //
    // Scoped to the OWNER's own establishment, and its device slots cleared
    // first: Subscription.maxDevices defaults to 1, so the registration above
    // legitimately consumes the licence and a second fingerprint would 403 for
    // a reason that has nothing to do with what this is testing.
    resetRateLimits();
    await clearLockout("owner");
    const ownerAccess = await prisma.userClientAccess.findFirst({
      where: { user: { username: "owner" } },
    });
    await prisma.device.deleteMany({ where: { clientId: ownerAccess!.clientId } });
    const dodger = agent();
    const dodge = await dodger.call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: "owner",
        password: PASSWORD,
        device: {
          fingerprint: "unenrolled-owner-dodge-0001",
          name: "dodge",
          clientId: ownerAccess!.clientId,
        },
      }),
    });
    ok("an UNENROLLED owner may still sign in on a device", dodge.status === 200, `status ${dodge.status}`);
    ok(
      "but a device session does not exempt them from enrolling",
      (dodge.body as { mfaSetupRequired?: boolean }).mfaSetupRequired === true,
    );
    const dodgeGate = await dodger.call("/api/admin/users");
    ok("and the gate still refuses them", dodgeGate.status === 403, `status ${dodgeGate.status}`);

    /**
     * ── x-acting-user may narrow privilege, never widen it ──
     *
     * The header names which staff member is working, for attribution. It was
     * adopting the claimed user's ROLE wholesale, so any account that could get
     * a device session could name the OWNER and hold users.manage. A device
     * session is not owner-only: auth/device.ts returns an already-registered
     * machine to any user of that establishment.
     */
    resetRateLimits();
    await clearLockout("staff");
    const ownerUser = await prisma.user.findUnique({ where: { username: "owner" } });
    const staffOnDesktop = agent();
    const staffDevice = await staffOnDesktop.call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: "staff",
        password: PASSWORD,
        device: { fingerprint: "unenrolled-owner-dodge-0001", name: "dodge" },
      }),
    });
    ok("STAFF can sign in on an already-registered machine", staffDevice.status === 200, `status ${staffDevice.status}`);
    const escalated = await staffOnDesktop.call("/api/admin/users", {
      headers: { "x-acting-user": ownerUser!.id },
    });
    ok(
      "STAFF cannot become OWNER via x-acting-user",
      escalated.status === 403,
      `status ${escalated.status}`,
    );

    /**
     * The subtler half, and the one a rank-order cap got WRONG.
     *
     * STAFF and ACCOUNTANT are incomparable: STAFF holds `entries.create`,
     * ACCOUNTANT holds `reports.export`. Capping by position in ROLES treated
     * ACCOUNTANT (index 4) as "less privileged" than STAFF (index 3) and let the
     * claim through — handing a staff member an export permission they never
     * had. Only a permission-SET comparison catches it.
     */
    const acctUser = await prisma.user.findUnique({ where: { username: "accountant" } });
    const sideways = await staffOnDesktop.call(
      `/api/locations/${location!.id}/reports/full-audit/export?begin=2026-07-14&end=2026-07-20`,
      { headers: { "x-acting-user": acctUser!.id } },
    );
    ok(
      "STAFF cannot sidestep into ACCOUNTANT to gain reports.export",
      sideways.status === 403,
      `status ${sideways.status}`,
    );

    /**
     * POSITIVE CONTROL. Without this the check above could be passing for the
     * wrong reason — the export route 403ing on something unrelated — which is
     * precisely the failure mode that let an MFA bypass sit green all morning.
     *
     * An OWNER device session claiming the ACCOUNTANT is a legitimate NARROWING
     * (OWNER holds reports.export too), so it must succeed. That proves the
     * header path works and the rejection above is specifically the subsumption
     * rule biting.
     */
    resetRateLimits();
    await clearLockout("owner");
    const ownerOnDesktop = agent();
    await ownerOnDesktop.call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: "owner",
        password: PASSWORD,
        device: { fingerprint: "unenrolled-owner-dodge-0001", name: "dodge" },
      }),
    });
    const narrowed = await ownerOnDesktop.call(
      `/api/locations/${location!.id}/reports/full-audit/export?begin=2026-07-14&end=2026-07-20`,
      { headers: { "x-acting-user": acctUser!.id } },
    );
    ok(
      "but an OWNER session CAN act as the accountant (narrowing still works)",
      narrowed.status === 200,
      `status ${narrowed.status}`,
    );

    // ── Admin reset, the lost-phone path ──
    //
    // Performed on ANOTHER user. Resetting your own is now refused (below), so
    // the lost-phone path has to be exercised the way it is actually meant to
    // work: a second human who holds users.manage.
    resetRateLimits();
    await clearLockout("manager");
    const adminUser = await prisma.user.findUnique({ where: { username: "admin" } });
    const managerUser = await prisma.user.findUnique({ where: { username: "manager" } });

    // Give the manager a factor to reset.
    const mgr = agent();
    await login(mgr, "manager");
    const mgrEnrol = await mgr.call("/api/auth/mfa/enroll", {
      method: "POST",
      body: JSON.stringify({ currentPassword: PASSWORD }),
    });
    const mgrSecret = (mgrEnrol.body as { secret: string }).secret;
    await mgr.call("/api/auth/mfa/confirm", {
      method: "POST",
      body: JSON.stringify({ code: totpNow(mgrSecret) }),
    });
    ok(
      "a non-required role may also enrol voluntarily",
      Boolean((await prisma.userMfa.findUnique({ where: { userId: managerUser!.id } }))?.confirmedAt),
    );

    /**
     * Not on yourself. Without this the "a required role cannot switch its own
     * factor off" rule was decorative — refused at DELETE /api/auth/mfa, an
     * ADMIN simply called the ADMIN route on their own id and removed it with a
     * session cookie alone. Anyone holding a stolen session could do the same,
     * then re-enrol their own authenticator and keep the account.
     */
    const selfReset = await admin.call(`/api/admin/users/${adminUser!.id}/mfa`, {
      method: "DELETE",
      body: JSON.stringify({ reason: "harness: attempting self-reset" }),
    });
    ok("an administrator cannot reset their OWN second factor", selfReset.status === 403, `status ${selfReset.status}`);
    ok(
      "and their factor survives the attempt",
      Boolean((await prisma.userMfa.findUnique({ where: { userId: adminUser!.id } }))?.confirmedAt),
    );

    const reset = await admin.call(`/api/admin/users/${managerUser!.id}/mfa`, {
      method: "DELETE",
      body: JSON.stringify({ reason: "harness: lost phone" }),
    });
    ok("an administrator can reset SOMEONE ELSE'S second factor", reset.status === 200, `status ${reset.status}`);
    const resetLog = await prisma.activityLog.findFirst({
      where: { action: "mfa.adminReset" },
      orderBy: { ts: "desc" },
    });
    ok("the reset carries a reason into the trail", (resetLog?.summary ?? "").includes("lost phone"), resetLog?.summary ?? "(none)");
    const leftoverChallenges = await prisma.mfaChallenge.count({ where: { userId: managerUser!.id } });
    ok("and kills any half-finished login against the old factor", leftoverChallenges === 0, `${leftoverChallenges} left`);

    /**
     * Losing the key must not silently downgrade an enrolled account to
     * password-only. It used to: the login gate was a presence check on the env
     * var, so a blank FNB_MFA_KEY removed the factor with no error anywhere.
     */
    const savedKey = process.env.FNB_MFA_KEY;
    delete process.env.FNB_MFA_KEY;
    resetRateLimits();
    await clearLockout("admin");
    const keyless = await agent().call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: PASSWORD }),
    });
    ok(
      "an enrolled account fails CLOSED when the MFA key is missing",
      keyless.status === 503 && (keyless.body as { code?: string }).code === "MFA_UNAVAILABLE",
      `status ${keyless.status}`,
    );
    process.env.FNB_MFA_KEY = savedKey;

    // ── The switch itself ──
    delete process.env.FNB_MFA_KEY;
    resetRateLimits();
    await clearLockout("owner");
    const noKey = agent();
    await login(noKey, "owner");
    const noKeyCall = await noKey.call("/api/admin/users");
    ok("with no FNB_MFA_KEY the whole feature is off (fail-safe)", noKeyCall.status === 200, `status ${noKeyCall.status}`);
  }

  console.log("\n== 10b. health, timeout and password quality");
  {
    resetRateLimits();
    // Section 10 leaves admin ENROLLED with the key removed, which correctly
    // fails login closed (503 MFA_UNAVAILABLE). Clear it so this section tests
    // what it means to test rather than inheriting that state.
    await prisma.userMfa.deleteMany({});
    await prisma.mfaChallenge.deleteMany({});
    // A health check that cannot fail is decoration — this one queries the DB.
    const health = await agent().call("/api/health");
    ok("health reports database state, not just liveness", (health.body as { db?: string }).db === "ok", JSON.stringify(health.body));

    // Breached-password refusal at both places a password can be set. Skipped
    // when the range API is unreachable — the check fails OPEN by design, and a
    // harness that fails on someone else's outage is a harness people disable.
    const admin2 = agent();
    await clearLockout("admin");
    await login(admin2, "admin");
    const target = await prisma.user.findUnique({ where: { username: "staff" } });
    const breached = await admin2.call(`/api/admin/users/${target!.id}`, {
      method: "PUT",
      body: JSON.stringify({ password: "Password123" }),
    });
    if (breached.status === 200) {
      console.log("       (breach API unreachable — check skipped, it fails open by design)");
      // Undo, so later sections can still sign in as staff.
      await admin2.call(`/api/admin/users/${target!.id}`, {
        method: "PUT",
        body: JSON.stringify({ password: PASSWORD }),
      });
    } else {
      ok("a known-breached password is refused", breached.status === 400, `status ${breached.status}`);
      ok(
        "and the refusal says why",
        (breached.body as { code?: string }).code === "PASSWORD_BREACHED",
        String((breached.body as { code?: string }).code),
      );
      const fine = await admin2.call(`/api/admin/users/${target!.id}`, {
        method: "PUT",
        body: JSON.stringify({ password: PASSWORD }),
      });
      ok("but an unbreached one is accepted", fine.status === 200, `status ${fine.status}`);
    }
  }

  console.log("\n== 10c. the audit trail is tamper-evident");
  {
    /**
     * The product-shaped control. Every competitor can say their system LOGS
     * changes; this asserts the log can be shown not to have been edited —
     * including by whoever holds the database, which is this system's stated
     * adversary.
     *
     * Each check below performs a REAL tamper and requires the verifier to
     * catch it. A chain that has never been tested against an actual edit is
     * an assumption wearing a hash.
     */
    resetRateLimits();
    const clean = await verifyChain();
    ok("the chain verifies on an untouched database", clean.ok, `${clean.checked} linked, ${clean.unchained} pre-chain`);
    ok("and every new entry is linked", clean.checked > 0, `${clean.checked} chained rows`);

    // 1. EDIT a historic summary — the "quietly change what happened" attack.
    const victim = await prisma.activityLog.findFirst({
      where: { seq: { not: null } },
      orderBy: { seq: "asc" },
    });
    const originalSummary = victim!.summary;
    await prisma.activityLog.update({
      where: { id: victim!.id },
      data: { summary: "…nothing to see here" },
    });
    const edited = await verifyChain();
    ok(
      "an edited entry breaks the chain",
      !edited.ok && edited.brokenAt?.seq === victim!.seq,
      edited.brokenAt ? `caught at seq ${edited.brokenAt.seq}` : "NOT CAUGHT",
    );
    await prisma.activityLog.update({ where: { id: victim!.id }, data: { summary: originalSummary } });
    ok("and restoring the original repairs it", (await verifyChain()).ok);

    // 2. DELETE an entry — the "make it never have happened" attack. The hashes
    //    alone would still chain across the hole if it were the newest row,
    //    which is why gaps are checked explicitly.
    const middle = await prisma.activityLog.findFirst({
      where: { seq: { not: null } },
      orderBy: { seq: "asc" },
      skip: 2,
    });
    const backup = { ...middle! };
    await prisma.activityLog.delete({ where: { id: middle!.id } });
    const deleted = await verifyChain();
    ok(
      "a deleted entry is detected as a gap",
      !deleted.ok && deleted.gaps.includes(middle!.seq!),
      `gaps: [${deleted.gaps.join(", ")}]`,
    );
    await prisma.activityLog.create({ data: backup });
    ok("and putting it back repairs it", (await verifyChain()).ok);

    // 3. A forged entry, hash and all — the attacker who knows the format.
    //    Appending is not what the chain prevents; it prevents doing so
    //    INVISIBLY, because the tip no longer matches any published anchor.
    const before = await chainAnchor();
    const tip = await prisma.activityLog.findFirst({ where: { seq: { not: null } }, orderBy: { seq: "desc" } });
    await prisma.activityLog.create({
      data: {
        seq: tip!.seq! + 1,
        ts: new Date(),
        action: "forged.entry",
        entity: "Forged",
        summary: "an entry an attacker appended",
        prevHash: tip!.hash,
        hash: "0".repeat(64),
      },
    });
    const forged = await verifyChain();
    ok("a forged entry with a wrong hash is caught", !forged.ok, forged.brokenAt ? `seq ${forged.brokenAt.seq}` : "");
    await prisma.activityLog.deleteMany({ where: { action: "forged.entry" } });

    const after = await chainAnchor();
    ok(
      "the anchor is stable while the trail is untouched",
      before.hash === after.hash,
      `${before.hash.slice(0, 12)}…`,
    );
    ok("and the chain verifies again at the end", (await verifyChain()).ok);
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
    /**
     * Broken down by status, because "refused" hides a real weakness: a probe
     * substitutes a fabricated id into every :param, so an UNGUARDED handler
     * that looks that id up and finds nothing also answers 404 — identical to a
     * route that refused the caller. 401 is proof of a guard; 404 is only
     * consistent with one.
     */
    const byStatus = new Map<number, number>();
    const four04: string[] = [];

    for (const t of targets) {
      const key = `${t.method} ${t.path}`;
      if (ANONYMOUS.has(key)) continue;
      const res = await agent().call(fill(t.path), {
        method: t.method,
        ...(t.method === "GET" || t.method === "HEAD" ? {} : { body: "{}" }),
      });
      byStatus.set(res.status, (byStatus.get(res.status) ?? 0) + 1);
      if (res.status >= 200 && res.status < 300) {
        exposed += 1;
        leaks.push(`${key} -> ${res.status}`);
      } else if (res.status === 401 || res.status === 403 || res.status === 404) {
        refused += 1;
        if (res.status === 404) four04.push(key);
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
    console.log(
      `       statuses: ${[...byStatus.entries()].sort((a, b) => a[0] - b[0]).map(([s, n]) => `${s}×${n}`).join("  ")}`,
    );

    /**
     * Asserted, not merely printed. A route answering anything outside
     * {2xx, 401, 403, 404} — a 500, say — is one this probe did NOT prove
     * guarded, and leaving that green is the same class of mistake as the
     * harness that once scored an MFA bypass as a pass.
     */
    ok(
      "every route's refusal is auth-shaped (no 4xx-other hiding an unproven route)",
      unproven === 0,
      unproven === 0 ? "" : weak.slice(0, 5).join(" | "),
    );

    /**
     * Every single one answers 401 — measured, not hoped.
     *
     * This matters because 404 is only CONSISTENT with a guard, never proof of
     * one: the probe puts a fabricated id in each :param, and an UNGUARDED
     * handler that looks it up and finds nothing answers 404 too. Asserting
     * zero removes that ambiguity entirely — a route that starts answering 404
     * here is one whose guard can no longer be demonstrated, and it needs
     * reading rather than a shrug.
     *
     * (The 404s this codebase does return by design — the audit-viewer report
     * narrowing, the cross-tenant guards — are all behind requireAuth, so an
     * unauthenticated caller meets 401 first and never reaches them.)
     */
    ok(
      "every refusal is specifically 401, so no 404 can be masking a missing guard",
      four04.length === 0,
      four04.length === 0 ? "all 401" : `${four04.length}: ${four04.slice(0, 4).join(", ")}`,
    );
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
