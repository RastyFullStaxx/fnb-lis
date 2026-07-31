import { Hono } from "hono";
import { zValidator } from "../lib/validate";
import { z } from "zod";
import {
  LOGIN_LOCKOUT_MS,
  LOGIN_LOCKOUT_THRESHOLD,
  normalizeRecoveryAnswer,
  setDevicePin,
  validatePin,
} from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { hashPassword, verifyPassword } from "../auth/password";
import { logActivity } from "../services/activity";
import { requireAuth, requirePermission, type AppEnv } from "../middleware/auth";

/**
 * Device PINs — how a person signs in on the offline desktop.
 *
 * The PIN is NEVER accepted as a login here. These routes only manage the
 * stored hash; verification happens on the device, against the copy it received
 * in its snapshot, with no network. That asymmetry is the design: a secret the
 * server refuses to accept is worthless to anyone who steals it from a bar PC.
 *
 * See docs/sync-and-data-lifecycle.md §5.
 */

/** Whether a user is inside the shared 5-attempt / 1-hour lockout window. */
function isLockedOut(user: { failedLoginCount: number; failedLoginAt: Date | null }): boolean {
  return (
    user.failedLoginCount >= LOGIN_LOCKOUT_THRESHOLD &&
    user.failedLoginAt !== null &&
    Date.now() - user.failedLoginAt.getTime() < LOGIN_LOCKOUT_MS
  );
}

export const pinRoutes = new Hono<AppEnv>()
  /** Do I have a PIN, and what is my recovery question? Never returns hashes. */
  .get("/pin", requireAuth, async (c) => {
    const me = c.get("user")!;
    const pin = await prisma.devicePin.findUnique({ where: { userId: me.id } });
    return c.json({
      hasPin: Boolean(pin),
      recoveryQuestion: pin?.recoveryQuestion ?? null,
      updatedAt: pin?.updatedAt ?? null,
    });
  })

  .post("/pin", requireAuth, zValidator("json", setDevicePin), async (c) => {
    const me = c.get("user")!;
    const body = c.req.valid("json");

    // Same policy object the Electron app will use — a PIN accepted on the
    // device but rejected here would stop working on reconnect.
    const problem = validatePin(body.pin);
    if (problem) throw new AppError(400, problem);

    const user = await prisma.user.findUnique({ where: { id: me.id } });
    if (!user) throw new AppError(404, "User not found");

    // Both proofs are guessable secrets, so both ride the SAME lockout the
    // login route uses. Without this the recovery answer would be an
    // unthrottled oracle sitting next to a throttled password.
    if (isLockedOut(user)) {
      throw new AppError(423, "Too many failed attempts. Try again in an hour.");
    }

    let via: "password" | "recovery";
    if (body.currentPassword) {
      if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
        await prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: { increment: 1 }, failedLoginAt: new Date() },
        });
        throw new AppError(401, "That password is incorrect");
      }
      via = "password";
    } else {
      const existing = await prisma.devicePin.findUnique({ where: { userId: user.id } });
      if (!existing) throw new AppError(400, "No recovery question is set — confirm with your password instead");
      const ok = await verifyPassword(
        normalizeRecoveryAnswer(body.currentRecoveryAnswer!),
        existing.recoveryAnswerHash,
      );
      if (!ok) {
        await prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: { increment: 1 }, failedLoginAt: new Date() },
        });
        throw new AppError(401, "That answer doesn't match");
      }
      via = "recovery";
    }

    const [pinHash, recoveryAnswerHash] = await Promise.all([
      hashPassword(body.pin),
      hashPassword(normalizeRecoveryAnswer(body.recoveryAnswer)),
    ]);

    await prisma.$transaction(async (tx) => {
      await tx.devicePin.upsert({
        where: { userId: user.id },
        create: { userId: user.id, pinHash, recoveryQuestion: body.recoveryQuestion, recoveryAnswerHash },
        update: { pinHash, recoveryQuestion: body.recoveryQuestion, recoveryAnswerHash },
      });
      if (user.failedLoginCount > 0) {
        await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, failedLoginAt: null } });
      }
      await logActivity(
        {
          user: me,
          action: via === "recovery" ? "pin.recover" : "pin.set",
          entity: "DevicePin",
          entityId: user.id,
          // The recovery path is spelled out in the summary on purpose: this is
          // the line an admin scanning the activity feed needs to notice.
          summary:
            via === "recovery"
              ? `${user.username} reset their device PIN using the recovery question`
              : `${user.username} set a device PIN`,
          details: { via },
        },
        tx,
      );
    });

    return c.json({ ok: true, via });
  })

  /** Remove my own PIN — I can no longer sign in offline until I set a new one. */
  .delete("/pin", requireAuth, async (c) => {
    const me = c.get("user")!;
    const existing = await prisma.devicePin.findUnique({ where: { userId: me.id } });
    if (!existing) throw new AppError(404, "No PIN is set");
    await prisma.$transaction(async (tx) => {
      await tx.devicePin.delete({ where: { userId: me.id } });
      await logActivity(
        { user: me, action: "pin.clear", entity: "DevicePin", entityId: me.id, summary: `${me.username} removed their device PIN` },
        tx,
      );
    });
    return c.json({ ok: true });
  });

/**
 * Clearing someone else's PIN — the path that matters most in a real bar, and
 * the reason the recovery question is a last resort rather than the plan. It
 * requires a second human who is present and holds `users.manage`, which is a
 * stronger check than any question, and it needs connectivity. When the network
 * is up, this is how a forgotten PIN gets fixed.
 */
export const pinAdminRoutes = new Hono<AppEnv>()
  .use("/users/:id/pin", requireAuth, requirePermission("users.manage"))
  .delete("/users/:id/pin", zValidator("json", z.object({ reason: z.string().trim().min(3) })), async (c) => {
    const actor = c.get("user")!;
    const { reason } = c.req.valid("json");
    const targetId = c.req.param("id");

    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, username: true, role: true, clientAccess: { select: { clientId: true } } },
    });
    if (!target) throw new AppError(404, "User not found");

    // Same scoping rule as the rest of user administration: an OWNER may only
    // reach staff of his own establishment, and never an LIS ADMIN.
    if (actor.role !== "ADMIN") {
      if (target.role === "ADMIN") throw new AppError(403, "You cannot manage a system administrator");
      const mine = await prisma.userClientAccess.findMany({
        where: { userId: actor.id },
        select: { clientId: true },
      });
      const shared = target.clientAccess.some((a) => mine.some((m) => m.clientId === a.clientId));
      if (!shared) throw new AppError(404, "User not found");
    }

    const existing = await prisma.devicePin.findUnique({ where: { userId: targetId } });
    if (!existing) throw new AppError(404, "That user has no PIN set");

    await prisma.$transaction(async (tx) => {
      await tx.devicePin.delete({ where: { userId: targetId } });
      await logActivity(
        {
          user: actor,
          action: "pin.adminClear",
          entity: "DevicePin",
          entityId: targetId,
          summary: `Cleared ${target.username}'s device PIN: ${reason}`,
        },
        tx,
      );
    });
    return c.json({ ok: true });
  });
