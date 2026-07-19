import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import {
  loginRequest,
  LOGIN_LOCKOUT_MS,
  LOGIN_LOCKOUT_THRESHOLD,
  type MeClient,
  type MeResponse,
} from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { verifyPassword } from "../auth/password";
import { createSession, destroySession, SESSION_COOKIE } from "../auth/session";
import { logActivity } from "../services/activity";
import { requireAuth, type AppEnv } from "../middleware/auth";

const isProd = process.env.NODE_ENV === "production";

export const authRoutes = new Hono<AppEnv>()
  .post("/login", zValidator("json", loginRequest), async (c) => {
    const { username, password, rememberMe } = c.req.valid("json");

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
    const { token, expiresAt } = await createSession(user.id, user.role, ip, c.req.header("user-agent"));
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
      summary: `${user.username} signed in`,
    });

    return c.json(await buildMe(sessionUser as MeResponse["user"]));
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
            subscription: { select: { packageType: true, status: true, modules: true } },
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
                  subscription: { select: { packageType: true, status: true, modules: true } },
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
      locations: cl.locations.flatMap((l) => {
        const modules = effectiveModules(l.modules.map((m) => m.module));
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
