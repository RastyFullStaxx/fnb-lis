import { createHash, randomBytes } from "node:crypto";
import type { Role, SessionUser } from "@fnb/core";
import { prisma } from "../db";

export const SESSION_COOKIE = "fnb_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, sliding
const RENEW_WHEN_REMAINING_MS = 6 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  ip?: string,
  userAgent?: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.authSession.create({
    data: { tokenHash: hashToken(token), userId, expiresAt, ip, userAgent },
  });
  return { token, expiresAt };
}

export async function getSessionUser(token: string): Promise<SessionUser | null> {
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.authSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.user.status !== "ACTIVE") return null;
  // Sliding expiry: extend once the session has aged past a day.
  if (session.expiresAt.getTime() - Date.now() < RENEW_WHEN_REMAINING_MS) {
    await prisma.authSession
      .update({
        where: { id: session.id },
        data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
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
  };
}

export async function destroySession(token: string): Promise<void> {
  await prisma.authSession
    .delete({ where: { tokenHash: hashToken(token) } })
    .catch(() => {});
}
