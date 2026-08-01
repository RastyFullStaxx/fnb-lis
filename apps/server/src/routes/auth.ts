import { Hono, type Context } from "hono";
import { createHash, randomBytes } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { zValidator } from "../lib/validate";
import {
  deriveAccessState,
  loginRequest,
  mfaRequiredFor,
  mfaVerifyRequest,
  LOGIN_LOCKOUT_MS,
  LOGIN_LOCKOUT_THRESHOLD,
  MFA_CHALLENGE_TTL_MS,
  type DeviceLogin,
  type MeClient,
  type MeResponse,
  type Role,
} from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { burnPasswordTime, hashPassword, needsRehash, verifyPassword } from "../auth/password";
import { resolveDevice } from "../auth/device";
import { createSession, destroySession, SESSION_COOKIE } from "../auth/session";
import { decryptSecret, isMfaAvailable, verifyTotp } from "../auth/totp";
import { logActivity } from "../services/activity";
import { mfaEnrolmentOutstanding, requireAuth, type AppEnv } from "../middleware/auth";
import { clientIp, isSecureRequest } from "../middleware/security";

export const authRoutes = new Hono<AppEnv>()
  .post("/login", zValidator("json", loginRequest), async (c) => {
    const { username, password, rememberMe, device } = c.req.valid("json");

    const user = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      include: { modules: true },
    });
    const failMessage = "Incorrect username or password";
    if (!user || user.status !== "ACTIVE") {
      // Spend the same ~100 ms scrypt an existing account would, before
      // answering. Returning immediately here made the response time a reliable
      // oracle for "does this username exist?" — a miss answered in single-digit
      // milliseconds, a hit in a hundred. That turns the deliberately vague
      // "Incorrect username or password" into an enumeration endpoint, and a
      // confirmed list of real usernames is the first half of credential
      // stuffing against a system whose accounts are named after staff.
      await burnPasswordTime(password);
      throw new AppError(401, failMessage);
    }

    // Legacy lockout rule: 5 failed attempts within the window → locked 1 hour.
    if (
      user.failedLoginCount >= LOGIN_LOCKOUT_THRESHOLD &&
      user.failedLoginAt &&
      Date.now() - user.failedLoginAt.getTime() < LOGIN_LOCKOUT_MS
    ) {
      throw new AppError(423, "Account locked after too many failed attempts. Try again in an hour.");
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 }, failedLoginAt: new Date() },
      });
      throw new AppError(401, failMessage);
    }

    if (user.failedLoginCount > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, failedLoginAt: null },
      });
    }

    /**
     * Upgrade a hash written with weaker parameters, now that we hold the
     * plaintext and have already proved it. The only moment this is possible.
     *
     * Without it, raising the scrypt cost protects only accounts created after
     * the change — the oldest accounts, which includes the administrators, stay
     * on the old cost indefinitely. It also re-closes the enumeration oracle:
     * see needsRehash in auth/password.ts.
     *
     * Best-effort. A failure here must never cost someone their sign-in — they
     * proved their password, and the hash they already had is still valid.
     */
    if (needsRehash(user.passwordHash)) {
      await prisma.user
        .update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } })
        .catch(() => {});
    }

    /**
     * Second factor, if this account holds one.
     *
     * NOTHING is issued here — no cookie, no session, no device registration,
     * no `auth.login` in the trail. A password that is only half of the
     * credential must buy exactly one thing: the right to present the other
     * half. The challenge row is the whole state that crosses the gap.
     *
     * Device sessions are exempt. The desktop authenticates a machine, checks
     * its PIN locally with no network, and is sold on working through a bad
     * connection — demanding a phone code from a bar PC with no signal breaks
     * the one thing it exists to do. The machine is separately revocable, which
     * is the control that stands in for the second factor there.
     */
    if (!device && isMfaAvailable()) {
      const mfa = await prisma.userMfa.findUnique({ where: { userId: user.id } });
      if (mfa?.confirmedAt) {
        const challengeToken = randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS);
        await prisma.mfaChallenge.create({
          data: {
            tokenHash: hashChallenge(challengeToken),
            userId: user.id,
            expiresAt,
            rememberMe: rememberMe !== false,
            deviceJson: null,
            ip: clientIp(c),
            userAgent: c.req.header("user-agent"),
          },
        });
        return c.json({
          mfaRequired: true as const,
          challenge: challengeToken,
          expiresAt: expiresAt.toISOString(),
        });
      }
    }

    return c.json(await completeLogin(c, user, { rememberMe, device }));
  })

  /**
   * Second step of a two-step login. Accepts a TOTP code or a single-use
   * recovery code, and only then issues the session.
   *
   * Rate-limited alongside /login in app.ts and wired into the SAME per-account
   * lockout the password uses — a 6-digit code is only 10^6 guesses, which is
   * strong solely because it is throttled. routes/pin.ts makes the same point
   * about its two proofs.
   */
  .post("/mfa/verify", zValidator("json", mfaVerifyRequest), async (c) => {
    const { challenge, code } = c.req.valid("json");
    const row = await prisma.mfaChallenge.findUnique({
      where: { tokenHash: hashChallenge(challenge) },
      include: { user: { include: { modules: true } } },
    });
    if (!row || row.expiresAt.getTime() < Date.now()) {
      if (row) await prisma.mfaChallenge.delete({ where: { id: row.id } }).catch(() => {});
      throw new AppError(401, "That sign-in attempt has expired. Start again.");
    }
    const user = row.user;
    if (user.status !== "ACTIVE") throw new AppError(401, "Incorrect username or password");
    if (isLockedOut(user)) {
      throw new AppError(423, "Account locked after too many failed attempts. Try again in an hour.");
    }

    const mfa = await prisma.userMfa.findUnique({ where: { userId: user.id } });
    if (!mfa?.confirmedAt) throw new AppError(400, "This account has no second factor set up");

    const accepted = await consumeMfaCode(mfa, code);
    if (!accepted) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 }, failedLoginAt: new Date() },
      });
      throw new AppError(401, "That code is incorrect");
    }

    // Single-use: the challenge dies with the attempt that spent it, so a
    // captured challenge token cannot be replayed against a second guess.
    await prisma.mfaChallenge.delete({ where: { id: row.id } }).catch(() => {});
    if (user.failedLoginCount > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, failedLoginAt: null },
      });
    }
    // Housekeeping, on the natural occasion — this project has no scheduler,
    // and a TTL that only exists in a comment is not a TTL.
    await prisma.mfaChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});

    return c.json(
      await completeLogin(c, user, { rememberMe: row.rememberMe, device: undefined, via: accepted }),
    );
  })

  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const user = c.get("user");
    if (token) await destroySession(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    if (user) {
      await logActivity({
        user,
        action: "auth.logout",
        entity: "User",
        entityId: user.id,
        summary: `${user.username} signed out`,
        details: { ip: clientIp(c), userAgent: c.req.header("user-agent") ?? null },
      });
    }
    return c.json({ ok: true });
  })

  .get("/me", requireAuth, async (c) => {
    return c.json(await buildMe(c.get("user")!));
  });

/** Whether a user is inside the shared 5-attempt / 1-hour lockout window. */
function isLockedOut(user: { failedLoginCount: number; failedLoginAt: Date | null }): boolean {
  return (
    user.failedLoginCount >= LOGIN_LOCKOUT_THRESHOLD &&
    user.failedLoginAt !== null &&
    Date.now() - user.failedLoginAt.getTime() < LOGIN_LOCKOUT_MS
  );
}

/** Challenge tokens are stored hashed, exactly like session tokens. */
function hashChallenge(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Accept a TOTP code or spend one recovery code. Returns how it was accepted,
 * or null. Recovery codes are removed from the stored set as they are used.
 */
async function consumeMfaCode(
  mfa: { userId: string; secretEnc: string; backupCodes: string },
  code: string,
): Promise<"totp" | "backup" | null> {
  if (verifyTotp(decryptSecret(mfa.secretEnc), code)) return "totp";

  const cleaned = code.trim().toLowerCase().replace(/\s+/g, "");
  const hashes = mfa.backupCodes.split("\n").filter(Boolean);
  for (const hash of hashes) {
    if (await verifyPassword(cleaned, hash)) {
      await prisma.userMfa.update({
        where: { userId: mfa.userId },
        data: { backupCodes: hashes.filter((h) => h !== hash).join("\n") },
      });
      return "backup";
    }
  }
  return null;
}

/**
 * Everything that happens once the credentials — however many of them this
 * account needs — are fully proved.
 *
 * Shared by the one-step and two-step logins so the device binding, the STAFF
 * single-session rule, the cookie flags and the audit entry cannot drift apart
 * between the two paths.
 */
async function completeLogin(
  c: Context<AppEnv>,
  user: { id: string; username: string; firstName: string; lastName: string; role: string; modules: { module: string }[] },
  opts: { rememberMe?: boolean; device?: DeviceLogin; via?: "totp" | "backup" },
) {
  const { rememberMe, device, via } = opts;
  const ip = clientIp(c);

  // Resolved AFTER the credentials check, never before: doing it earlier would
  // let an unauthenticated caller probe which fingerprints are registered and
  // burn licence slots.
  const registeredDevice = device ? await resolveDevice(user, device) : null;

    // STAFF may hold only one active session at a time — a new login always
    // ends whatever session that account already had, logged so the closed
    // device is traceable. Every other role (ADMIN, OWNER, MANAGER,
    // ACCOUNTANT, READONLY) can hold multiple concurrent sessions as before.
    //
    // Exempt on a registered desktop: the single-session rule exists so a staff
    // login can't be shared across two browsers, but the desktop IS the shared
    // machine (§18 "sole operational interface") and evicting its session every
    // time another staff member signs in would log the bar out mid-count.
    if (user.role === "STAFF" && !registeredDevice) {
      const priorSessions = await prisma.authSession.findMany({
        where: { userId: user.id, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      if (priorSessions.length > 0) {
        // Atomic, like every other mutation-plus-log: this ends a session the
        // person holding it did not ask to end — someone mid-count gets thrown
        // out — so "it happened but nothing recorded it" must not be reachable.
        await prisma.$transaction(async (tx) => {
          await tx.authSession.deleteMany({
            where: { id: { in: priorSessions.map((s) => s.id) } },
          });
          await logActivity(
            {
              user: {
                id: user.id,
                username: user.username,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                modules: null,
              } as MeResponse["user"],
              action: "auth.autoLogout",
              entity: "User",
              entityId: user.id,
              summary: `${user.username}'s prior session was ended by a new login`,
              details: { ip, userAgent: c.req.header("user-agent") ?? null, endedSessionCount: priorSessions.length },
            },
            tx,
          );
        });
      }
    }

    const { token, expiresAt } = await createSession(
      user.id,
      user.role,
      ip,
      c.req.header("user-agent"),
      registeredDevice?.id,
    );
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      // Asked of the request, not of NODE_ENV. The old constant meant a hosted
      // deploy that forgot to export NODE_ENV=production sent session cookies
      // without Secure — and this cookie IS the session, so one plaintext
      // request on a shared network hands over the establishment's books.
      // Deriving it per-request also keeps the plain-HTTP Electron desktop
      // working, which a hard-coded `true` would have broken.
      secure: isSecureRequest(c),
      path: "/",
      // ponytail: rememberMe=false → no expires, browser drops cookie on close.
      // Server-side session (and its 7-day sliding expiry) is unchanged either way.
      ...(rememberMe === false ? {} : { expires: expiresAt }),
    });

    const sessionUser = {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      modules: user.role === "ADMIN" || user.modules.length === 0 ? null : user.modules.map((m) => m.module),
    };
    await logActivity({
      user: sessionUser as MeResponse["user"],
      action: "auth.login",
      entity: "User",
      entityId: user.id,
      summary: registeredDevice
        ? `${user.username} signed in on "${device!.name}"`
        : via === "backup"
          ? `${user.username} signed in using a recovery code`
          : `${user.username} signed in`,
      details: {
        ip,
        userAgent: c.req.header("user-agent") ?? null,
        deviceId: registeredDevice?.id ?? null,
        // "Signed in with a second factor" is worth being able to see in the
        // trail, and a recovery-code sign-in is worth being able to ALERT on:
        // it means someone has lost their authenticator, or taken someone
        // else's codes.
        mfa: via ?? null,
      },
    });

  return {
    ...(await buildMe(sessionUser as MeResponse["user"])),
    // Only present on a desktop login — tells the mirror which location it is
    // provisioned for, so it knows what to pull without being told twice.
    device: registeredDevice
      ? { id: registeredDevice.id, clientId: registeredDevice.clientId, locationId: registeredDevice.locationId }
      : undefined,
  };
}

async function buildMe(user: MeResponse["user"]): Promise<MeResponse> {
  const clients =
    user.role === "ADMIN"
      ? await prisma.client.findMany({
          where: { status: "ACTIVE" },
          include: {
            locations: { where: { status: "ACTIVE" }, include: { modules: true } },
            subscription: { select: { packageType: true, status: true, modules: true, billingCycle: true, startDate: true, paid: true, lastPaidAt: true } },
          },
          orderBy: { name: "asc" },
        })
      : (
          await prisma.userClientAccess.findMany({
            where: { userId: user.id, client: { status: "ACTIVE" } },
            include: {
              client: {
                include: {
                  locations: { where: { status: "ACTIVE" }, include: { modules: true } },
                  subscription: { select: { packageType: true, status: true, modules: true, billingCycle: true, startDate: true, paid: true, lastPaidAt: true } },
                },
              },
            },
          })
        )
          .map((a) => a.client)
          .sort((a, b) => a.name.localeCompare(b.name));

  // Per-user module restriction (client req #9): each location's advertised
  // module set is PRE-INTERSECTED with the user's own, and locations whose
  // intersection is empty are hidden from the switcher entirely — the same
  // rule requireLocationAccess enforces with a 403 on direct URLs. The nav
  // and catalog UI need zero further changes; they already consume these
  // per-location module lists.
  const userModules = user.role === "ADMIN" ? null : (user.modules ?? null);
  const effectiveModules = (locationModules: string[]): string[] | null => {
    if (!userModules || userModules.length === 0) return locationModules;
    if (locationModules.length === 0) return userModules;
    const overlap = locationModules.filter((m) => userModules.includes(m));
    return overlap.length > 0 ? overlap : null; // null = hide this location
  };

  const meClients: MeClient[] = clients
    .map((cl) => ({
      id: cl.id,
      name: cl.name,
      // Effective, not raw: the admin switch AND the billing state both gate
      // downloads, so the UI shows one honest answer instead of re-deriving it.
      reportDownloads: !cl.allowReportDownloads
        ? ("DISABLED" as const)
        : cl.subscription && deriveAccessState(cl.subscription, new Date()) === "VIEW_ONLY"
          ? ("PAST_DUE" as const)
          : ("ALLOWED" as const),
      locations: cl.locations.flatMap((l) => {
        // Same rule as requireLocationAccess: a non-ACTIVE subscription
        // (TRIAL/SUSPENDED/CANCELLED) falls back to an unrestricted location
        // ceiling rather than hiding paid-for data — so the switcher and the
        // middleware can never disagree about which locations exist.
        const subscriptionActive = !cl.subscription || cl.subscription.status === "ACTIVE";
        const locationModules = subscriptionActive ? l.modules.map((m) => m.module) : [];
        const modules = effectiveModules(locationModules);
        if (modules === null) return [];
        return [
          {
            id: l.id,
            name: l.name,
            clientId: l.clientId,
            kind: l.kind ?? null,
            modules,
          },
        ];
      }),
      subscription: cl.subscription
        ? {
            packageType: cl.subscription.packageType,
            status: cl.subscription.status,
            modules: cl.subscription.modules.map((m) => m.module),
          }
        : null,
    }))
    .filter((cl) => cl.locations.length > 0);

  return {
    user,
    clients: meClients,
    features: { aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY) },
    // So the UI can render the enrolment screen rather than a wall of 403
    // toasts. The actual gate is requireMfaEnrolment in middleware/auth.ts —
    // this flag is the explanation, not the control.
    mfaSetupRequired: (await mfaEnrolmentOutstanding(user)) || undefined,
  };
}
