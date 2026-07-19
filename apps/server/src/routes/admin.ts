import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  role as roleSchema,
  derivePackageType,
  deriveAccessState,
  subscriptionCreateBody,
  subscriptionUpdateBody,
  locationModulesBody,
  moduleType,
  LOCATION_KINDS,
  type BillingCycle,
} from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { hashPassword } from "../auth/password";
import { logActivity } from "../services/activity";
import { requireAuth, requirePermission, type AppEnv } from "../middleware/auth";

// Billing-state derivation (deriveAccessState / currentPeriod / daysUntilDue)
// lives in @fnb/core/billing — one source of truth shared with the web client.

// ── Zod schemas ──────────────────────────────────────────────────────────────

const clientBody = z.object({ name: z.string().trim().min(1) });
const locationBody = z.object({ name: z.string().trim().min(1) });
// kind is a grouping label (main bar / satellite / stockroom) — display only.
const locationUpdateBody = z.object({
  name: z.string().trim().min(1).optional(),
  kind: z.enum(LOCATION_KINDS).nullable().optional(),
});

// One-shot "New client" creation: client + extra locations + subscription,
// all in a single transaction. The starter "Main" location is always added
// by the server (same as the plain /clients endpoint) — extraLocationNames
// are any additional locations entered in the same modal.
const fullClientBody = z.object({
  name: z.string().trim().min(1),
  extraLocationNames: z.array(z.string().trim().min(1)).default([]),
  // packageType is NOT accepted from the client — it's derived from
  // billingCycle + maxEntities (derivePackageType), so the tier badge can
  // never drift from the real subscription.
  subscription: subscriptionCreateBody.omit({ clientId: true }),
});
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
  // Per-user module restriction (client req #9): empty = unrestricted.
  modules: z.array(moduleType).default([]),
});
const userUpdateBody = z.object({
  role: roleSchema.optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  password: z.string().min(8).optional(),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  email: z.string().email().optional().or(z.literal("")),
  modules: z.array(moduleType).optional(),
});
const accessBody = z.object({ clientIds: z.array(z.string()) });

// Subscription/location-module request bodies come from @fnb/core
// (schemas/subscription.ts) — the same shapes the web client types against.
// The location-modules subset rule (Fix Plan §2.3) is enforced in the
// handler below since Prisma/SQLite can't express a cross-table constraint.

export const adminRoutes = new Hono<AppEnv>()
  .use(requireAuth, requirePermission("admin.manage"))

  // ── Clients & locations ────────────────────────────────────────────────────

  .get("/clients", async (c) => {
    const clients = await prisma.client.findMany({
      include: {
        locations: { include: { modules: true } },
        access: { include: { user: true } },
        subscription: { include: { modules: true } },
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

  .put(
    "/clients/:id",
    zValidator("json", clientBody.extend({ status: z.enum(["ACTIVE", "ARCHIVED"]).optional() })),
    async (c) => {
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
    },
  )

  .post("/clients/:id/locations", zValidator("json", locationBody), async (c) => {
    const clientId = c.req.param("id");
    const { name } = c.req.valid("json");
    const user = c.get("user")!;

    // Enforce entity limit from subscription
    const subscription = await prisma.subscription.findUnique({
      where: { clientId },
      include: { modules: true },
    });
    if (subscription && subscription.maxEntities > 0) {
      const locationCount = await prisma.location.count({ where: { clientId, status: "ACTIVE" } });
      if (locationCount >= subscription.maxEntities) {
        throw new AppError(
          403,
          `Location limit reached. This subscription allows up to ${subscription.maxEntities} location(s). Raise "Max locations" on the subscription to add more.`,
        );
      }
    }

    const location = await prisma.$transaction(async (tx) => {
      const created = await tx.location.create({
        data: {
          clientId,
          name,
          // New locations start with the client's whole module ceiling
          // assigned (Fix Plan §2.3 default) — an admin can narrow this
          // afterwards via PUT /locations/:id/modules, e.g. to split a
          // multi-module client into one-module-per-location.
          modules: subscription ? { create: subscription.modules.map((m) => ({ module: m.module })) } : undefined,
        },
        include: { modules: true },
      });
      await logActivity(
        { user, clientId, locationId: created.id, action: "location.create", entity: "Location", entityId: created.id, summary: `Added location "${name}"` },
        tx,
      );
      return created;
    });
    return c.json(location, 201);
  })

  // Rename / relabel a single location (kind = main/satellite/stockroom tag).
  .put("/locations/:id", zValidator("json", locationUpdateBody), async (c) => {
    const locationId = c.req.param("id");
    const body = c.req.valid("json");
    const user = c.get("user")!;
    const location = await prisma.location.findUnique({ where: { id: locationId } });
    if (!location) throw new AppError(404, "Location not found");
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.location.update({ where: { id: locationId }, data: body, include: { modules: true } });
      await logActivity(
        {
          user,
          clientId: location.clientId,
          locationId,
          action: "location.update",
          entity: "Location",
          entityId: locationId,
          summary: `Updated location "${u.name}"${body.kind !== undefined ? ` (kind: ${body.kind ?? "none"})` : ""}`,
          details: body,
        },
        tx,
      );
      return u;
    });
    return c.json(updated);
  })

  // Sets a single location's OWN module set — the enforced reality per Fix
  // Plan §2.3. Must be a non-empty subset of the client's current
  // SubscriptionModule ceiling; this is the one place that boundary is
  // actually checked (the DB itself can't express a cross-table subset).
  .put("/locations/:id/modules", zValidator("json", locationModulesBody), async (c) => {
    const locationId = c.req.param("id");
    const { modules } = c.req.valid("json");
    const user = c.get("user")!;

    const location = await prisma.location.findUnique({
      where: { id: locationId },
      include: { client: { include: { subscription: { include: { modules: true } } } }, modules: true },
    });
    if (!location) throw new AppError(404, "Location not found");

    const ceiling = new Set((location.client.subscription?.modules ?? []).map((m) => m.module));
    const outside = modules.filter((m) => !ceiling.has(m));
    if (outside.length > 0) {
      throw new AppError(
        403,
        `${outside.join(", ")} ${outside.length === 1 ? "isn't" : "aren't"} in this client's subscription. ` +
          `Add ${outside.length === 1 ? "it" : "them"} to the subscription first, then assign it to this location.`,
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.locationModule.deleteMany({ where: { locationId } });
      await tx.locationModule.createMany({ data: modules.map((module) => ({ locationId, module })) });
      const u = await tx.location.findUniqueOrThrow({ where: { id: locationId }, include: { modules: true } });
      await logActivity(
        {
          user,
          clientId: location.clientId,
          locationId,
          action: "location.modulesUpdate",
          entity: "Location",
          entityId: locationId,
          summary: `Set "${location.name}" modules to [${modules.join(", ")}]`,
          details: { old: location.modules.map((m) => m.module), new: modules },
        },
        tx,
      );
      return u;
    });
    return c.json(updated);
  })

  // One-shot creation used by the "New client" modal: client + starter
  // "Main" location + any extra locations + a subscription, all atomic.
  // If anything fails (e.g. duplicate, validation), nothing is created.
  .post("/clients/full", zValidator("json", fullClientBody), async (c) => {
    const { name, extraLocationNames, subscription } = c.req.valid("json");
    const user = c.get("user")!;
    const maxEntities = subscription.maxEntities;

    // Guard against exceeding the chosen maxEntities within the same request
    // (Main + extras), same rule /locations enforces.
    const totalLocations = 1 + extraLocationNames.length;
    if (maxEntities > 0 && totalLocations > maxEntities) {
      throw new AppError(
        403,
        `Too many locations for this subscription. It allows up to ${maxEntities} location(s).`,
      );
    }

    const client = await prisma.$transaction(async (tx) => {
      const created = await tx.client.create({ data: { name } });

      const sub = await tx.subscription.create({
        data: {
          clientId: created.id,
          packageType: derivePackageType(subscription.billingCycle, maxEntities),
          billingCycle: subscription.billingCycle,
          maxEntities,
          negotiatedPrice: subscription.negotiatedPrice ?? null,
          startDate: subscription.startDate,
          endDate: subscription.endDate ?? null,
          note: subscription.note ?? null,
          createdById: user.id,
          status: "ACTIVE",
          paid: false,
          lastPaidAt: null,
          modules: { create: subscription.modules.map((module) => ({ module })) },
        },
      });

      // Every location starts with the client's whole module ceiling
      // assigned by default (Fix Plan §2.3) — admins can split them apart
      // afterwards (e.g. one module per location) via PUT /locations/:id/modules.
      const locationModulesData = subscription.modules.map((module) => ({ module }));
      await tx.location.create({
        data: { clientId: created.id, name: "Main", modules: { create: locationModulesData } },
      });
      for (const locName of extraLocationNames) {
        await tx.location.create({
          data: { clientId: created.id, name: locName, modules: { create: locationModulesData } },
        });
      }
      await logActivity(
        { user, clientId: created.id, action: "client.create", entity: "Client", entityId: created.id, summary: `Created client "${name}"` },
        tx,
      );
      await logActivity(
        {
          user,
          clientId: created.id,
          action: "subscription.create",
          entity: "Subscription",
          entityId: sub.id,
          summary: `Created ${sub.packageType} subscription for client "${name}"`,
          details: subscription,
        },
        tx,
      );

      return tx.client.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          locations: { include: { modules: true } },
          access: { include: { user: true } },
          subscription: { include: { modules: true } },
        },
      });
    });

    return c.json(client, 201);
  })

  // ── Users ──────────────────────────────────────────────────────────────────

  .get("/users", async (c) => {
    const users = await prisma.user.findMany({
      select: {
        id: true, username: true, firstName: true, lastName: true, email: true,
        role: true, status: true, createdAt: true,
        modules: { select: { module: true } },
        clientAccess: {
          include: {
            client: {
              select: {
                id: true,
                name: true,
                subscription: {
                  select: {
                    packageType: true,
                    billingCycle: true,
                    status: true,
                    modules: { select: { module: true } },
                  },
                },
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
          modules: { create: body.modules.map((module) => ({ module })) },
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
    delete data.modules;
    if (body.password) data.passwordHash = await hashPassword(body.password);
    if (body.email === "") data.email = null;
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id }, data });
      if (body.modules !== undefined) {
        await tx.userModule.deleteMany({ where: { userId: id } });
        await tx.userModule.createMany({ data: body.modules.map((module) => ({ userId: id, module })) });
      }
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

  // ── Subscriptions ──────────────────────────────────────────────────────────
  // The separate /subscriptions list page is gone — subscription management
  // now lives inside the Clients page (edit dialog per client). These CRUD
  // endpoints remain; the list endpoint is kept for completeness / future use.

  .get("/subscriptions", async (c) => {
    const subs = await prisma.subscription.findMany({
      include: { client: { select: { id: true, name: true, status: true } }, modules: true },
      orderBy: { createdAt: "desc" },
    });
    return c.json(subs);
  })

  .post("/subscriptions", zValidator("json", subscriptionCreateBody), async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user")!;

    const existing = await prisma.subscription.findUnique({ where: { clientId: body.clientId } });
    if (existing) throw new AppError(409, "This client already has a subscription. Update it instead.");

    const sub = await prisma.$transaction(async (tx) => {
      const created = await tx.subscription.create({
        data: {
          clientId: body.clientId,
          packageType: derivePackageType(body.billingCycle, body.maxEntities),
          billingCycle: body.billingCycle,
          maxEntities: body.maxEntities,
          negotiatedPrice: body.negotiatedPrice ?? null,
          startDate: body.startDate,
          endDate: body.endDate ?? null,
          note: body.note ?? null,
          createdById: user.id,
          status: "ACTIVE",
          paid: false,
          lastPaidAt: null,
          modules: { create: body.modules.map((module) => ({ module })) },
        },
        include: { client: { select: { id: true, name: true } }, modules: true },
      });
      await logActivity(
        {
          user,
          clientId: body.clientId,
          action: "subscription.create",
          entity: "Subscription",
          entityId: created.id,
          summary: `Created ${created.packageType} subscription for client "${created.client.name}"`,
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
    const { modules, ...rest } = body;

    const data: Record<string, unknown> = { ...rest };
    if (body.endDate === null) data.endDate = null;

    const updated = await prisma.$transaction(async (tx) => {
      // Fetch the current row first so packageType can be recomputed from
      // whichever of billingCycle/maxEntities actually changed, merged with
      // whichever didn't (both are optional on a partial update) — this is
      // the one write path where the tier could otherwise go stale.
      const existing = await tx.subscription.findUniqueOrThrow({ where: { id } });
      const effectiveBillingCycle = body.billingCycle ?? existing.billingCycle;
      const effectiveMaxEntities = body.maxEntities ?? existing.maxEntities;
      data.packageType = derivePackageType(effectiveBillingCycle as BillingCycle, effectiveMaxEntities);

      // Moving the startDate re-anchors every billing period, and the
      // first-period rule would otherwise re-credit an arbitrarily old
      // payment ("contract restart" showing ACTIVE off a January mark-paid).
      // A new anchor means the current period is unpaid until someone
      // explicitly records the payment again — audited, like every payment.
      if (body.startDate !== undefined && body.startDate !== existing.startDate) {
        data.paid = false;
        data.lastPaidAt = null;
      }

      if (modules) {
        // Narrowing the ceiling must not silently leave a location holding a
        // module its client is no longer licensed for (Fix Plan §2.3: the
        // location's set must stay a subset of the subscription's). Any
        // LocationModule row outside the new set is dropped along with it —
        // narrower is safe to cascade; widening never removes anything.
        const dropped = await tx.subscriptionModule.findMany({
          where: { subscriptionId: id, module: { notIn: modules } },
        });
        if (dropped.length > 0) {
          await tx.locationModule.deleteMany({
            where: {
              module: { in: dropped.map((d) => d.module) },
              location: { clientId: existing.clientId },
            },
          });
        }
        await tx.subscriptionModule.deleteMany({ where: { subscriptionId: id } });
        await tx.subscriptionModule.createMany({ data: modules.map((module) => ({ subscriptionId: id, module })) });
      }

      const u = await tx.subscription.update({
        where: { id },
        data,
        include: { client: { select: { id: true, name: true } }, modules: true },
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

  // ── Subscription payment actions ───────────────────────────────────────────
  // Three explicit, auditable actions — not buried in a generic PATCH.

  .post("/subscriptions/:id/mark-paid", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user")!;

    const updated = await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { id },
        include: { client: { select: { id: true, name: true } } },
      });
      if (!sub) throw new AppError(404, "Subscription not found");
      if (sub.status === "CANCELLED" || sub.status === "SUSPENDED") {
        throw new AppError(409, `This subscription is ${sub.status.toLowerCase()} — reactivate it before recording a payment.`);
      }

      const u = await tx.subscription.update({
        where: { id },
        data: { paid: true, lastPaidAt: new Date() },
        include: { client: { select: { id: true, name: true } } },
      });
      await logActivity(
        {
          user,
          clientId: sub.clientId,
          action: "subscription.markPaid",
          entity: "Subscription",
          entityId: id,
          summary: `Marked subscription as paid for "${sub.client.name}"`,
        },
        tx,
      );
      return u;
    });
    return c.json(updated);
  })

  .post("/subscriptions/:id/unmark-paid", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user")!;

    const updated = await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { id },
        include: { client: { select: { id: true, name: true } } },
      });
      if (!sub) throw new AppError(404, "Subscription not found");
      if (sub.status === "CANCELLED") {
        throw new AppError(409, "This subscription is cancelled — its payment record is frozen.");
      }

      const u = await tx.subscription.update({
        where: { id },
        data: { paid: false, lastPaidAt: null },
        include: { client: { select: { id: true, name: true } } },
      });
      await logActivity(
        {
          user,
          clientId: sub.clientId,
          action: "subscription.unmarkPaid",
          entity: "Subscription",
          entityId: id,
          summary: `Unmarked payment for "${sub.client.name}" (reversed mark-paid)`,
        },
        tx,
      );
      return u;
    });
    return c.json(updated);
  })

  .post("/subscriptions/:id/cancel", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user")!;

    const updated = await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { id },
        include: { client: { select: { id: true, name: true } } },
      });
      if (!sub) throw new AppError(404, "Subscription not found");
      if (sub.status === "CANCELLED") throw new AppError(409, "Already cancelled");

      const u = await tx.subscription.update({
        where: { id },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: user.id },
        include: { client: { select: { id: true, name: true } } },
      });
      await logActivity(
        {
          user,
          clientId: sub.clientId,
          action: "subscription.cancel",
          entity: "Subscription",
          entityId: id,
          summary: `Cancelled subscription for "${sub.client.name}"`,
        },
        tx,
      );
      return u;
    });
    return c.json(updated);
  })

  // Closes the cancel loop: a churned client who re-signs gets the SAME
  // subscription row back (clientId is unique — a replacement row can't be
  // created), reactivated explicitly and audibly. Payment state resets so the
  // new engagement starts unpaid.
  .post("/subscriptions/:id/reactivate", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user")!;

    const updated = await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { id },
        include: { client: { select: { id: true, name: true } } },
      });
      if (!sub) throw new AppError(404, "Subscription not found");
      if (sub.status === "ACTIVE") throw new AppError(409, "Already active");

      const u = await tx.subscription.update({
        where: { id },
        data: { status: "ACTIVE", cancelledAt: null, cancelledById: null, paid: false, lastPaidAt: null },
        include: { client: { select: { id: true, name: true } } },
      });
      await logActivity(
        {
          user,
          clientId: sub.clientId,
          action: "subscription.reactivate",
          entity: "Subscription",
          entityId: id,
          summary: `Reactivated subscription for "${sub.client.name}" (payment state reset)`,
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
    const accessState = deriveAccessState(sub, new Date());
    return c.json({ hasSubscription: true, subscription: sub, locationCount, canAddEntity, accessState });
  });