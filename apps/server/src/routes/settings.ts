import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { COST_BASES, COST_BASIS_LABELS, isCostBasis } from "@fnb/core";
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
});
export type UserPreferences = z.infer<typeof userPreferences>;

const DEFAULT_PREFERENCES: UserPreferences = { fontSize: "large", unitSystem: "metric" };

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
  });

export const settingsRoutes = new Hono<AppEnv>()
  .use(requireAuth, requirePermission("master.write"))

  .get("/company", async (c) => {
    const user = c.get("user")!;
    const clientId = c.req.query("clientId") ?? "";
    if (!clientId) throw new AppError(400, "clientId is required");
    await assertClientAccess(user.id, user.role, clientId);
    return c.json(await getCompanyInfo(clientId));
  })

  .put("/company", zValidator("json", companyInfo), async (c) => {
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

  // ── Inventory cost basis (accounting policy — client req 2026-07-20) ──
  // Stored on the Client, not passed per request: an accounting policy must
  // not vary between two people exporting the same report. The matching GET
  // lives on preferencesRoutes so non-editors can still see the basis.
  .put("/cost-basis", zValidator("json", costBasisBody), async (c) => {
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
  });
