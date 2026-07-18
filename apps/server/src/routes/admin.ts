import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  role as roleSchema,
  derivePackageType,
  BILLING_CYCLES,
  MODULE_TYPES,
  SUBSCRIPTION_STATUSES,
} from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { hashPassword } from "../auth/password";
import { logActivity } from "../services/activity";
import { requireAuth, requirePermission, type AppEnv } from "../middleware/auth";

// ── Billing helpers (compute-on-load; no background job needed) ──────────────

/**
 * Given a subscription's startDate anchor and "today", compute the due date
 * for the current billing month.
 *
 * Rule: pin to the same day-of-month as startDate. If the target month is
 * shorter than that day (e.g. started on the 31st, now in February), roll
 * over to the 1st of the following month.
 */
function currentDueDate(startDate: string, now: Date): Date {
  const anchor = new Date(startDate + "T00:00:00Z");
  const anchorDay = anchor.getUTCDate();

  // Try pinning anchorDay into the current month
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based

  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (anchorDay <= daysInMonth) {
    return new Date(Date.UTC(year, month, anchorDay));
  }
  // Roll over: 1st of next month
  return new Date(Date.UTC(year, month + 1, 1));
}

/**
 * Derived effective access state for a monthly subscription.
 * Returns one of: "ACTIVE" | "GRACE" | "VIEW_ONLY"
 *
 * "GRACE"     = unpaid but within 7-day window after due date
 * "VIEW_ONLY" = unpaid and more than 7 days past due date
 *
 * For ONE_TIME (STANDALONE) subs, paid just needs to be true once — returns
 * "ACTIVE" if paid, "GRACE" otherwise (no time pressure).
 *
 * Manual status overrides (CANCELLED, SUSPENDED) are respected by callers
 * before consulting this function.
 */
export function deriveAccessState(sub: {
  billingCycle: string;
  paid: boolean;
  lastPaidAt: Date | null;
  startDate: string;
}): "ACTIVE" | "GRACE" | "VIEW_ONLY" {
  const now = new Date();

  if (sub.billingCycle !== "MONTHLY") {
    // ONE_TIME / STANDALONE — pay once, access forever once paid
    return sub.paid ? "ACTIVE" : "GRACE";
  }

  // Monthly — compute current period
  const due = currentDueDate(sub.startDate, now);
  const periodStart = new Date(due);
  periodStart.setUTCMonth(periodStart.getUTCMonth() - 1);

  const paidInPeriod =
    sub.paid &&
    sub.lastPaidAt !== null &&
    sub.lastPaidAt >= periodStart &&
    sub.lastPaidAt <= due;

  if (paidInPeriod) return "ACTIVE";

  const msOverdue = now.getTime() - due.getTime();
  const daysOverdue = msOverdue / (1000 * 60 * 60 * 24);

  if (daysOverdue <= 7) return "GRACE";
  return "VIEW_ONLY";
}

// ── Zod schemas ──────────────────────────────────────────────────────────────

const clientBody = z.object({ name: z.string().trim().min(1) });
const locationBody = z.object({ name: z.string().trim().min(1) });

// One-shot "New client" creation: client + extra locations + subscription,
// all in a single transaction. The starter "Main" location is always added
// by the server (same as the plain /clients endpoint) — extraLocationNames
// are any additional locations entered in the same modal.
const fullClientBody = z.object({
  name: z.string().trim().min(1),
  extraLocationNames: z.array(z.string().trim().min(1)).default([]),
  subscription: z.object({
    // packageType is NOT accepted from the client — it's derived from
    // billingCycle + maxEntities below (derivePackageType), so the tier
    // badge can never drift from the real subscription.
    billingCycle: z.enum(BILLING_CYCLES),
    modules: z.array(z.enum(MODULE_TYPES)).min(1, "Select at least one module"),
    maxEntities: z.number().int().min(0), // 0 = unlimited
    negotiatedPrice: z.number().min(0).optional().nullable(), // per-client deal price, if tracked at all
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    note: z.string().optional().nullable(),
  }),
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

// Subscription schemas
const subscriptionCreateBody = z.object({
  clientId: z.string().min(1),
  // packageType is NOT accepted from the client — derived server-side, see
  // derivePackageType() usage below.
  billingCycle: z.enum(BILLING_CYCLES),
  modules: z.array(z.enum(MODULE_TYPES)).min(1, "Select at least one module"),
  maxEntities: z.number().int().min(0), // 0 = unlimited
  negotiatedPrice: z.number().min(0).optional().nullable(), // per-client deal price, if tracked at all
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  note: z.string().optional().nullable(),
});
const subscriptionUpdateBody = z.object({
  // packageType is NOT accepted from the client — see subscriptionCreateBody above.
  billingCycle: z.enum(BILLING_CYCLES).optional(),
  modules: z.array(z.enum(MODULE_TYPES)).min(1, "Select at least one module").optional(),
  maxEntities: z.number().int().min(0).optional(), // 0 = unlimited; no longer recalculated from packageType
  negotiatedPrice: z.number().min(0).optional().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  note: z.string().optional().nullable(),
});

// A location's own module set (Fix Plan §2.3) — must be a non-empty subset
// of its client's current SubscriptionModule ceiling; enforced in the
// handler below since Prisma/SQLite can't express a cross-table constraint.
const locationModulesBody = z.object({
  modules: z.array(z.enum(MODULE_TYPES)).min(1, "Select at least one module"),
});

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
      data.packageType = derivePackageType(effectiveBillingCycle as (typeof BILLING_CYCLES)[number], effectiveMaxEntities);

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

  .get("/subscriptions/:clientId/check", async (c) => {
    const clientId = c.req.param("clientId");
    const sub = await prisma.subscription.findUnique({ where: { clientId } });
    if (!sub) return c.json({ hasSubscription: false, canAddEntity: true });
    const locationCount = await prisma.location.count({ where: { clientId, status: "ACTIVE" } });
    const canAddEntity = sub.maxEntities === 0 || locationCount < sub.maxEntities;
    const accessState = deriveAccessState(sub);
    return c.json({ hasSubscription: true, subscription: sub, locationCount, canAddEntity, accessState });
  });