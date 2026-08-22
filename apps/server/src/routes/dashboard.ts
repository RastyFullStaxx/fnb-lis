import { Hono } from "hono";
import { allowedProductTypes, can, canViewVariance, type Role } from "@fnb/core";
import { prisma } from "../db";
import { AppError } from "../lib/errors";
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
        canViewVariance(user),
      ),
    );
  })
  /**
   * Every field TrendPeriod carries (varianceCost, varianceRetail,
   * shortageCost, surplusCost, itemsShort, itemsOver) is variance-derived —
   * this endpoint is the sole source for the dashboard's two headline
   * variance tiles and the Variance by Period chart (Phase 4.5). Gating the
   * whole route rather than trimming fields, same 404 convention the report
   * routes use: a blocked STAFF account trying this endpoint directly should
   * find nothing there, not a redacted shape (hide-variance-from-staff Phase
   * 2.5).
   */
  .get("/dashboard/trends", async (c) => {
    const user = c.get("user")!;
    if (user.role === "STAFF" && !canViewVariance(user)) throw new AppError(404, "Not found");
    const location = c.get("location");
    const allowed = allowedProductTypes(c.get("locationModules"));
    const raw = Number(c.req.query("periods") ?? 8);
    const periods = Number.isFinite(raw) ? raw : 8;
    return c.json(await buildTrends(location.id, allowed, periods));
  });
