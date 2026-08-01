import { Hono } from "hono";
import { allowedProductTypes, can, type Role } from "@fnb/core";
import { prisma } from "../db";
import { requirePermission, type AppEnv } from "../middleware/auth";
import { buildDashboard } from "../services/dashboard";
import { buildTrends } from "../services/trends";

export const dashboardRoutes = new Hono<AppEnv>()
  // Stated explicitly. This used to be inherited by accident from a pathless
  // `.use()` in reportRoutes, which is mounted on the same prefix — the sort of
  // dependency that vanishes the moment someone tidies the other file.
  .use("/dashboard", requirePermission("reports.view"))
  .get("/dashboard", async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const allowed = allowedProductTypes(c.get("locationModules"));
    const user = c.get("user")!;
    // Phase 46.4.2: recentPriceChanges is counted since this user's own
    // prefs.activityViewedAt, same `prefs:<userId>` row fontSize/unitSystem
    // already live in. A direct read here (not through routes/settings.ts)
    // since this route only needs the one field, not the whole blob.
    const prefsRow = await prisma.setting.findUnique({
      where: { clientId_key: { clientId: "", key: `prefs:${user.id}` } },
    });
    let activityViewedAt: Date | undefined;
    if (prefsRow) {
      try {
        const parsed = JSON.parse(prefsRow.value) as { activityViewedAt?: string };
        activityViewedAt = parsed.activityViewedAt ? new Date(parsed.activityViewedAt) : undefined;
      } catch {
        activityViewedAt = undefined;
      }
    }
    return c.json(
      await buildDashboard(
        location.id,
        client.id,
        allowed,
        can(user.role as Role, "activity.view"),
        activityViewedAt,
      ),
    );
  })
  .get("/dashboard/trends", async (c) => {
    const location = c.get("location");
    const allowed = allowedProductTypes(c.get("locationModules"));
    const raw = Number(c.req.query("periods") ?? 8);
    const periods = Number.isFinite(raw) ? raw : 8;
    return c.json(await buildTrends(location.id, allowed, periods));
  });
