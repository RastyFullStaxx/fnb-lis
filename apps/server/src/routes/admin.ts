import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  role as roleSchema,
  PACKAGE_TYPES,
  BILLING_CYCLES,
  INVENTORY_MODULES,
  SUBSCRIPTION_STATUSES,
  PACKAGE_MAX_ENTITIES,
} from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { hashPassword } from "../auth/password";
import { logActivity } from "../services/activity";
import { requireAuth, requirePermission, type AppEnv } from "../middleware/auth";

const clientBody = z.object({ name: z.string().trim().min(1) });
const locationBody = z.object({ name: z.string().trim().min(1) });
const userCreateBody = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .regex(/^[a-z0-9_.-]+$/, "Letters, numbers, dots, dashes, underscores only"),
  password: z.string().min(8, "At least 8 characters"),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().email().optional().or(z.literal("")),
  role: roleSchema,
  clientIds: z.array(z.string()).default([]),
});
const userUpdateBody = z.object({
  role: roleSchema.optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  password: z.string().min(8).optional(),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  email: z.string().email().optional().or(z.literal("")),
});
const accessBody = z.object({ clientIds: z.array(z.string()) });

// ── Subscription schemas ──
const subscriptionCreateBody = z.object({
  clientId: z.string().min(1),
  packageType: z.enum(PACKAGE_TYPES),
  billingCycle: z.enum(BILLING_CYCLES),
  inventoryModules: z.enum(INVENTORY_MODULES),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  note: z.string().optional().nullable(),
});
const subscriptionUpdateBody = z.object({
  packageType: z.enum(PACKAGE_TYPES).optional(),
  billingCycle: z.enum(BILLING_CYCLES).optional(),
  inventoryModules: z.enum(INVENTORY_MODULES).optional(),
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  note: z.string().optional().nullable(),
});

export const adminRoutes = new Hono<AppEnv>()
  .use(requireAuth, requirePermission("admin.manage"))

  // ── Clients & locations ──
  .get("/clients", async (c) => {
    const clients = await prisma.client.findMany({
      include: {
        locations: true,
        access: { include: { user: true } },
        subscription: true,
      },
      orderBy: { name: "asc" },
    });
    return c.json(clients);
  })
  .post("/clients", zValidator("json", clientBody), async (c) => {
    const { name } = c.req.valid("json");
    const user = c.get("user")!;
    const client = await prisma.$transaction(async (tx) => {
      const created = await tx.client.create({ data: { name } });
      await tx.location.create({ data: { clientId: created.id, name: "Main" } });
      await logActivity(
        { user, clientId: created.id, action: "client.create", entity: "Client", entityId: created.id, summary: `Created client "${name}"` },
        tx,
      );
      return created;
    });
    return c.json(client, 201);
  })
  .put("/clients/:id", zValidator("json", clientBody.extend({ status: z.enum(["ACTIVE", "ARCHIVED"]).optional() })), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const user = c.get("user")!;
    const client = await prisma.$transaction(async (tx) => {
      const updated = await tx.client.update({ where: { id }, data: body });
      await logActivity(
        { user, clientId: id, action: "client.update", entity: "Client", entityId: id, summary: `Updated client "${updated.name}"`, details: body },
        tx,
      );
      return updated;
    });
    return c.json(client);
  })
  .post("/clients/:id/locations", zValidator("json", locationBody), async (c) => {
    const clientId = c.req.param("id");
    const { name } = c.req.valid("json");
    const user = c.get("user")!;

    // Enforce entity limit from subscription
    const subscription = await prisma.subscription.findUnique({ where: { clientId } });
    if (subscription && subscription.maxEntities > 0) {
      const locationCount = await prisma.location.count({ where: { clientId, status: "ACTIVE" } });
      if (locationCount >= subscription.maxEntities) {
        throw new AppError(
          403,
          `Package limit reached. Your ${subscription.packageType} package allows up to ${subscription.maxEntities} location(s). Please upgrade to add more.`,
        );
      }
    }

    const location = await prisma.$transaction(async (tx) => {
      const created = await tx.location.create({ data: { clientId, name } });
      await logActivity(
        { user, clientId, locationId: created.id, action: "location.create", entity: "Location", entityId: created.id, summary: `Added location "${name}"` },
        tx,
      );
      return created;
    });
    return c.json(location, 201);
  })

  // ── Users ──
  .get("/users", async (c) => {
    const users = await prisma.user.findMany({
      select: {
        id: true, username: true, firstName: true, lastName: true, email: true,
        role: true, status: true, createdAt: true,
        clientAccess: {
          include: {
            client: {
              select: {
                id: true,
                name: true,
                subscription: { select: { packageType: true, billingCycle: true, inventoryModules: true, status: true } },
              },
            },
          },
        },
      },
      orderBy: { username: "asc" },
    });
    return c.json(users);
  })
  .post("/users", zValidator("json", userCreateBody), async (c) => {
    const body = c.req.valid("json");
    const actor = c.get("user")!;
    const existing = await prisma.user.findUnique({ where: { username: body.username } });
    if (existing) throw new AppError(409, "Username already taken");
    const passwordHash = await hashPassword(body.password);
    const created = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          username: body.username,
          passwordHash,
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email || null,
          role: body.role,
          clientAccess: { create: body.clientIds.map((clientId) => ({ clientId })) },
        },
      });
      await logActivity(
        { user: actor, action: "user.create", entity: "User", entityId: u.id, summary: `Created user ${u.username} (${u.role})` },
        tx,
      );
      return u;
    });
    const { passwordHash: _omit, ...safe } = created;
    return c.json(safe, 201);
  })
  .put("/users/:id", zValidator("json", userUpdateBody), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const actor = c.get("user")!;
    const data: Record<string, unknown> = { ...body };
    delete data.password;
    if (body.password) data.passwordHash = await hashPassword(body.password);
    if (body.email === "") data.email = null;
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id }, data });
      await logActivity(
        {
          user: actor, action: "user.update", entity: "User", entityId: id,
          summary: `Updated user ${u.username}`,
          details: { ...body, password: body.password ? "(reset)" : undefined },
        },
        tx,
      );
      return u;
    });
    const { passwordHash: _omit, ...safe } = updated;
    return c.json(safe);
  })
  .put("/users/:id/access", zValidator("json", accessBody), async (c) => {
    const userId = c.req.param("id");
    const { clientIds } = c.req.valid("json");
    const actor = c.get("user")!;
    await prisma.$transaction(async (tx) => {
      await tx.userClientAccess.deleteMany({ where: { userId } });
      await tx.userClientAccess.createMany({ data: clientIds.map((clientId) => ({ userId, clientId })) });
      await logActivity(
        { user: actor, action: "user.access", entity: "User", entityId: userId, summary: "Updated client assignments", details: { clientIds } },
        tx,
      );
    });
    return c.json({ ok: true });
  })

  // ── Subscriptions ──
  .get("/subscriptions", async (c) => {
    const subs = await prisma.subscription.findMany({
      include: { client: { select: { id: true, name: true, status: true } } },
      orderBy: { createdAt: "desc" },
    });
    return c.json(subs);
  })
  .post("/subscriptions", zValidator("json", subscriptionCreateBody), async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user")!;

    const existing = await prisma.subscription.findUnique({ where: { clientId: body.clientId } });
    if (existing) throw new AppError(409, "This client already has a subscription. Update it instead.");

    const maxEntities = PACKAGE_MAX_ENTITIES[body.packageType as keyof typeof PACKAGE_MAX_ENTITIES];

    const sub = await prisma.$transaction(async (tx) => {
      const created = await tx.subscription.create({
        data: {
          clientId: body.clientId,
          packageType: body.packageType,
          billingCycle: body.billingCycle,
          inventoryModules: body.inventoryModules,
          maxEntities,
          startDate: body.startDate,
          endDate: body.endDate ?? null,
          note: body.note ?? null,
          createdById: user.id,
          status: "ACTIVE",
        },
        include: { client: { select: { id: true, name: true } } },
      });
      await logActivity(
        {
          user,
          clientId: body.clientId,
          action: "subscription.create",
          entity: "Subscription",
          entityId: created.id,
          summary: `Created ${body.packageType} subscription for client "${created.client.name}"`,
          details: body,
        },
        tx,
      );
      return created;
    });
    return c.json(sub, 201);
  })
  .put("/subscriptions/:id", zValidator("json", subscriptionUpdateBody), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const user = c.get("user")!;

    const data: Record<string, unknown> = { ...body };

    // Recalculate maxEntities if packageType changes
    if (body.packageType) {
      data.maxEntities = PACKAGE_MAX_ENTITIES[body.packageType as keyof typeof PACKAGE_MAX_ENTITIES];
    }
    if (body.endDate === null) data.endDate = null;

    // Handle cancellation timestamp
    if (body.status === "CANCELLED") {
      data.cancelledAt = new Date();
      data.cancelledById = user.id;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.subscription.update({
        where: { id },
        data,
        include: { client: { select: { id: true, name: true } } },
      });
      await logActivity(
        {
          user,
          clientId: u.clientId,
          action: "subscription.update",
          entity: "Subscription",
          entityId: id,
          summary: `Updated subscription for "${u.client.name}"`,
          details: body,
        },
        tx,
      );
      return u;
    });
    return c.json(updated);
  })
  .get("/subscriptions/:clientId/check", async (c) => {
    const clientId = c.req.param("clientId");
    const sub = await prisma.subscription.findUnique({ where: { clientId } });
    if (!sub) return c.json({ hasSubscription: false, canAddEntity: true });
    const locationCount = await prisma.location.count({ where: { clientId, status: "ACTIVE" } });
    const canAddEntity = sub.maxEntities === 0 || locationCount < sub.maxEntities;
    return c.json({ hasSubscription: true, subscription: sub, locationCount, canAddEntity });
  });
