import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { zValidator } from "../lib/validate";
import {
  mfaConfirmRequest,
  mfaDisableRequest,
  mfaEnrollRequest,
  mfaRequiredFor,
  MFA_BACKUP_CODE_COUNT,
  type MfaStatus,
  type Role,
} from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { hashPassword, verifyPassword } from "../auth/password";
import {
  encryptSecret,
  decryptSecret,
  isMfaAvailable,
  newTotpSecret,
  otpauthUri,
  verifyTotp,
} from "../auth/totp";
import { logActivity } from "../services/activity";
import { requireAuth, requirePermission, type AppEnv } from "../middleware/auth";

/**
 * Second-factor enrolment (TOTP).
 *
 * Mounted on /api/auth so it stays reachable while requireMfaEnrolment is
 * blocking everything else — an account that MUST enrol has to be able to
 * reach the routes that let it.
 *
 * The verification half of the login lives in routes/auth.ts, beside the
 * password check it partners.
 */

function assertAvailable(): void {
  if (!isMfaAvailable()) {
    throw new AppError(
      503,
      "Two-factor authentication isn't configured on this server. Ask your LIS administrator to set FNB_MFA_KEY.",
    );
  }
}

/**
 * Ten single-use recovery codes. Shown ONCE, stored as scrypt hashes — the same
 * primitive the password uses, so there is one constant-time comparison to
 * audit rather than two.
 *
 * Grouped as xxxx-xxxx because these get written on paper and read back under
 * pressure, which is the entire situation they exist for.
 */
async function issueBackupCodes(): Promise<{ plain: string[]; stored: string }> {
  const plain = Array.from({ length: MFA_BACKUP_CODE_COUNT }, () => {
    const raw = randomBytes(4).toString("hex"); // 8 hex chars, 32 bits
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
  const hashes = await Promise.all(plain.map((c) => hashPassword(c.toLowerCase())));
  return { plain, stored: hashes.join("\n") };
}

export const mfaRoutes = new Hono<AppEnv>()
  .use("/mfa", requireAuth)
  .use("/mfa/*", requireAuth)

  /** Status for the account-security screen. Never returns the secret. */
  .get("/mfa", async (c) => {
    const me = c.get("user")!;
    const mfa = await prisma.userMfa.findUnique({ where: { userId: me.id } });
    const status: MfaStatus = {
      available: isMfaAvailable(),
      enrolled: Boolean(mfa?.confirmedAt),
      required: isMfaAvailable() && mfaRequiredFor(me.role as Role),
      confirmedAt: mfa?.confirmedAt?.toISOString() ?? null,
      backupCodesRemaining: mfa?.backupCodes ? mfa.backupCodes.split("\n").filter(Boolean).length : 0,
    };
    return c.json(status);
  })

  /**
   * Begin enrolment: mint a secret and hand back the otpauth URI to scan.
   *
   * Re-proving the password is the point of this step. Without it, anyone who
   * finds an unlocked screen can bind THEIR authenticator to the account —
   * turning a walk-past into permanent, exclusive control of it.
   *
   * The row is written UNCONFIRMED. Nothing about the login changes until
   * /mfa/confirm proves a working code, so an abandoned or mis-scanned
   * enrolment cannot lock anyone out.
   */
  .post("/mfa/enroll", zValidator("json", mfaEnrollRequest), async (c) => {
    assertAvailable();
    const me = c.get("user")!;
    const { currentPassword } = c.req.valid("json");

    const user = await prisma.user.findUnique({ where: { id: me.id } });
    if (!user) throw new AppError(404, "User not found");
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 }, failedLoginAt: new Date() },
      });
      throw new AppError(401, "That password is incorrect");
    }

    const existing = await prisma.userMfa.findUnique({ where: { userId: me.id } });
    if (existing?.confirmedAt) {
      throw new AppError(409, "Two-factor authentication is already on. Turn it off first to re-enrol.");
    }

    const secret = newTotpSecret();
    await prisma.userMfa.upsert({
      where: { userId: me.id },
      create: { userId: me.id, secretEnc: encryptSecret(secret), backupCodes: "" },
      // Re-starting enrolment replaces the pending secret — the previous QR
      // was never confirmed, so nothing depends on it.
      update: { secretEnc: encryptSecret(secret), backupCodes: "", confirmedAt: null },
    });

    return c.json({ secret, otpauthUri: otpauthUri(user.username, secret) });
  })

  /**
   * Finish enrolment by proving one code from the app just scanned, then hand
   * over the recovery codes — once, and never again.
   */
  .post("/mfa/confirm", zValidator("json", mfaConfirmRequest), async (c) => {
    assertAvailable();
    const me = c.get("user")!;
    const { code } = c.req.valid("json");

    const mfa = await prisma.userMfa.findUnique({ where: { userId: me.id } });
    if (!mfa) throw new AppError(400, "Start setup first");
    if (mfa.confirmedAt) throw new AppError(409, "Two-factor authentication is already on");

    if (!verifyTotp(decryptSecret(mfa.secretEnc), code)) {
      throw new AppError(401, "That code is incorrect. Check your phone's clock is accurate and try the next code.");
    }

    const { plain, stored } = await issueBackupCodes();
    await prisma.$transaction(async (tx) => {
      await tx.userMfa.update({
        where: { userId: me.id },
        data: { confirmedAt: new Date(), backupCodes: stored },
      });
      await logActivity(
        {
          user: me,
          action: "mfa.enable",
          entity: "UserMfa",
          entityId: me.id,
          summary: `${me.username} turned on two-factor authentication`,
        },
        tx,
      );
    });

    // The only time these are ever readable.
    return c.json({ backupCodes: plain });
  })

  /**
   * Turn off my own second factor. Both proofs required — a password alone
   * would leave MFA removable by exactly the attacker it exists to stop.
   *
   * Refused for roles that MUST hold one. Those go through an administrator
   * (below), which is a stronger check than any self-service flow: a second
   * human who is present and holds `users.manage`. Same reasoning as the device
   * PIN in routes/pin.ts.
   */
  .delete("/mfa", zValidator("json", mfaDisableRequest), async (c) => {
    const me = c.get("user")!;
    const { currentPassword, code } = c.req.valid("json");

    if (mfaRequiredFor(me.role as Role)) {
      throw new AppError(
        403,
        "Your role requires two-factor authentication. An administrator can reset it for you if you've lost your phone.",
      );
    }

    const mfa = await prisma.userMfa.findUnique({ where: { userId: me.id } });
    if (!mfa?.confirmedAt) throw new AppError(404, "Two-factor authentication isn't on");

    const user = await prisma.user.findUnique({ where: { id: me.id } });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new AppError(401, "That password is incorrect");
    }
    if (!verifyTotp(decryptSecret(mfa.secretEnc), code)) {
      throw new AppError(401, "That code is incorrect");
    }

    await prisma.$transaction(async (tx) => {
      await tx.userMfa.delete({ where: { userId: me.id } });
      await logActivity(
        {
          user: me,
          action: "mfa.disable",
          entity: "UserMfa",
          entityId: me.id,
          summary: `${me.username} turned off two-factor authentication`,
        },
        tx,
      );
    });
    return c.json({ ok: true });
  });

/**
 * Clearing someone else's second factor — the lost-phone path, and the reason
 * self-service disable can be refused for the roles that need MFA most.
 *
 * Deliberately the same shape as pinAdminRoutes: `users.manage`, the same
 * tenant scoping, a mandatory reason, and a transactional audit entry. An
 * administrator resetting another person's MFA is precisely the event the trail
 * exists for.
 */
export const mfaAdminRoutes = new Hono<AppEnv>()
  .use("/users/:id/mfa", requireAuth, requirePermission("users.manage"))
  .delete("/users/:id/mfa", zValidator("json", z.object({ reason: z.string().trim().min(3) })), async (c) => {
    const actor = c.get("user")!;
    const { reason } = c.req.valid("json");
    const targetId = c.req.param("id");

    /**
     * NOT on yourself.
     *
     * Without this the "a required role cannot switch its own second factor
     * off" rule was decorative: an ADMIN or OWNER refused by DELETE
     * /api/auth/mfa simply called this route with their own id and removed it
     * with a session cookie alone — no password, no code, no second human.
     * Anyone holding a stolen session could do the same and then re-enrol their
     * own authenticator, taking the account permanently.
     *
     * The whole point of routing lost phones through an administrator is that a
     * SECOND person is involved. Acting on yourself is not that.
     */
    /**
     * Both identities, not just the acting one.
     *
     * `x-acting-user` lets a device session choose who `c.get("user")` is. With
     * only `actor.id` checked, an owner holding the desktop's session could name
     * a colleague of equal role — which `roleSubsumes` permits — and then clear
     * their OWN factor, because `targetId !== actor.id` was satisfied. The audit
     * row would credit the impersonated colleague.
     *
     * `sessionUserId` is set only when a substitution actually happened, so on
     * an ordinary browser session this is exactly the same single check.
     */
    if (targetId === actor.id || targetId === actor.sessionUserId) {
      throw new AppError(
        403,
        "You can't reset your own two-factor authentication. Ask another administrator to do it.",
      );
    }

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

    const existing = await prisma.userMfa.findUnique({ where: { userId: targetId } });
    if (!existing) throw new AppError(404, "That user has no second factor set up");

    await prisma.$transaction(async (tx) => {
      await tx.userMfa.delete({ where: { userId: targetId } });
      // Any half-finished login for that account dies with it, so a challenge
      // issued against the OLD factor cannot be completed after the reset.
      await tx.mfaChallenge.deleteMany({ where: { userId: targetId } });
      await logActivity(
        {
          user: actor,
          action: "mfa.adminReset",
          entity: "UserMfa",
          entityId: targetId,
          summary: `Reset ${target.username}'s two-factor authentication: ${reason}`,
        },
        tx,
      );
    });
    return c.json({ ok: true });
  });
