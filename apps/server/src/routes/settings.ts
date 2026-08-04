import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../lib/validate";
import {
  COST_BASES,
  COST_BASIS_LABELS,
  isCostBasis,
  MATERIAL_VARIANCE_PCT,
  VARIANCE_THRESHOLD_MAX,
  VARIANCE_THRESHOLD_MIN,
} from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
import { logActivity } from "../services/activity";
import { requireAuth, requirePermission, type AppEnv } from "../middleware/auth";

/**
 * Per-client settings the operator can edit from the Settings page. Company
 * info feeds report/export branding (address + footer note); it's stored as a
 * single JSON blob in Setting(clientId, "company").
 */

const companyInfo = z.object({
  legalName: z.string().trim().max(120).default(""),
  address: z.string().trim().max(240).default(""),
  phone: z.string().trim().max(60).default(""),
  email: z.string().trim().max(120).default(""),
  reportFooter: z.string().trim().max(240).default(""),
});
export type CompanyInfo = z.infer<typeof companyInfo>;

const EMPTY: CompanyInfo = { legalName: "", address: "", phone: "", email: "", reportFooter: "" };

const costBasisBody = z.object({ costBasis: z.enum(COST_BASES) });


const varianceThresholdBody = z.object({
  varianceThresholdPct: z.number().min(VARIANCE_THRESHOLD_MIN).max(VARIANCE_THRESHOLD_MAX),
});

/**
 * Client req 2026-07-31 (docs/per-user-per-item-uom-plan.md): the unit an
 * admin default or staff override may hold for one item. Same 8-value list
 * as preferredVolumeUnit/preferredMassUnit below, but not split by kind —
 * a single per-item field can be either a VOLUME or MASS item, so both lists
 * are accepted here and resolveDisplayUnit() never cross-checks kind at
 * write time (same as preferredVolumeUnit/preferredMassUnit today).
 */
const itemDisplayUnitBody = z.object({
  unit: z.enum(["ml", "L", "fl oz", "gal", "g", "kg", "oz", "lb"]),
});

async function assertClientAccess(userId: string, role: string, clientId: string): Promise<void> {
  if (role === "ADMIN") return;
  const access = await prisma.userClientAccess.findUnique({
    where: { userId_clientId: { userId, clientId } },
  });
  if (!access) throw new AppError(403, "No access to this client");
}

export async function getCompanyInfo(clientId: string): Promise<CompanyInfo> {
  const setting = await prisma.setting.findUnique({
    where: { clientId_key: { clientId, key: "company" } },
  });
  if (!setting) return EMPTY;
  const parsed = companyInfo.safeParse(JSON.parse(setting.value));
  return parsed.success ? parsed.data : EMPTY;
}

/**
 * Personal display preferences (font size, unit system). These are the
 * signed-in user's own choices — not client data — so they only need
 * requireAuth, not the master.write permission the rest of this router
 * uses. Stored one row per user in Setting(clientId: "", key: "prefs:<userId>").
 */
const userPreferences = z.object({
  // "large" (18px) is the starting size per client req #1 — readable for
  // users with poor eyesight. Anyone who explicitly saved a preference
  // (including "default"/16px) keeps their choice.
  fontSize: z.enum(["default", "large", "x-large"]).default("large"),
  unitSystem: z.enum(["metric", "imperial"]).default("metric"),
  /**
   * Client req 2026-07-31: each signed-in user picks their own display unit
   * for volume and mass items, independent of anyone else's choice — same
   * per-user row as fontSize/unitSystem, nothing shared. Values are the
   * units already seeded in seed.ts (see VOLUME/MASS lists there); default
   * is the base unit of each kind, matching how unitSystem already
   * defaults to "metric" until a user saves their own pick. Conversion for
   * display uses `convert()` from packages/core/src/units.ts — the item's
   * own configured unit stays the source of truth for storage.
   */
  preferredVolumeUnit: z.enum(["ml", "L", "fl oz", "gal"]).default("ml"),
  preferredMassUnit: z.enum(["g", "kg", "oz", "lb"]).default("g"),
  /**
   * Phase 46.4.2: when this user last opened Activity, ISO string. Not a
   * business record — same shape of write as fontSize/unitSystem, just
   * timestamped by a page visit instead of a menu choice. Optional/undefined
   * for anyone who hasn't opened Activity since this field shipped; the
   * dashboard treats that as "count nothing yet" rather than "count
   * everything" (see services/dashboard.ts). Full-object PUT still applies
   * here like every other Setting row — see apps/web/src/pages/admin/activity.tsx
   * for the read-full-object-then-write-full-object flow this relies on.
   */
  activityViewedAt: z.string().optional(),
});
export type UserPreferences = z.infer<typeof userPreferences>;

const DEFAULT_PREFERENCES: UserPreferences = {
  fontSize: "large",
  unitSystem: "metric",
  preferredVolumeUnit: "ml",
  preferredMassUnit: "g",
};

export const preferencesRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .get("/preferences", async (c) => {
    const user = c.get("user")!;
    const setting = await prisma.setting.findUnique({
      where: { clientId_key: { clientId: "", key: `prefs:${user.id}` } },
    });
    if (!setting) return c.json(DEFAULT_PREFERENCES);
    const parsed = userPreferences.safeParse(JSON.parse(setting.value));
    return c.json(parsed.success ? parsed.data : DEFAULT_PREFERENCES);
  })

  .put("/preferences", zValidator("json", userPreferences), async (c) => {
    const user = c.get("user")!;
    const body = c.req.valid("json");
    await prisma.setting.upsert({
      where: { clientId_key: { clientId: "", key: `prefs:${user.id}` } },
      update: { value: JSON.stringify(body) },
      create: { clientId: "", key: `prefs:${user.id}`, value: JSON.stringify(body) },
    });
    return c.json(body);
  })

  // ── Per-item display unit — staff's own override (client req 2026-07-31,
  // docs/per-user-per-item-uom-plan.md). Own choice, no permission needed
  // beyond being signed in — same tier as /preferences above. Sits above the
  // admin default and the staff's general preferredVolumeUnit/preferredMassUnit
  // in resolveDisplayUnit() (@fnb/core), but affects nobody else's screen.
  .get("/item-unit-preference/:itemId", async (c) => {
    const user = c.get("user")!;
    const itemId = c.req.param("itemId");
    const row = await prisma.userItemUnitPreference.findUnique({
      where: { userId_itemId: { userId: user.id, itemId } },
    });
    return c.json({ unit: row?.unit ?? null });
  })

  .put("/item-unit-preference/:itemId", zValidator("json", itemDisplayUnitBody), async (c) => {
    const user = c.get("user")!;
    const itemId = c.req.param("itemId");
    const { unit } = c.req.valid("json");
    const item = await prisma.item.findUnique({ where: { id: itemId }, select: { id: true, name: true } });
    if (!item) throw new AppError(404, "Item not found");
    const row = await prisma.userItemUnitPreference.upsert({
      where: { userId_itemId: { userId: user.id, itemId } },
      update: { unit },
      create: { userId: user.id, itemId, unit },
    });
    return c.json({ unit: row.unit });
  })

  .delete("/item-unit-preference/:itemId", async (c) => {
    const user = c.get("user")!;
    const itemId = c.req.param("itemId");
    const existing = await prisma.userItemUnitPreference.findUnique({
      where: { userId_itemId: { userId: user.id, itemId } },
    });
    if (!existing) throw new AppError(404, "No override set for this item");
    await prisma.userItemUnitPreference.delete({ where: { userId_itemId: { userId: user.id, itemId } } });
    return c.json({ ok: true });
  })

  // ── Batch resolve — levels 1 & 2 for many items at once (client req
  // 2026-07-31, docs/per-user-per-item-uom-plan.md). The per-item GET routes
  // above are one-row-at-a-time, fine for the Settings page's own list, but
  // every screen that actually renders quantities (count session, recipe
  // builder/detail) needs this for a whole page of items in one request, not
  // one request per row. Returns only the raw staffOverride/adminDefault
  // strings (or null) per item — resolveDisplayUnit() (@fnb/core) is still
  // where levels 3/4 (general preference, item's own unit) get folded in,
  // client-side, because that step needs each item VARIANT's unit kind
  // (VOLUME vs MASS) to know whether the general preference even applies,
  // and the caller already has that loaded locally (no need to ship it here).
  // requireAuth only, same tier as /preferences: reading your own resolution
  // context needs no special permission, same as the per-item GETs above.
  .get("/item-display-units", async (c) => {
    const user = c.get("user")!;
    const clientId = c.req.query("clientId") ?? "";
    const itemIdsParam = c.req.query("itemIds") ?? "";
    if (!clientId) throw new AppError(400, "clientId is required");
    const itemIds = [...new Set(itemIdsParam.split(",").map((s) => s.trim()).filter(Boolean))];
    if (itemIds.length === 0) return c.json({});
    await assertClientAccess(user.id, user.role, clientId);
    const [overrides, defaults] = await Promise.all([
      prisma.userItemUnitPreference.findMany({
        where: { userId: user.id, itemId: { in: itemIds } },
        select: { itemId: true, unit: true },
      }),
      prisma.clientItemUnitDefault.findMany({
        where: { clientId, itemId: { in: itemIds } },
        select: { itemId: true, unit: true },
      }),
    ]);
    const overrideByItem = new Map(overrides.map((o) => [o.itemId, o.unit]));
    const defaultByItem = new Map(defaults.map((d) => [d.itemId, d.unit]));
    const result: Record<string, { staffOverride: string | null; adminDefault: string | null }> = {};
    for (const itemId of itemIds) {
      result[itemId] = {
        staffOverride: overrideByItem.get(itemId) ?? null,
        adminDefault: defaultByItem.get(itemId) ?? null,
      };
    }
    return c.json(result);
  })

  // READ-ONLY and outside the master.write guard on purpose: the basis is
  // printed on every valuation report, so anyone who can read a report must be
  // able to read the basis. A 403 here would silently mislabel their screen as
  // "Purchase Price". Writing it stays restricted (see settingsRoutes).
  .get("/cost-basis", async (c) => {
    const user = c.get("user")!;
    const clientId = c.req.query("clientId") ?? "";
    if (!clientId) throw new AppError(400, "clientId is required");
    await assertClientAccess(user.id, user.role, clientId);
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { costBasis: true } });
    return c.json({ costBasis: isCostBasis(client?.costBasis) ? client.costBasis : "PRICE" });
  })

  // Read-only like cost-basis: the Full Audit highlight (screen + downloads)
  // needs the threshold, so anyone who can read the report must be able to read
  // it. Writing stays gated (settingsRoutes).
  .get("/variance-threshold", async (c) => {
    const user = c.get("user")!;
    const clientId = c.req.query("clientId") ?? "";
    if (!clientId) throw new AppError(400, "clientId is required");
    await assertClientAccess(user.id, user.role, clientId);
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { varianceThresholdPct: true },
    });
    return c.json({ varianceThresholdPct: client?.varianceThresholdPct ?? MATERIAL_VARIANCE_PCT });
  });

/**
 * `master.write` is attached PER ROUTE, never as a blanket `.use()`.
 *
 * `preferencesRoutes` mounts on this same `/api/settings` prefix (app.ts) with
 * only `requireAuth`, and Hono merges routers by path — a pathless `.use()` here
 * registers as `/api/settings/*` and runs on the OTHER router's routes too.
 * Verified, not assumed: with the blanket guard in place, a STAFF or ACCOUNTANT
 * login got 403 from GET /api/settings/preferences and GET
 * /api/settings/cost-basis, the two endpoints whose own comments say they are
 * outside this guard on purpose. The cost-basis one matters beyond an annoyance:
 * the client falls back to "PRICE" on error, so an accountant whose
 * establishment values at LAST_COST would read every valuation screen under the
 * wrong basis label with nothing to signal it.
 *
 * Method matters as well as path — preferencesRoutes serves GET /cost-basis and
 * GET /variance-threshold at the very paths this router serves PUT on — so a
 * path-scoped `.use("/cost-basis", …)` would not have been narrow enough either.
 * This is the same trap admin.ts documents at its own `.use("/clients", …)`.
 */
const writeGuard = requirePermission("master.write");

export const settingsRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .get("/company", writeGuard, async (c) => {
    const user = c.get("user")!;
    const clientId = c.req.query("clientId") ?? "";
    if (!clientId) throw new AppError(400, "clientId is required");
    await assertClientAccess(user.id, user.role, clientId);
    return c.json(await getCompanyInfo(clientId));
  })

  .put("/company", writeGuard, zValidator("json", companyInfo), async (c) => {
    const user = c.get("user")!;
    const clientId = c.req.query("clientId") ?? "";
    if (!clientId) throw new AppError(400, "clientId is required");
    await assertClientAccess(user.id, user.role, clientId);
    const body = c.req.valid("json");
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { clientId_key: { clientId, key: "company" } },
        update: { value: JSON.stringify(body) },
        create: { clientId, key: "company", value: JSON.stringify(body) },
      });
      await logActivity(
        { user, clientId, action: "settings.company", entity: "Setting", summary: "Updated company info", details: body },
        tx,
      );
    });
    return c.json(body);
  })

  // ── Per-item display unit — admin default (client req 2026-07-31,
  // docs/per-user-per-item-uom-plan.md). A manager sets one row per item;
  // it applies to every user of this client who has no
  // UserItemUnitPreference of their own for the same item. Same tier as
  // cost-basis / variance-threshold below: an establishment policy set once
  // for everyone, gated master.write, logged like the other two.
  .get("/item-unit-default/:itemId", async (c) => {
    const user = c.get("user")!;
    const itemId = c.req.param("itemId");
    const clientId = c.req.query("clientId") ?? "";
    if (!clientId) throw new AppError(400, "clientId is required");
    await assertClientAccess(user.id, user.role, clientId);
    const row = await prisma.clientItemUnitDefault.findUnique({
      where: { clientId_itemId: { clientId, itemId } },
    });
    return c.json({ unit: row?.unit ?? null });
  })

  // writeGuard was missing here while both siblings below had it — so the
  // establishment-wide default display unit, which the comment above calls an
  // "establishment policy set once for everyone", could be rewritten by any
  // STAFF or read-only account with access to the client.
  .put("/item-unit-default/:itemId", writeGuard, zValidator("json", itemDisplayUnitBody), async (c) => {
    const user = c.get("user")!;
    const itemId = c.req.param("itemId");
    const clientId = c.req.query("clientId") ?? "";
    if (!clientId) throw new AppError(400, "clientId is required");
    await assertClientAccess(user.id, user.role, clientId);
    const { unit } = c.req.valid("json");
    const item = await prisma.item.findUnique({ where: { id: itemId }, select: { id: true, name: true } });
    if (!item) throw new AppError(404, "Item not found");
    const before = await prisma.clientItemUnitDefault.findUnique({
      where: { clientId_itemId: { clientId, itemId } },
    });
    const row = await prisma.$transaction(async (tx) => {
      const saved = await tx.clientItemUnitDefault.upsert({
        where: { clientId_itemId: { clientId, itemId } },
        update: { unit, updatedById: user.id },
        create: { clientId, itemId, unit, updatedById: user.id },
      });
      await logActivity(
        {
          user,
          clientId,
          action: "settings.itemUnitDefault",
          entity: "ClientItemUnitDefault",
          entityId: saved.id,
          summary: `Default display unit for ${item.name}: ${unit}`,
          details: { itemId, from: before?.unit ?? null, to: unit },
        },
        tx,
      );
      return saved;
    });
    return c.json({ unit: row.unit });
  })

  // ── Inventory cost basis (accounting policy — client req 2026-07-20) ──
  // Stored on the Client, not passed per request: an accounting policy must
  // not vary between two people exporting the same report. The matching GET
  // lives on preferencesRoutes so non-editors can still see the basis.
  .put("/cost-basis", writeGuard, zValidator("json", costBasisBody), async (c) => {
    const user = c.get("user")!;
    const clientId = c.req.query("clientId") ?? "";
    if (!clientId) throw new AppError(400, "clientId is required");
    await assertClientAccess(user.id, user.role, clientId);
    const { costBasis } = c.req.valid("json");
    const before = await prisma.client.findUnique({ where: { id: clientId }, select: { costBasis: true } });
    await prisma.$transaction(async (tx) => {
      await tx.client.update({ where: { id: clientId }, data: { costBasis } });
      // Changing the basis restates every valuation report — that is an
      // accounting-policy change, so it is logged with old → new.
      await logActivity(
        {
          user,
          clientId,
          action: "settings.costBasis",
          entity: "Client",
          entityId: clientId,
          summary: `Inventory cost basis: ${COST_BASIS_LABELS[costBasis]}`,
          details: { from: before?.costBasis ?? "PRICE", to: costBasis },
        },
        tx,
      );
    });
    return c.json({ costBasis });
  })

  // ── Variance highlight threshold (audit policy — client req 2026-07-21) ──
  // Per-establishment, like the cost basis: a bar and a fine-dining kitchen
  // tolerate different over/short. Presentation only — never the sacred math.
  .put("/variance-threshold", writeGuard, zValidator("json", varianceThresholdBody), async (c) => {
    const user = c.get("user")!;
    const clientId = c.req.query("clientId") ?? "";
    if (!clientId) throw new AppError(400, "clientId is required");
    await assertClientAccess(user.id, user.role, clientId);
    const { varianceThresholdPct } = c.req.valid("json");
    const before = await prisma.client.findUnique({
      where: { id: clientId },
      select: { varianceThresholdPct: true },
    });
    await prisma.$transaction(async (tx) => {
      await tx.client.update({ where: { id: clientId }, data: { varianceThresholdPct } });
      await logActivity(
        {
          user,
          clientId,
          action: "settings.varianceThreshold",
          entity: "Client",
          entityId: clientId,
          summary: `Variance highlight threshold: ${varianceThresholdPct}%`,
          details: { from: before?.varianceThresholdPct ?? MATERIAL_VARIANCE_PCT, to: varianceThresholdPct },
        },
        tx,
      );
    });
    return c.json({ varianceThresholdPct });
  });

