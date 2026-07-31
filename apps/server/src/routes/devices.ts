import { Hono } from "hono";
import { zValidator } from "../lib/validate";
import { z } from "zod";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { logActivity } from "../services/activity";
import { requireAuth, requirePermission, type AppEnv } from "../middleware/auth";

/**
 * Registered offline desktops (proposal §18). This exists because the device
 * session lasts a year: without a way to see and revoke a machine, that TTL
 * would be an un-revocable credential sitting on a computer in a bar.
 *
 * Registration itself is not here — it happens on first login from the machine
 * (see auth/device.ts), because nobody can read a fingerprint off a computer
 * before installing the software that computes it.
 */

/** Which establishments the actor may act on. ADMIN is unscoped. */
async function scopedClientIds(actorId: string, role: string): Promise<string[] | null> {
  if (role === "ADMIN") return null; // null = every client
  const access = await prisma.userClientAccess.findMany({
    where: { userId: actorId },
    select: { clientId: true },
  });
  return access.map((a) => a.clientId);
}

async function ownedDevice(actorId: string, role: string, deviceId: string) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  const clientIds = await scopedClientIds(actorId, role);
  // 404 rather than 403 for a foreign device — same convention as
  // requireLocationAccess: another establishment's machine must be
  // indistinguishable from one that does not exist.
  if (!device || (clientIds && !clientIds.includes(device.clientId))) {
    throw new AppError(404, "Device not found");
  }
  return device;
}

export const deviceRoutes = new Hono<AppEnv>()
  .use("/devices", requireAuth, requirePermission("devices.manage"))
  .use("/devices/*", requireAuth, requirePermission("devices.manage"))

  .get("/devices", async (c) => {
    const actor = c.get("user")!;
    const clientIds = await scopedClientIds(actor.id, actor.role);
    const devices = await prisma.device.findMany({
      where: clientIds ? { clientId: { in: clientIds } } : undefined,
      include: {
        client: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
      orderBy: [{ status: "asc" }, { registeredAt: "desc" }],
    });
    // The fingerprint is deliberately not returned. It is the machine's half of
    // the registration check, and a list endpoint has no reason to hand it out.
    return c.json(devices.map(({ fingerprint: _fp, ...d }) => d));
  })

  /** Point a registered machine at the location it will mirror. */
  .put(
    "/devices/:id",
    zValidator("json", z.object({ name: z.string().trim().min(1).max(80).optional(), locationId: z.string().min(1).nullable().optional() })),
    async (c) => {
      const actor = c.get("user")!;
      const device = await ownedDevice(actor.id, actor.role, c.req.param("id"));
      const body = c.req.valid("json");

      if (body.locationId) {
        // The location must belong to the SAME client as the device, or a
        // desktop could be pointed at another establishment's books.
        const location = await prisma.location.findUnique({ where: { id: body.locationId } });
        if (!location || location.clientId !== device.clientId) {
          throw new AppError(404, "Location not found for this establishment");
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.device.update({
          where: { id: device.id },
          data: { name: body.name, locationId: body.locationId },
        });
        await logActivity(
          {
            user: actor,
            clientId: device.clientId,
            action: "device.update",
            entity: "Device",
            entityId: device.id,
            summary: `Updated device "${row.name}"`,
            details: { locationId: row.locationId },
          },
          tx,
        );
        return row;
      });
      const { fingerprint: _fp, ...safe } = updated;
      return c.json(safe);
    },
  )

  /**
   * Revoke a machine. Its sessions are deleted in the same transaction rather
   * than left to expire: a revoked device holding a year-long token until its
   * next request is exactly the window this endpoint exists to close.
   */
  .post("/devices/:id/revoke", zValidator("json", z.object({ reason: z.string().trim().min(3) })), async (c) => {
    const actor = c.get("user")!;
    const { reason } = c.req.valid("json");
    const device = await ownedDevice(actor.id, actor.role, c.req.param("id"));
    if (device.status !== "ACTIVE") throw new AppError(409, "Already revoked");

    const revoked = await prisma.$transaction(async (tx) => {
      const row = await tx.device.update({ where: { id: device.id }, data: { status: "REVOKED" } });
      await tx.authSession.deleteMany({ where: { deviceId: device.id } });
      await logActivity(
        {
          user: actor,
          clientId: device.clientId,
          action: "device.revoke",
          entity: "Device",
          entityId: device.id,
          summary: `Revoked device "${device.name}": ${reason}`,
          details: { lastSyncAt: device.lastSyncAt },
        },
        tx,
      );
      return row;
    });
    const { fingerprint: _fp, ...safe } = revoked;
    return c.json(safe);
  })

  /**
   * Bring a revoked machine back.
   *
   * Without this, revocation is a one-way door with a data-loss trap behind it.
   * The licence cap counts only ACTIVE devices, so when a bar PC dies the
   * registration error tells the admin to "revoke the old one" to free the slot
   * — and if that machine later boots with a week of unsynced counts in its
   * outbox, it can never authenticate again. The prescribed recovery action
   * would be the data-destroying one.
   *
   * Re-checks the licence cap, so this cannot be used to slip past `maxDevices`
   * by revoking and reactivating in a loop.
   */
  .post("/devices/:id/reactivate", zValidator("json", z.object({ reason: z.string().trim().min(3) })), async (c) => {
    const actor = c.get("user")!;
    const { reason } = c.req.valid("json");
    const device = await ownedDevice(actor.id, actor.role, c.req.param("id"));
    if (device.status === "ACTIVE") throw new AppError(409, "Already active");

    const subscription = await prisma.subscription.findUnique({ where: { clientId: device.clientId } });
    const cap = subscription?.maxDevices ?? 1;
    if (cap > 0) {
      const active = await prisma.device.count({ where: { clientId: device.clientId, status: "ACTIVE" } });
      if (active >= cap) {
        throw new AppError(
          409,
          `This establishment's licence covers ${cap} computer${cap === 1 ? "" : "s"}, and ${active} ${active === 1 ? "is" : "are"} already active. Revoke one first, or widen the licence.`,
        );
      }
    }

    const restored = await prisma.$transaction(async (tx) => {
      const row = await tx.device.update({ where: { id: device.id }, data: { status: "ACTIVE" } });
      await logActivity(
        {
          user: actor,
          clientId: device.clientId,
          action: "device.reactivate",
          entity: "Device",
          entityId: device.id,
          summary: `Reactivated device "${device.name}": ${reason}`,
          // The gap an admin needs to judge how much is still stranded on it.
          details: { lastSyncAt: device.lastSyncAt },
        },
        tx,
      );
      return row;
    });
    // Sessions were deleted at revoke, so the machine signs in again — which
    // re-registers nothing, because the fingerprint row already exists.
    const { fingerprint: _fp2, ...safe } = restored;
    return c.json(safe);
  });
