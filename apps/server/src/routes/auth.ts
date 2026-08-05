import { Hono, type Context } from "hono";
import { createHash, randomBytes } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { zValidator } from "../lib/validate";
import {
  deriveAccessState,
  deviceLogin,
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
import { decryptSecret, isMfaAvailable, verifyTotpStep } from "../auth/totp";
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

    /**
     * The counter is NOT cleared here.
     *
     * Clearing it on a correct password made the per-account lockout useless
     * against the second factor: someone holding the password could guess four
     * TOTP codes, sign in again to zero the counter, and repeat forever. Six
     * digits with an unbounded budget is not a second factor.
     *
     * It is cleared in completeLogin instead — once EVERY factor the account
     * requires has been proved. For an account without MFA that is this same
     * moment, so nothing changes for them.
     */

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
     * A DEVICE LOGIN IS NOT EXEMPT. It used to be — `if (!device && ...)` — and
     * that was a critical hole, because `device` is unauthenticated request
     * body. Nothing proves the caller is the Electron desktop: no client
     * certificate, no shared secret, no signature. `deviceLogin` validates the
     * SHAPE of a fingerprint, not its provenance.
     *
     * So a phished password plus an invented fingerprint bought a full session
     * with no code at all — and, because registering a new machine needs
     * `devices.manage` (ADMIN/OWNER), which is byte-identical to
     * MFA_REQUIRED_ROLES, the exemption was available to exactly the two roles
     * that must never have it. Worse, the resulting session was device-bound:
     * a 365-day TTL instead of 7 days, with mfaEnrolmentOutstanding
     * short-circuiting on deviceId so the enrolment gate never fired either.
     * Demonstrated end to end before this was changed.
     *
     * Requiring the code here costs the desktop nothing real. Registration and
     * sign-in happen at the server, over the network, with the owner standing
     * at the machine — which is exactly when a phone is available. The offline
     * story is unaffected: once registered, the desktop verifies PINs locally
     * against its mirror and does not re-authenticate here.
     *
     * The device payload rides the challenge (`deviceJson`) rather than being
     * resolved now, so a machine is still never registered for someone who has
     * proved only half their credentials.
     */
    /**
     * Asked of the ACCOUNT first, the configuration second.
     *
     * This used to be `if (isMfaAvailable() && ...)`, which is a presence check
     * on an env var — so losing or blanking FNB_MFA_KEY silently downgraded
     * every already-enrolled ADMIN and OWNER to password-only, with no error
     * anywhere. A config accident quietly removing a security control is the
     * worst shape a failure can take.
     *
     * Fail CLOSED instead: a confirmed factor exists, so it must be presented,
     * and if the server cannot verify it then nobody signs in on that account
     * until the key is restored from backup. That is the behaviour the docs
     * already promise ("losing FNB_MFA_KEY locks out every enrolled user") —
     * this makes the code agree with them.
     */
    {
      const mfa = await prisma.userMfa.findUnique({ where: { userId: user.id } });
      if (mfa?.confirmedAt && !isMfaAvailable()) {
        throw new AppError(
          503,
          "Two-factor authentication is set up on this account, but this server can't verify it right now. Contact your LIS administrator.",
          "MFA_UNAVAILABLE",
        );
      }
      if (mfa?.confirmedAt) {
        const challengeToken = randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS);
        await prisma.mfaChallenge.create({
          data: {
            tokenHash: hashChallenge(challengeToken),
            userId: user.id,
            expiresAt,
            rememberMe: rememberMe !== false,
            deviceJson: device ? JSON.stringify(device) : null,
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
    /**
     * Same fail-closed answer the login step gives. Without it, a challenge
     * issued before the key went missing reached `decryptSecret`, which throws a
     * plain Error — a raw 500 in exactly the incident this branch exists for,
     * and one that burned a rate-limit slot on the way out.
     */
    if (!isMfaAvailable()) {
      throw new AppError(
        503,
        "Two-factor authentication is set up on this account, but this server can't verify it right now. Contact your LIS administrator.",
        "MFA_UNAVAILABLE",
      );
    }

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
    // The failed-attempt counter is cleared in completeLogin, once every factor
    // is proved — not here, and not after the password check.
    // Housekeeping, on the natural occasion — this project has no scheduler,
    // and a TTL that only exists in a comment is not a TTL.
    await prisma.mfaChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});

    /**
     * The device payload the FIRST step carried, replayed now that both halves
     * of the credential are proved. Re-validated rather than trusted: it went
     * out to the database and came back, and a schema is cheaper than reasoning
     * about whether that round trip could have been tampered with.
     *
     * A malformed payload drops to a plain browser session rather than throwing
     * — the person has authenticated correctly, and refusing them a session over
     * a bad device field would be the wrong failure.
     */
    let device: DeviceLogin | undefined;
    if (row.deviceJson) {
      // JSON.parse inside the try too — it throws on malformed text, and the
      // whole point of this block is that a bad device field costs a device
      // binding, never the sign-in of someone who authenticated correctly.
      try {
        const parsed = deviceLogin.safeParse(JSON.parse(row.deviceJson));
        if (parsed.success) device = parsed.data;
      } catch {
        /* not JSON — fall through to a plain browser session */
      }
    }

    return c.json(
      await completeLogin(c, user, { rememberMe: row.rememberMe, device, via: accepted }),
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
  mfa: { userId: string; secretEnc: string; backupCodes: string; lastTotpStep: number | null },
  code: string,
): Promise<"totp" | "backup" | null> {
  const step = verifyTotpStep(decryptSecret(mfa.secretEnc), code);
  if (step !== null) {
    /**
     * Single-use, per RFC 6238 §5.2. A code is refused once its step has been
     * spent — and `<=` rather than `===` so an OLDER step inside the window
     * cannot be replayed either after a newer one has been accepted.
     *
     * The conditional `updateMany` is what makes it hold under concurrency:
     * two simultaneous verifies presenting the same code both read the same
     * `lastTotpStep`, but only one write matches the WHERE and the loser is
     * told no. A plain read-then-write would let both through.
     */
    if (mfa.lastTotpStep !== null && step <= mfa.lastTotpStep) return null;
    const { count } = await prisma.userMfa.updateMany({
      where: { userId: mfa.userId, lastTotpStep: mfa.lastTotpStep },
      data: { lastTotpStep: step },
    });
    return count === 1 ? "totp" : null;
  }

  const cleaned = code.trim().toLowerCase().replace(/\s+/g, "");

  /**
   * Shape gate before the expensive path.
   *
   * Recovery codes are issued as `xxxx-xxxx` (routes/mfa.ts). Without this
   * check, every WRONG 6-digit TOTP code fell through and ran up to ten
   * sequential scrypt derivations at N=32768 — 32 MB and ~80 ms each — that
   * could never match, because a 6-digit string is not that shape. Roughly
   * 0.8 s of CPU and 320 MB of churn handed to anyone who mistypes, or to
   * anyone who wants to.
   */
  if (!/^[0-9a-f]{4}-[0-9a-f]{4}$/.test(cleaned)) return null;

  const hashes = mfa.backupCodes.split("\n").filter(Boolean);
  for (const hash of hashes) {
    if (!(await verifyPassword(cleaned, hash))) continue;
    /**
     * Conditional write, so single-use survives concurrency. A plain
     * read-modify-write of the whole newline-joined string lets two
     * simultaneous verifies both read the same set, both match, and both write
     * back — resurrecting a spent code. `updateMany` with the ORIGINAL string
     * in the WHERE makes exactly one of them win; the loser is told no.
     */
    const { count } = await prisma.userMfa.updateMany({
      where: { userId: mfa.userId, backupCodes: mfa.backupCodes },
      data: { backupCodes: hashes.filter((h) => h !== hash).join("\n") },
    });
    return count === 1 ? "backup" : null;
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
  user: {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    role: string;
    failedLoginCount: number;
    modules: { module: string }[];
  },
  opts: { rememberMe?: boolean; device?: DeviceLogin; via?: "totp" | "backup" },
) {
  const { rememberMe, device, via } = opts;
  const ip = clientIp(c);

  // Every required factor is now proved, so the failed-attempt counter can be
  // cleared. Deliberately here and not after the password check — see the note
  // at that site.
  if (user.failedLoginCount > 0) {
    await prisma.user
      .update({ where: { id: user.id }, data: { failedLoginCount: 0, failedLoginAt: null } })
      .catch(() => {});
  }

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
            subscription: { select: { packageType: true, status: true, modules: true, reports: true, billingCycle: true, startDate: true, paid: true, lastPaidAt: true } },
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
                  subscription: { select: { packageType: true, status: true, modules: true, reports: true, billingCycle: true, startDate: true, paid: true, lastPaidAt: true } },
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
            reports: cl.subscription.reports.map((r) => r.reportSlug),
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
