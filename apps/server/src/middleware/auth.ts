import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { Client, Location } from "../generated/prisma/client";
import {
  can,
  deriveAccessState,
  mfaRequiredFor,
  roleSubsumes,
  type Permission,
  type Role,
  type SessionUser,
} from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { getSessionUser, SESSION_COOKIE } from "../auth/session";
import { isMfaAvailable } from "../auth/totp";

export type AppEnv = {
  Variables: {
    user: SessionUser | null;
    client: Client;
    location: Location;
    /**
     * The active location's OWN modules (e.g. ["BAR"]) — the enforced
     * reality per Fix Plan §2.3, not the client's subscription ceiling.
     * Null if the location has no LocationModule rows (unassigned/legacy —
     * matches allowedProductTypes(null) -> unrestricted).
     */
    locationModules: string[] | null;
  };
};

/**
 * Header the offline desktop sends to say WHICH of its staff is acting.
 * See ACTING_USER below.
 */
export const ACTING_USER_HEADER = "x-acting-user";

/** Resolves the session cookie to a user (or null) on every request. */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const user = token ? await getSessionUser(token) : null;
  c.set("user", user && (await resolveActingUser(c, user)));
  await next();
});

/**
 * On a DEVICE session, swap in the staff member the desktop says is acting.
 *
 * The offline desktop holds ONE long-lived session — the one opened when the
 * owner registered the machine — but many people use it across a shift. Without
 * this, every count line pushed from that machine would carry the owner's name
 * in `createdById`, and an audit trail that credits one person for everyone's
 * work is worse than no audit trail: it is a confident lie. Nineteen routes read
 * `c.get("user")` for attribution, so the substitution belongs here, once,
 * rather than as nineteen chances to get it wrong.
 *
 * Doing it at the session layer also means PERMISSIONS follow the real actor:
 * `requirePermission` now sees the STAFF member, so a staff login on the desktop
 * cannot void records just because the machine was registered by an owner.
 *
 * The trust boundary, stated plainly: a registered device is trusted to assert
 * which of ITS OWN client's users is acting, because offline there is nobody
 * else to ask — the PIN check happens on the machine, against hashes it was
 * given. That trust is bounded three ways: the claim is rejected unless the
 * session is device-bound, the named user must be active and belong to that
 * device's establishment, and the machine is revocable. A browser session
 * cannot use this header at all.
 */
async function resolveActingUser(c: Context, session: SessionUser): Promise<SessionUser> {
  const claimed = c.req.header(ACTING_USER_HEADER);
  if (!claimed || !session.deviceId || claimed === session.id) return session;

  const device = await prisma.device.findUnique({ where: { id: session.deviceId } });
  if (!device) return session;

  // NOT filtered on status: "ACTIVE". A device can be offline for weeks, and a
  // user disabled in the browser during that window has still really done the
  // work sitting in that machine's outbox. Rejecting it would delete a week of
  // counts to enforce an access decision made after the fact — and the audit
  // trail would then be missing entries for stock that genuinely moved.
  // docs/sync-and-data-lifecycle.md §7.5 says accept and flag; this is that.
  //
  // The real trust boundary is client scoping, which is enforced below: a
  // device may only name users of its OWN establishment.
  const actor = await prisma.user.findFirst({
    where: {
      id: claimed,
      clientAccess: { some: { clientId: device.clientId } },
    },
    include: { modules: true },
  });
  // Silently falling back to the session user would attribute the work to the
  // wrong person, which is the exact failure this exists to prevent. Refuse.
  if (!actor) throw new AppError(403, "That user cannot act on this device");

  /**
   * THE HEADER MAY ONLY NARROW PRIVILEGE, NEVER WIDEN IT.
   *
   * This exists for attribution — which member of staff recorded this count —
   * and attribution needs no extra permission. But the claimed user's ROLE was
   * being adopted wholesale with no proof, and the header is unauthenticated
   * request data. Any account that could obtain a device session could then
   * name the OWNER and hold `users.manage`, `entries.void` and `prices.edit`
   * with no owner password, no PIN and no second factor.
   *
   * That mattered more than it looks, because a device session is NOT limited
   * to owners: auth/device.ts returns an already-registered ACTIVE machine to
   * any user of that establishment, checking `devices.manage` only when
   * REGISTERING a new one. So a STAFF login on the bar PC — the ordinary case —
   * was one header away from being the owner.
   *
   * The FIRST attempt at this capped by position in `ROLES`, and that was still
   * wrong: these roles are not totally ordered. STAFF and ACCOUNTANT are
   * incomparable — STAFF holds `entries.create`, ACCOUNTANT holds
   * `reports.export` — so "narrowing" STAFF to ACCOUNTANT handed out an export
   * permission STAFF never had. A widening wearing a narrowing's clothes.
   * `roleSubsumes` compares the permission SETS instead, derived from
   * PERMISSIONS itself so a new permission cannot fall outside the check.
   *
   * Rejecting rather than silently downgrading matches the convention just
   * above: an unusable claim is a 403, never a quiet substitution, because
   * attributing work to the wrong person is the exact failure this prevents.
   */
  if (!roleSubsumes(session.role, actor.role as Role)) {
    console.warn(
      `[auth] x-acting-user refused: session role ${session.role} does not subsume claimed role ${actor.role}`,
    );
    throw new AppError(403, "That user cannot act on this device");
  }

  return {
    id: actor.id,
    username: actor.username,
    firstName: actor.firstName,
    lastName: actor.lastName,
    role: actor.role as Role,
    modules: actor.role === "ADMIN" || actor.modules.length === 0 ? null : actor.modules.map((m) => m.module),
    deviceId: session.deviceId,
    /**
     * Who actually holds the session, as distinct from who is claimed to be
     * acting. Routes that must not let a person act on THEMSELVES through a
     * borrowed identity need both — see the self-reset guard in routes/mfa.ts.
     */
    sessionUserId: session.id,
    actorDisabled: actor.status !== "ACTIVE" || undefined,
  };
}

/**
 * CSRF guard for a same-origin cookie SPA: browsers attach Origin on
 * mutating fetches — when present it must match the request host.
 * Absent Origin (curl, server-to-server) passes; cookies aren't at risk there.
 */
export const originCheck = createMiddleware(async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("origin");
    if (origin) {
      const host = c.req.header("host");
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (!host || originHost !== host) {
        throw new AppError(403, "Cross-origin request rejected");
      }
    }
  }
  await next();
});

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) throw new AppError(401, "Not signed in");
  await next();
});

/**
 * ADMIN and OWNER cannot use the app until they hold a second factor.
 *
 * Server-side, not a UI flag — the same rule as every other permission here
 * (README rule 5). `MeResponse.mfaSetupRequired` exists so the client can show
 * an enrolment screen instead of a wall of 403s, but this is the gate.
 *
 * Existing accounts cannot be hard-blocked at LOGIN, or turning the feature on
 * would lock out the only administrator with no way back in. So the login
 * succeeds and everything past it is refused until they enrol, with the
 * enrolment routes themselves deliberately left open. That is the whole
 * allowlist:
 *
 *   /api/auth/*   — me, logout, and the enrolment routes they need to reach
 *   /api/health   — unauthenticated anyway
 *
 * Note the ordering this depends on: mounted AFTER sessionMiddleware (so there
 * is a user to inspect) and BEFORE every route group, so there is no path that
 * quietly predates the check.
 */
/**
 * Read per call, not captured at module load: `isMfaAvailable()` already works
 * that way, and having the two halves of one decision disagree about WHEN they
 * read the environment is the kind of subtlety that produces a control which is
 * on in production and off in the harness that was supposed to prove it.
 */
const mfaEnforcementOn = () => process.env.FNB_REQUIRE_MFA !== "0";

/**
 * What an un-enrolled account may still reach.
 *
 * `/api/auth/*` is the enrolment flow itself — blocking it would gate people
 * out of the only screen that can un-gate them.
 *
 * `/api/settings/preferences` is here because it is a PER-USER DISPLAY setting
 * (font size, unit system) with no security value whatsoever, and it is fetched
 * globally by PreferencesProvider on every page including the enrolment screen.
 * Refusing it meant the enrolment page rendered at the wrong font size for a
 * user who had chosen "large" for poor eyesight — punishing exactly the person
 * we are asking to read a QR-code setup flow. It also made the client's 403
 * handler, rather than the login redirect, the thing driving them there.
 */
const ALLOWED_WHILE_UNENROLLED = (path: string): boolean =>
  path.startsWith("/api/auth/") ||
  path === "/api/health" ||
  path === "/api/settings/preferences";

/**
 * Does this account's role demand a second factor it has not set up yet?
 *
 * Lives here rather than beside the login route so the dependency runs one way
 * — routes import middleware, never the reverse.
 *
 * A device session DOES qualify. It used to be exempted here, which let an
 * ADMIN or OWNER opt out of the requirement permanently by sending one login
 * with a device payload — request data they control. The consequence is real
 * and intended: an unenrolled owner who registers a bar PC is gated until they
 * enrol, which they can do because registration happens online, at the server,
 * with the owner standing at the machine.
 */
export async function mfaEnrolmentOutstanding(user: SessionUser): Promise<boolean> {
  if (!isMfaAvailable()) return false;
  // NOT exempted by `user.deviceId`. It used to be, and that let an ADMIN or
  // OWNER opt out of the requirement permanently by sending one login with a
  // device payload — request data they control. A device session is now
  // unreachable for an enrolled account without a code (routes/auth.ts), and
  // this closes the other half: an UNenrolled one cannot use the same trick to
  // avoid ever enrolling.
  //
  // Staff on a shared desktop are unaffected. resolveActingUser has already
  // swapped in the real actor by the time this runs, and mfaRequiredFor(STAFF)
  // is false — the gate only ever fires for the roles that must hold a factor.
  if (!mfaRequiredFor(user.role as Role)) return false;
  const mfa = await prisma.userMfa.findUnique({
    where: { userId: user.id },
    select: { confirmedAt: true },
  });
  return !mfa?.confirmedAt;
}

export const requireMfaEnrolment = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user");
  if (!user || !mfaEnforcementOn()) return next();
  if (ALLOWED_WHILE_UNENROLLED(c.req.path)) return next();
  if (await mfaEnrolmentOutstanding(user)) {
    throw new AppError(
      403,
      "Your role requires two-factor authentication. Set it up to continue.",
      "MFA_SETUP_REQUIRED",
    );
  }
  await next();
});

export function requirePermission(permission: Permission) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user) throw new AppError(401, "Not signed in");
    if (!can(user.role as Role, permission)) {
      throw new AppError(403, "You don't have permission for this action");
    }
    await next();
  });
}

/**
 * Resolves :locationId, verifies the user may access its client
 * (ADMIN bypasses; everyone else needs a UserClientAccess row),
 * and attaches { client, location } to the context.
 */
export const requireLocationAccess = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user");
  if (!user) throw new AppError(401, "Not signed in");

  const locationId = c.req.param("locationId");
  if (!locationId) throw new AppError(400, "Missing location");

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    include: {
      client: { include: { subscription: true } },
      modules: { select: { module: true } },
    },
  });
  if (!location || location.status !== "ACTIVE" || location.client.status !== "ACTIVE") {
    throw new AppError(404, "Location not found");
  }

  if (user.role !== "ADMIN") {
    const access = await prisma.userClientAccess.findUnique({
      where: { userId_clientId: { userId: user.id, clientId: location.clientId } },
    });
    // 404, not 403: another client's location must be indistinguishable from a
    // nonexistent one (same convention as the transfers tenant guard).
    if (!access) throw new AppError(404, "Location not found");
  }

  // Billing lockout. The admin UI already told the client "Overdue by more than
  // 7 days — mark as paid to restore access", and showed a View-only badge, but
  // nothing enforced it: writes returned 200. Either the badge lies or the state
  // means something; this makes it mean something.
  //
  // Reads always pass — an establishment that owes money can still look at its
  // own audit history. ADMIN bypasses entirely, or an unpaid client's LIS
  // administrator could not get in to mark the invoice paid.
  const sub = location.client.subscription;
  const isWrite = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
  // Downloads count as restricted too, not just writes (client 2026-07-28:
  // "pag hindi pa nagbayad, pwede view report lang — no download reports and no
  // manipulation"). An export is a GET, so the write test alone let a past-due
  // establishment keep taking files out of the system.
  const isDownload = c.req.path.includes("/export");
  if ((isWrite || isDownload) && user.role !== "ADMIN" && sub && deriveAccessState(sub, new Date()) === "VIEW_ONLY") {
    throw new AppError(
      403,
      isDownload
        ? "This establishment's subscription is past due. Reports can still be viewed on screen, but downloads are paused until payment is settled."
        : "This establishment's subscription is past due, so the system is read-only. Contact your LIS administrator to restore access.",
      "SUBSCRIPTION_VIEW_ONLY",
    );
  }

  // Independent of billing: the LIS admin can withhold downloads from a client
  // outright (client 2026-07-28: "pwede ko din enable na view reports lang sya
  // at disable download reports"). Viewing on screen is unaffected.
  if (isDownload && user.role !== "ADMIN" && !location.client.allowReportDownloads) {
    throw new AppError(
      403,
      "Report downloads are turned off for this establishment. You can still view every report on screen.",
      "DOWNLOADS_DISABLED",
    );
  }

  c.set("client", location.client);
  c.set("location", location);
  // Suspended/cancelled subscriptions fall back to unrestricted (null) rather than
  // silently locking a client out of their own data — billing status is handled
  // separately (admin UI), not by hiding inventory the client already paid for.
  //
  // Phase C: the module ceiling is what actually gates catalog access — this
  // reads the LOCATION's own module set (LocationModule), not the client's
  // subscription-wide set, per the §2.3 design principle ("each location's
  // own modules are the enforced reality"). A location with no LocationModule
  // rows (unassigned/legacy) stays unrestricted.
  const subscriptionActive = !location.client.subscription || location.client.subscription.status === "ACTIVE";
  const locationSet =
    subscriptionActive && location.modules.length > 0 ? location.modules.map((m) => m.module) : null;

  // Per-user module restriction (client req #9): the effective set is the
  // intersection of the location's modules and the user's own — computed once
  // here, so everything downstream (reports, catalog, imports, nav via /me)
  // is scoped through the existing allowedProductTypes(locationModules) path
  // with no further changes. ADMIN and unrestricted users pass through.
  let effective = locationSet;
  if (user.role !== "ADMIN" && user.modules && user.modules.length > 0) {
    if (locationSet) {
      effective = locationSet.filter((m) => user.modules!.includes(m));
      if (effective.length === 0) {
        throw new AppError(
          403,
          `Your account doesn't cover this location's modules (${locationSet.join(", ")}). Ask an administrator to widen your module access.`,
        );
      }
    } else {
      effective = user.modules;
    }
  }
  c.set("locationModules", effective);
  await next();
});
