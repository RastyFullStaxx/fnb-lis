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
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { resetRateLimits } from "../src/middleware/security";

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
    // Generous bound: the point is that a miss is not ORDERS of magnitude
    // faster, which is what makes enumeration trivial.
    const ratio = hitMs / Math.max(missMs, 0.001);
    ok(
      "unknown-user and wrong-password take comparable time",
      ratio < 3 && ratio > 0.33,
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
