import { Hono } from "hono";
import { errorHandler } from "./lib/errors";
import {
  originCheck,
  requireAuth,
  requireLocationAccess,
  sessionMiddleware,
  type AppEnv,
} from "./middleware/auth";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { masterRoutes } from "./routes/master";
import { locationItemRoutes } from "./routes/location-items";
import { countRoutes } from "./routes/counts";
import { purchaseRoutes } from "./routes/purchases";
import { transferRoutes } from "./routes/transfers";
import { saleRoutes } from "./routes/sales";
import { menuRoutes } from "./routes/menus";
import { importRoutes } from "./routes/imports";
import { reportRoutes } from "./routes/reports";
import { dashboardRoutes } from "./routes/dashboard";
import { activityRoutes } from "./routes/activity";
import { settingsRoutes, preferencesRoutes } from "./routes/settings";
import { stockyRoutes } from "./routes/stocky";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.onError(errorHandler);
  app.use(originCheck);
  app.use(sessionMiddleware);

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/api/auth", authRoutes);
  app.route("/api/admin", adminRoutes);
  app.route("/api/master", masterRoutes);
  app.route("/api/activity", activityRoutes);
  app.route("/api/settings", settingsRoutes);
  app.route("/api/settings", preferencesRoutes);

  // Location-scoped routes: auth + client access enforced once here.
  const locationScoped = new Hono<AppEnv>()
    .use(requireAuth, requireLocationAccess)
    .route("/", locationItemRoutes)
    .route("/", countRoutes)
    .route("/", purchaseRoutes)
    .route("/", transferRoutes)
    .route("/", saleRoutes)
    .route("/", menuRoutes)
    .route("/", importRoutes)
    .route("/", reportRoutes)
    .route("/", dashboardRoutes)
    .route("/", stockyRoutes);
  app.route("/api/locations/:locationId", locationScoped);

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  return app;
}
