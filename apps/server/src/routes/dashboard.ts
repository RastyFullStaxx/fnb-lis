import { Hono } from "hono";
import { allowedProductTypes } from "@fnb/core";
import { type AppEnv } from "../middleware/auth";
import { buildDashboard } from "../services/dashboard";
import { buildTrends } from "../services/trends";

export const dashboardRoutes = new Hono<AppEnv>()
  .get("/dashboard", async (c) => {
    const location = c.get("location");
    const client = c.get("client");
    const allowed = allowedProductTypes(c.get("locationModules"));
    return c.json(await buildDashboard(location.id, client.id, allowed));
  })
  .get("/dashboard/trends", async (c) => {
    const location = c.get("location");
    const allowed = allowedProductTypes(c.get("locationModules"));
    const raw = Number(c.req.query("periods") ?? 8);
    const periods = Number.isFinite(raw) ? raw : 8;
    return c.json(await buildTrends(location.id, allowed, periods));
  });
