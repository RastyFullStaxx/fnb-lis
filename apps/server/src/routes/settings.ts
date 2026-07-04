import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
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
  });
