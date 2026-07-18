import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { Client, Location } from "../generated/prisma/client";
import { can, type Permission, type Role, type SessionUser } from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { getSessionUser, SESSION_COOKIE } from "../auth/session";

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

/** Resolves the session cookie to a user (or null) on every request. */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  c.set("user", token ? await getSessionUser(token) : null);
  await next();
});

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
      client: { include: { subscription: { select: { status: true } } } },
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
    if (!access) throw new AppError(403, "No access to this client");
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
  c.set(
    "locationModules",
    subscriptionActive && location.modules.length > 0 ? location.modules.map((m) => m.module) : null,
  );
  await next();
});
