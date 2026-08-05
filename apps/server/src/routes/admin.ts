import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "../lib/validate";
import {
  role as roleSchema,
  derivePackageType,
  deriveAccessState,
  subscriptionCreateBody,
  subscriptionUpdateBody,
  locationModulesBody,
  subscriptionReportsBody,
  moduleType,
  LOCATION_KINDS,
  OWNER_ASSIGNABLE_ROLES,
  voidRequest,
  REPORT_TIER_PRESETS,
  type BillingCycle,
} from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { hashPassword } from "../auth/password";
import { breachCount, breachMessage } from "../auth/breached";
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
  // billingCycle + maxEntities + maxUsers (derivePackageType), so the tier
  // badge can never drift from the real subscription.
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

/**
 * Max-user seat check (client req 2026-07-21). Every client the new user would
 * be granted access to must still have a free seat. `maxUsers = 0` means no cap
 * saved (legacy rows / owner hasn't set one), so it never blocks.
 *
 * Counts UserClientAccess rows — the same thing the client's user list shows.
 * ADMINs bypass client scoping entirely and hold no access rows, so they don't
 * consume a client's seats.
 */
/**
 * Refuse a password that is already in a public breach corpus.
 *
 * Applied at both places a password is set — creation and reset — because this
 * app has no self-service change: an ADMIN types every password on somebody
 * else's behalf, so one person's habits set the floor for the whole
 * establishment.
 *
 * The candidate never leaves the process (k-anonymity — see auth/breached.ts),
 * and the check fails OPEN if the range API is unreachable, so a third-party
 * outage can never block account creation or an urgent password rotation.
 *
 * Deliberately NOT paired with composition rules. NIST SP 800-63B recommends
 * exactly this check and recommends AGAINST "must contain a symbol", which
 * merely produces `Password1!` — a string that is itself in every corpus.
 */
async function assertPasswordNotBreached(password: string): Promise<void> {
  const count = await breachCount(password);
  if (count > 0) throw new AppError(400, breachMessage(count), "PASSWORD_BREACHED");
}

async function assertUserSeatsAvailable(clientIds: string[], exceptUserId?: string): Promise<void> {
  for (const clientId of clientIds) {
    const sub = await prisma.subscription.findUnique({
      where: { clientId },
      select: { maxUsers: true, client: { select: { name: true } } },
    });
    if (!sub || sub.maxUsers <= 0) continue;
    // Only ACTIVE accounts hold a seat: when an employee resigns the owner
    // disables them, and that seat must free up so a replacement can be hired
    // (client req 2026-07-25). Exclude the user being edited too — re-saving
    // their existing access must not count them against their own seat.
    const used = await prisma.userClientAccess.count({
      where: {
        clientId,
        user: { status: "ACTIVE" },
        ...(exceptUserId ? { userId: { not: exceptUserId } } : {}),
      },
    });
    if (used >= sub.maxUsers) {
      throw new AppError(
        403,
        `User limit reached for "${sub.client.name}". This subscription allows up to ${sub.maxUsers} user account(s). Raise "Max users" on the subscription to add more.`,
      );
    }
  }
}

/**
 * The only User columns an admin screen needs beside a client. `include: { user: true }`
 * shipped the whole row — every `passwordHash` (scrypt digests for all 9 accounts),
 * plus emails and lockout counters — to the browser on every Admin → Clients load.
 * A projection, so adding a column to User can never silently re-open this.
 */
const CLIENT_ACCESS_USER_FIELDS = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
} as const;

export const adminRoutes = new Hono<AppEnv>()
  // Path-scoped rather than a blanket `.use()`: userAdminRoutes mounts on this
  // same /api/admin prefix with the softer `users.manage` guard, and a wildcard
  // here would 403 those requests before they ever reach it.
  .use("/clients", requireAuth, requirePermission("admin.manage"))
  .use("/clients/*", requireAuth, requirePermission("admin.manage"))
  .use("/locations/*", requireAuth, requirePermission("admin.manage"))
  .use("/subscriptions", requireAuth, requirePermission("admin.manage"))
  .use("/subscriptions/*", requireAuth, requirePermission("admin.manage"))

  // ── Clients & locations ────────────────────────────────────────────────────

  .get("/clients", async (c) => {
    const clients = await prisma.client.findMany({
      include: {
        locations: { include: { modules: true } },
        access: { include: { user: { select: CLIENT_ACCESS_USER_FIELDS } } },
        // reports: true feeds the SubscriptionReportsDialog's currentSlugs
        // (Phase 5.3.3/5.3.4, client-form-fields.tsx) — without it the admin
        // client list would 404's own precondition (no rows to diff against)
        // rather than showing the client's actual saved report set.
        subscription: { include: { modules: true, reports: true } },
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
    zValidator(
      "json",
      clientBody.extend({
        status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
        // Client req 2026-07-28 — view reports without being able to take them
        // out of the system. ADMIN-only: this whole router is admin.manage.
        allowReportDownloads: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const id = c.req.param("id");
      const body = c.req.valid("json");
      const user = c.get("user")!;
      const client = await prisma.$transaction(async (tx) => {
        const updated = await tx.client.update({ where: { id }, data: body });
        await logActivity(
          { user, clientId: id, action: "client.update", entity: "Client", entityId: id, summary:
              body.allowReportDownloads === undefined
                ? `Updated client "${updated.name}"`
                : `Report downloads ${body.allowReportDownloads ? "enabled" : "disabled"} for "${updated.name}"`,
            details: body,
          },
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

      const packageType = derivePackageType(subscription.billingCycle, maxEntities, subscription.maxUsers);
      const sub = await tx.subscription.create({
        data: {
          clientId: created.id,
          packageType,
          billingCycle: subscription.billingCycle,
          maxEntities,
          maxUsers: subscription.maxUsers,
          negotiatedPrice: subscription.negotiatedPrice ?? null,
          startDate: subscription.startDate,
          endDate: subscription.endDate ?? null,
          note: subscription.note ?? null,
          createdById: user.id,
          status: "ACTIVE",
          paid: false,
          lastPaidAt: null,
          modules: { create: subscription.modules.map((module) => ({ module })) },
          // Seed the tier's default enabled reports at creation time only
          // (docs/2026-08-04-report-tier-gating-phases.md 5.1). A later tier
          // change never re-seeds this — see 5.4 / the PUT route below.
          reports: { create: REPORT_TIER_PRESETS[packageType].map((reportSlug) => ({ reportSlug })) },
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
          access: { include: { user: { select: CLIENT_ACCESS_USER_FIELDS } } },
          subscription: { include: { modules: true, reports: true } },
        },
      });
    });

    return c.json(client, 201);
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
      const packageType = derivePackageType(body.billingCycle, body.maxEntities, body.maxUsers);
      const created = await tx.subscription.create({
        data: {
          clientId: body.clientId,
          packageType,
          billingCycle: body.billingCycle,
          maxEntities: body.maxEntities,
          maxUsers: body.maxUsers,
          maxDevices: body.maxDevices,
          negotiatedPrice: body.negotiatedPrice ?? null,
          startDate: body.startDate,
          endDate: body.endDate ?? null,
          note: body.note ?? null,
          createdById: user.id,
          status: "ACTIVE",
          paid: false,
          lastPaidAt: null,
          modules: { create: body.modules.map((module) => ({ module })) },
          // Seed the tier's default enabled reports at creation time only
          // (docs/2026-08-04-report-tier-gating-phases.md 5.1). A later tier
          // change never re-seeds this — see 5.4 / the PUT route below.
          reports: { create: REPORT_TIER_PRESETS[packageType].map((reportSlug) => ({ reportSlug })) },
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
      // whichever of billingCycle/maxEntities/maxUsers actually changed,
      // merged with whichever didn't (all optional on a partial update) —
      // this is the one write path where the tier could otherwise go stale.
      const existing = await tx.subscription.findUniqueOrThrow({ where: { id } });
      const effectiveBillingCycle = body.billingCycle ?? existing.billingCycle;
      const effectiveMaxEntities = body.maxEntities ?? existing.maxEntities;
      const effectiveMaxUsers = body.maxUsers ?? existing.maxUsers;
      data.packageType = derivePackageType(effectiveBillingCycle as BillingCycle, effectiveMaxEntities, effectiveMaxUsers);

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

  // Report tier gating, Phase 5.2 (docs/2026-08-04-report-tier-gating-phases.md).
  // Sets a client's full enabled-report set — the SubscriptionReport rows
  // canViewReportForSubscription() actually checks. Same replace-the-whole-set
  // shape as PUT /locations/:id/modules: the caller sends the complete desired
  // list, the handler diffs it against what's enabled now and writes both the
  // rows and the audit entry in one transaction.
  //
  // Keyed by :id = CLIENT id, not subscription id, matching the
  // /subscriptions/:clientId/check convention just above and the plan doc's
  // route shape (PUT /clients/:id/subscription/reports) — an admin thinks of
  // this as "this client's reports", not "row N's reports". Mounted under
  // /clients/*, so it's covered by the same requirePermission("admin.manage")
  // guard as the rest of this block (see the .use() list at the top of this
  // router — see security.md M-3 on why that placement matters).
  //
  // Unlike location modules, there is no ceiling to enforce here: reports
  // are gated directly off this row set, not off a broader subscription-level
  // set the way LocationModule is bounded by SubscriptionModule. Any slug in
  // REPORT_SLUGS is acceptable input; zod (subscriptionReportsBody) is the
  // only validation needed.
  .put("/clients/:id/subscription/reports", zValidator("json", subscriptionReportsBody), async (c) => {
    const clientId = c.req.param("id");
    const { reportSlugs } = c.req.valid("json");
    const user = c.get("user")!;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: { subscription: { include: { reports: true } } },
    });
    if (!client) throw new AppError(404, "Client not found");
    if (!client.subscription) throw new AppError(409, `"${client.name}" has no subscription yet — create one first.`);

    const subscriptionId = client.subscription.id;
    const before = client.subscription.reports.map((r) => r.reportSlug);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.subscriptionReport.deleteMany({ where: { subscriptionId } });
      if (reportSlugs.length > 0) {
        await tx.subscriptionReport.createMany({
          data: reportSlugs.map((reportSlug) => ({ subscriptionId, reportSlug })),
        });
      }
      const u = await tx.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: { client: { select: { id: true, name: true } }, reports: true },
      });
      await logActivity(
        {
          user,
          clientId,
          action: "subscription.reportsUpdate",
          entity: "Subscription",
          entityId: subscriptionId,
          summary: `Set "${client.name}" enabled reports to [${reportSlugs.join(", ")}]`,
          details: { old: before, new: reportSlugs },
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
    // Active seats only — matches assertUserSeatsAvailable, so the UI's
    // "can I add?" answer can't disagree with the server's 403.
    const userCount = await prisma.userClientAccess.count({
      where: { clientId, user: { status: "ACTIVE" } },
    });
    const canAddUser = sub.maxUsers === 0 || userCount < sub.maxUsers;
    const accessState = deriveAccessState(sub, new Date());
    return c.json({ hasSubscription: true, subscription: sub, locationCount, canAddEntity, userCount, canAddUser, accessState });
  });


// ── User accounts (ADMIN everywhere, OWNER within his own establishment) ─────
// Mounted separately from adminRoutes so it can carry the softer
// `users.manage` guard: the client req (2026-07-25) is that the OWNER — and
// only the owner, not his managers — hires and disables his own staff.

/** Which clients the actor may act on. ADMIN is unscoped. */
async function actorScope(c: Context<AppEnv>): Promise<{ all: boolean; clientIds: string[] }> {
  const actor = c.get("user")!;
  if (actor.role === "ADMIN") return { all: true, clientIds: [] };
  const access = await prisma.userClientAccess.findMany({
    where: { userId: actor.id },
    select: { clientId: true },
  });
  return { all: false, clientIds: access.map((a) => a.clientId) };
}

/** The target user must live inside the actor's own establishment. */
async function assertActorMayTouchUser(c: Context<AppEnv>, targetUserId: string): Promise<void> {
  const scope = await actorScope(c);
  if (scope.all) return;
  if (c.get("user")!.id === targetUserId) return; // editing yourself is always allowed
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { role: true, clientAccess: { select: { clientId: true } } },
  });
  if (!target) throw new AppError(404, "User not found");
  // An owner can disable a MANAGER (client req) but never an LIS ADMIN.
  if (target.role === "ADMIN") throw new AppError(403, "You cannot manage a system administrator");
  const shares = target.clientAccess.some((a) => scope.clientIds.includes(a.clientId));
  if (!shares) throw new AppError(404, "User not found");
}

/**
 * An owner may only grant roles below him and only into his own establishment,
 * so he can never mint a cross-tenant ADMIN or a peer OWNER.
 */
async function assertActorMayAssign(
  c: Context<AppEnv>,
  role: string | null,
  clientIds: string[],
): Promise<void> {
  const scope = await actorScope(c);
  if (scope.all) return;
  if (role && !(OWNER_ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
    throw new AppError(403, `You cannot assign the ${role} role`);
  }
  const foreign = clientIds.filter((id) => !scope.clientIds.includes(id));
  if (foreign.length > 0) throw new AppError(403, "You can only assign users to your own establishment");
}

/**
 * Rough "Browser on OS" label from a raw User-Agent string, for display only.
 * Covers the common cases (Chrome/Safari/Firefox/Edge × Windows/Mac/Android/
 * iOS) — good enough to tell devices apart in a history list, not a full UA
 * parser.
 */
function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "Mac"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${os}`;
}

export const userAdminRoutes = new Hono<AppEnv>()
  .use("/users", requireAuth, requirePermission("users.manage"))
  .use("/users/*", requireAuth, requirePermission("users.manage"))

  .get("/users", async (c) => {
    const scope = await actorScope(c);
    const users = await prisma.user.findMany({
      // An OWNER sees only staff attached to his own establishment — never
      // another tenant's people, and never the LIS admins.
      where: scope.all
        ? {}
        : { role: { not: "ADMIN" }, clientAccess: { some: { clientId: { in: scope.clientIds } } } },
      select: {
        id: true, username: true, firstName: true, lastName: true, email: true,
        role: true, status: true, createdAt: true,
        modules: { select: { module: true } },
        clientAccess: {
          // Scope the NESTED rows too. The `where` above correctly limits WHICH
          // users an owner sees, but each returned user still carried its full
          // access list — so the owner of one establishment could read the
          // names, package tiers, billing cycles and modules of every other
          // tenant a shared user happens to belong to.
          where: scope.all ? undefined : { clientId: { in: scope.clientIds } },
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
      // Sort by what the screen actually shows. Ordering on username while
      // rendering "Grace Lim, Lourd Borromeo, Maria Santos…" reads as unsorted.
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
    return c.json(users);
  })

  .post("/users", zValidator("json", userCreateBody), async (c) => {
    const body = c.req.valid("json");
    const actor = c.get("user")!;
    const existing = await prisma.user.findUnique({ where: { username: body.username } });
    if (existing) throw new AppError(409, "Username already taken");
    await assertActorMayAssign(c, body.role, body.clientIds);
    await assertUserSeatsAvailable(body.clientIds);
    await assertPasswordNotBreached(body.password);
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
    await assertActorMayTouchUser(c, id);
    if (body.role) await assertActorMayAssign(c, body.role, []);
    const data: Record<string, unknown> = { ...body };
    delete data.password;
    delete data.modules;
    if (body.password) {
      await assertPasswordNotBreached(body.password);
      data.passwordHash = await hashPassword(body.password);
    }
    if (body.email === "") data.email = null;
    // Re-enabling claims a seat back, so it has to pass the same check as
    // creating — otherwise disable-then-enable walks straight past the cap.
    if (body.status === "ACTIVE") {
      const access = await prisma.userClientAccess.findMany({ where: { userId: id }, select: { clientId: true } });
      await assertUserSeatsAvailable(access.map((a) => a.clientId), id);
    }
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id }, data });
      if (body.modules !== undefined) {
        await tx.userModule.deleteMany({ where: { userId: id } });
        await tx.userModule.createMany({ data: body.modules.map((module) => ({ userId: id, module })) });
      }
      /**
       * A password reset ends that account's existing sessions.
       *
       * The reason an owner resets a password is almost always that the old one
       * is compromised — a phone left in a taxi, a shared password, a departed
       * employee. Without this, the reset changed nothing for whoever already
       * held a session cookie: they kept full access for up to seven more days
       * (a year on a registered desktop), while the screen told the owner the
       * account was secured. The audit trail is also cleared to say so, because
       * "everyone was signed out" is the part the owner needs to be able to
       * verify afterwards.
       *
       * Only on a password change. A role or module edit needs no eviction —
       * getSessionUser re-reads role and modules from the User row on every
       * request, so those take effect on the next call anyway, and throwing
       * someone out of a half-finished count to widen their access would be
       * hostile for no gain.
       */
      let endedSessions = 0;
      if (body.password) {
        const { count } = await tx.authSession.deleteMany({ where: { userId: id } });
        endedSessions = count;
      }
      await logActivity(
        {
          user: actor, action: "user.update", entity: "User", entityId: id,
          summary: body.password
            ? `Updated user ${u.username} — password reset, ${endedSessions} active session${endedSessions === 1 ? "" : "s"} ended`
            : `Updated user ${u.username}`,
          details: { ...body, password: body.password ? "(reset)" : undefined, endedSessions: body.password ? endedSessions : undefined },
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
    await assertActorMayTouchUser(c, userId);
    await assertActorMayAssign(c, null, clientIds);
    await assertUserSeatsAvailable(clientIds, userId);

    // The delete is scoped to the actor's OWN establishments.
    //
    // The two guards above do not cover it: `assertActorMayTouchUser` proves
    // the target shares *one* client with the actor, and `assertActorMayAssign`
    // validates only the ids being *supplied*. An unscoped
    // `deleteMany({ userId })` therefore reached rows the actor administers
    // nothing of — a user with access to establishments A and B lost B the
    // moment the owner of A saved `{clientIds:["A"]}`, silently, from a screen
    // that never showed B. Shared users are a real case here; the read at the
    // user-list route already scopes `clientAccess` for exactly that reason.
    //
    // ADMIN keeps the full replace: they administer everything, so their
    // supplied list genuinely is the whole intended set.
    const scope = await actorScope(c);
    await prisma.$transaction(async (tx) => {
      await tx.userClientAccess.deleteMany({
        where: { userId, ...(scope.all ? {} : { clientId: { in: scope.clientIds } }) },
      });
      // Safe against the @@id([userId, clientId]) primary key: every id here is
      // in-scope (assertActorMayAssign rejects foreign ones), and every in-scope
      // row was just removed.
      await tx.userClientAccess.createMany({ data: clientIds.map((clientId) => ({ userId, clientId })) });
      await logActivity(
        {
          user: actor, action: "user.access", entity: "User", entityId: userId,
          summary: "Updated client assignments",
          // Records the scope actually applied, so the trail does not read as a
          // full replacement when it was a partial one.
          details: { clientIds, replacedWithinClientIds: scope.all ? "ALL" : scope.clientIds },
        },
        tx,
      );
    });
    return c.json({ ok: true });
  })

  // ── Login history (client req 2026-07-29: visibility into whether a staff
  // account is being used on multiple devices). STAFF is excluded from this
  // route by the shared "users.manage" guard above (STAFF is not in
  // ["ADMIN", "OWNER"]) — called out again here since getting that gate wrong
  // on this specific route has real consequences.
  .get("/users/:id/sessions", async (c) => {
    const userId = c.req.param("id");
    await assertActorMayTouchUser(c, userId);
    const [events, activeSessions] = await Promise.all([
      prisma.activityLog.findMany({
        where: { entity: "User", entityId: userId, action: { in: ["auth.login", "auth.logout", "auth.autoLogout"] } },
        orderBy: { ts: "desc" },
        select: { id: true, ts: true, action: true, detailsJson: true },
      }),
      prisma.authSession.findMany({
        where: { userId, expiresAt: { gt: new Date() } },
        select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true },
      }),
    ]);
    const history = events.map((e) => {
      let details: { ip?: string; userAgent?: string | null; endedSessionCount?: number } = {};
      try {
        details = e.detailsJson ? JSON.parse(e.detailsJson) : {};
      } catch {
        details = {};
      }
      return {
        id: e.id,
        ts: e.ts,
        action: e.action,
        ip: details.ip ?? null,
        device: deviceLabel(details.userAgent ?? null),
      };
    });
    const active = activeSessions.map((s) => ({
      id: s.id,
      ip: s.ip,
      device: deviceLabel(s.userAgent),
      loginAt: s.createdAt,
      expiresAt: s.expiresAt,
    }));
    return c.json({ history, active });
  })

  .post("/users/:id/sessions/:sessionId/revoke", zValidator("json", voidRequest), async (c) => {
    const userId = c.req.param("id");
    const sessionId = c.req.param("sessionId");
    const { reason } = c.req.valid("json");
    const actor = c.get("user")!;
    await assertActorMayTouchUser(c, userId);
    const session = await prisma.authSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw new AppError(404, "Session not found");
    // One transaction: an administrator forcing another user off a machine is
    // exactly the event the trail exists for, and it carries a reason for that
    // reason. Revoked-with-no-record is not a state this should be able to reach.
    await prisma.$transaction(async (tx) => {
      await tx.authSession.delete({ where: { id: sessionId } });
      await logActivity(
        {
          user: actor,
          action: "auth.revoke",
          entity: "User",
          entityId: userId,
          summary: `Signed out ${deviceLabel(session.userAgent)}`,
          details: { reason, ip: session.ip, userAgent: session.userAgent },
        },
        tx,
      );
    });
    return c.json({ ok: true });
  });
