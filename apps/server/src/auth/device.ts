import { can, type DeviceLogin, type Role } from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";

/** Establishments this account may reach — ADMIN sees every active client. */
async function reachableClientIds(user: { id: string; role: string }): Promise<string[]> {
  if (user.role === "ADMIN") {
    const all = await prisma.client.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
    return all.map((c) => c.id);
  }
  const access = await prisma.userClientAccess.findMany({
    where: { userId: user.id, client: { status: "ACTIVE" } },
    select: { clientId: true },
  });
  return access.map((a) => a.clientId);
}

/**
 * Resolve the Device an offline-desktop login belongs to, registering it the
 * first time that machine is seen.
 *
 * Trust-on-first-use, bounded by the licence: the alternative is asking the LIS
 * admin to read a machine fingerprint off a computer they have never touched,
 * before the software that computes it is installed. The bound is what keeps
 * that honest — Subscription.maxDevices caps how many machines a client can
 * ever register, and every registration is visible and revocable afterwards.
 *
 * Everything here is a 403 rather than a silent fallback to a browser session.
 * A desktop that quietly received a 7-day session would appear to work and then
 * strand a fortnight of counts on a machine that can no longer authenticate.
 */
export async function resolveDevice(
  user: { id: string; role: string },
  req: DeviceLogin,
): Promise<{ id: string; clientId: string; locationId: string | null }> {
  const clientIds = await reachableClientIds(user);
  const existing = await prisma.device.findUnique({ where: { fingerprint: req.fingerprint } });

  if (existing) {
    if (existing.status !== "ACTIVE") {
      throw new AppError(403, "This computer's access has been revoked. Contact your LIS administrator.");
    }
    // Scoping, same rule as every other route: the account signing in must
    // actually belong to the establishment this machine is registered to, or a
    // valid login at one client would open a mirror of another's books.
    if (!clientIds.includes(existing.clientId)) {
      throw new AppError(403, "This computer is registered to a different establishment.");
    }
    return existing;
  }

  // ── First sight: register ──
  if (!can(user.role as Role, "devices.manage")) {
    throw new AppError(
      403,
      "This computer isn't set up yet. Ask the establishment's owner or your LIS administrator to sign in once on it first.",
    );
  }

  const clientId = req.clientId ?? (clientIds.length === 1 ? clientIds[0] : undefined);
  if (!clientId) {
    throw new AppError(400, "Choose which establishment this computer belongs to.");
  }
  if (!clientIds.includes(clientId)) {
    throw new AppError(403, "You don't have access to that establishment.");
  }

  const subscription = await prisma.subscription.findUnique({ where: { clientId } });
  const cap = subscription?.maxDevices ?? 1;
  if (cap > 0) {
    // ponytail: count-then-create, not a transaction. Two people registering
    // two machines in the same millisecond could overshoot the cap by one; the
    // fingerprint unique index still prevents a machine registering twice, and
    // registration is a once-per-installation human act. Wrap it in a
    // transaction if licence counts ever need to be exact.
    const registered = await prisma.device.count({ where: { clientId, status: "ACTIVE" } });
    if (registered >= cap) {
      throw new AppError(
        403,
        `This establishment's licence covers ${cap} computer${cap === 1 ? "" : "s"}, and ${registered} ${registered === 1 ? "is" : "are"} already registered. Your LIS administrator can revoke the old one or widen the licence.`,
      );
    }
  }

  return prisma.device.create({
    data: { clientId, name: req.name, fingerprint: req.fingerprint },
  });
}
