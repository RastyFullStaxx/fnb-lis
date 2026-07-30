import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import {
  deriveAccessState,
  loginRequest,
  LOGIN_LOCKOUT_MS,
  LOGIN_LOCKOUT_THRESHOLD,
  type MeClient,
  type MeResponse,
} from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { verifyPassword } from "../auth/password";
import { resolveDevice } from "../auth/device";
import { createSession, destroySession, SESSION_COOKIE } from "../auth/session";
import { logActivity } from "../services/activity";
import { requireAuth, type AppEnv } from "../middleware/auth";

const isProd = process.env.NODE_ENV === "production";

export const authRoutes = new Hono<AppEnv>()
  .post("/login", zValidator("json", loginRequest), async (c) => {
    const { username, password, rememberMe, device } = c.req.valid("json");

    const user = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      include: { modules: true },
    });
    const failMessage = "Incorrect username or password";
    if (!user || user.status !== "ACTIVE") throw new AppError(401, failMessage);

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

    const ip = c.req.header("x-forwarded-for") ?? "";

    // Resolved AFTER the password check, never before: doing it earlier would
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
        await prisma.authSession.deleteMany({
          where: { id: { in: priorSessions.map((s) => s.id) } },
        });
        await logActivity({
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
      secure: isProd,
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
        : `${user.username} signed in`,
      details: { ip, userAgent: c.req.header("user-agent") ?? null, deviceId: registeredDevice?.id ?? null },
    });

    return c.json({
      ...(await buildMe(sessionUser as MeResponse["user"])),
      // Only present on a desktop login — tells the mirror which location it is
      // provisioned for, so it knows what to pull without being told twice.
      device: registeredDevice
        ? { id: registeredDevice.id, clientId: registeredDevice.clientId, locationId: registeredDevice.locationId }
        : undefined,
    });
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
        details: { ip: c.req.header("x-forwarded-for") ?? "", userAgent: c.req.header("user-agent") ?? null },
      });
    }
    return c.json({ ok: true });
  })

  .get("/me", requireAuth, async (c) => {
    return c.json(await buildMe(c.get("user")!));
  });

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
  };
}
