import { createHash, randomBytes } from "node:crypto";
import type { Role, SessionUser } from "@fnb/core";
import { prisma } from "../db";

export const SESSION_COOKIE = "fnb_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, sliding
const RENEW_WHEN_REMAINING_MS = 6 * 24 * 60 * 60 * 1000;

// AUDIT_VIEWER / AUDIT_VIEWER_LIMITED (3rd-party audit-service viewers, paid
// and unpaid respectively) get a short ABSOLUTE session: it hard-expires this
// long after login regardless of activity, forcing a re-login — the client's
// requested 15–20 minute viewing window. Applies to both: an unpaid viewer is
// at least as much a short-session case as a paid one, arguably more so.
const READONLY_SESSION_TTL_MS = 20 * 60 * 1000;

/**
 * A registered offline desktop (proposal §18) is off the network for long
 * stretches by design, so its session must not expire while it is doing the
 * exact thing it was sold to do. The 7-day sliding browser session would lock
 * an establishment out of its own till after a fortnight of bad internet.
 *
 * A year is safe here only because the session is DEVICE-bound: Device.status
 * is checked on every use, so revoking a machine cuts its access the next time
 * it reaches the server. A machine that never reaches the server can only
 * write to its own local mirror, which is worthless without a push.
 */
const DEVICE_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function isAuditViewerRole(role: string): boolean {
  return role === "AUDIT_VIEWER" || role === "AUDIT_VIEWER_LIMITED";
}

function ttlFor(role: string, deviceId?: string | null): number {
  // The audit-viewer cap wins over everything: a third-party viewer does not
  // get a year-long session by signing in from a registered machine.
  if (isAuditViewerRole(role)) return READONLY_SESSION_TTL_MS;
  return deviceId ? DEVICE_SESSION_TTL_MS : SESSION_TTL_MS;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  role: string,
  ip?: string,
  userAgent?: string,
  deviceId?: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlFor(role, deviceId));
  await prisma.authSession.create({
    data: { tokenHash: hashToken(token), userId, expiresAt, ip, userAgent, deviceId },
  });
  return { token, expiresAt };
}

export async function getSessionUser(token: string): Promise<SessionUser | null> {
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { modules: true } }, device: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.authSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  /**
   * A session whose user row is GONE is "not signed in", never a crash.
   *
   * SQLite does not enforce foreign keys here, so a dangling `userId` yields
   * `user: null` rather than an error — and dereferencing it threw a TypeError
   * that surfaced as a 500 on EVERY request. On the desktop that replaced the
   * whole application with `{"error":"Internal server error"}`, because the
   * mirror was carrying sessions issued by a database that had since been
   * rebuilt with new user ids.
   *
   * Deleted rather than merely rejected: the row can never become valid again,
   * and leaving it means paying for the lookup on every request forever.
   */
  if (!session.user) {
    await prisma.authSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.user.status !== "ACTIVE") return null;
  // Device revocation. This check on every request is what makes the year-long
  // device TTL acceptable: an admin who revokes a stolen or decommissioned
  // machine cuts it off the moment it next reaches the server, without having
  // to disable the human accounts that used it.
  if (session.device && session.device.status !== "ACTIVE") {
    await prisma.authSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.device) {
    await prisma.device
      .update({ where: { id: session.device.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {});
  }
  // A user demoted to AUDIT_VIEWER/AUDIT_VIEWER_LIMITED mid-session must not
  // ride out a long session: clamp any pre-existing expiry down to the
  // 20-minute cap on first read.
  if (isAuditViewerRole(session.user.role) && session.expiresAt.getTime() - Date.now() > READONLY_SESSION_TTL_MS) {
    const clamped = new Date(Date.now() + READONLY_SESSION_TTL_MS);
    await prisma.authSession.update({ where: { id: session.id }, data: { expiresAt: clamped } }).catch(() => {});
  }
  // Sliding expiry: extend once the session has aged past a day.
  // AUDIT_VIEWER / AUDIT_VIEWER_LIMITED sessions never renew — their
  // 20-minute window is absolute.
  // Renewed to the session's OWN ttl, not the browser constant — renewing a
  // device session to 7 days would quietly undo the whole point of the year.
  if (!isAuditViewerRole(session.user.role) && session.expiresAt.getTime() - Date.now() < RENEW_WHEN_REMAINING_MS) {
    await prisma.authSession
      .update({
        where: { id: session.id },
        data: { expiresAt: new Date(Date.now() + ttlFor(session.user.role, session.deviceId)) },
      })
      .catch(() => {});
  }
  const u = session.user;
  return {
    id: u.id,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role as Role,
    // ADMIN is never module-restricted; no rows = unrestricted.
    modules: u.role === "ADMIN" || u.modules.length === 0 ? null : u.modules.map((m) => m.module),
    deviceId: session.deviceId,
  };
}

export async function destroySession(token: string): Promise<void> {
  await prisma.authSession
    .delete({ where: { tokenHash: hashToken(token) } })
    .catch(() => {});
}
