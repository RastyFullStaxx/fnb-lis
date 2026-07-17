import { Hono } from "hono";
import { allowedProductTypes } from "@fnb/core";
import { type AppEnv } from "../middleware/auth";
import { buildDashboard } from "../services/dashboard";

export const dashboardRoutes = new Hono<AppEnv>().get("/dashboard", async (c) => {
  const location = c.get("location");
  const client = c.get("client");
  const allowed = allowedProductTypes(c.get("subscriptionModules"));
  return c.json(await buildDashboard(location.id, client.id, allowed));
});
