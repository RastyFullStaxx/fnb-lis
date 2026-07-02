import { Hono } from "hono";
import { errorHandler } from "./lib/errors";
import { originCheck, sessionMiddleware, type AppEnv } from "./middleware/auth";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.onError(errorHandler);
  app.use(originCheck);
  app.use(sessionMiddleware);

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/api/auth", authRoutes);
  app.route("/api/admin", adminRoutes);

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  return app;
}
