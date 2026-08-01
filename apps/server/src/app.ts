import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { errorHandler } from "./lib/errors";
import {
  originCheck,
  requireAuth,
  requireLocationAccess,
  sessionMiddleware,
  type AppEnv,
} from "./middleware/auth";
import { rateLimit, securityHeaders } from "./middleware/security";
import { authRoutes } from "./routes/auth";
import { pinRoutes, pinAdminRoutes } from "./routes/pin";
import { adminRoutes, userAdminRoutes } from "./routes/admin";
import { deviceRoutes } from "./routes/devices";
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
import { syncRoutes } from "./routes/sync";

/**
 * Requests per minute per IP across the whole API. Generous on purpose: one
 * dashboard load is ~20 calls and a whole establishment can sit behind a single
 * NAT address, so this is a flood/scraping ceiling, not a usage budget. The
 * per-endpoint limiters below are the ones with teeth.
 */
const API_RATE_LIMIT = Number(process.env.FNB_RATE_LIMIT_API ?? 1200);
/** FAILED sign-in attempts per 15 min per IP — see the login limiter below. */
const LOGIN_RATE_LIMIT = Number(process.env.FNB_RATE_LIMIT_LOGIN ?? 10);

/** JSON bodies. Every JSON route on this server sends kilobytes. */
const MAX_JSON_BYTES = 1024 * 1024;
/** Multipart ceiling — a hair above the 20 MB routes/imports.ts enforces itself. */
const MAX_UPLOAD_BYTES = 21 * 1024 * 1024;

export function createApp() {
  const app = new Hono<AppEnv>();

  app.onError(errorHandler);
  app.use(securityHeaders);
  app.use(originCheck);
  app.use(
    "/api/*",
    rateLimit({
      id: "api",
      limit: API_RATE_LIMIT,
      windowMs: 60_000,
      message: "Too many requests. Slow down and try again shortly.",
    }),
  );
  app.use(sessionMiddleware);

  app.get("/api/health", (c) => c.json({ ok: true }));

  /**
   * Per-IP net under the per-ACCOUNT lockout (5 failures / 1 hour, enforced in
   * routes/auth.ts). The account lockout alone stops brute force against one
   * user but is blind to the two attacks that matter more here: credential
   * stuffing, which tries ONE password against many usernames and never trips a
   * per-account counter, and the fact that /login runs scrypt before it knows
   * who is calling — an unauthenticated CPU amplifier.
   *
   * Counts FAILURES only (401 = bad credentials, 423 = locked). A bar where
   * fifteen staff sign in at shift change from one NAT address never reaches
   * this; someone guessing passwords reaches it in seconds.
   */
  app.use(
    "/api/auth/login",
    rateLimit({
      id: "login",
      limit: LOGIN_RATE_LIMIT,
      windowMs: 15 * 60_000,
      message: "Too many failed sign-in attempts from this network. Try again in a few minutes.",
      countOnly: (status) => status === 401 || status === 423,
    }),
  );
  // Both PIN proofs are guessable secrets reachable over the network, so the
  // route that verifies them gets the same net as /login.
  app.use(
    "/api/auth/pin",
    rateLimit({
      id: "pin",
      limit: LOGIN_RATE_LIMIT,
      windowMs: 15 * 60_000,
      message: "Too many failed attempts from this network. Try again in a few minutes.",
      countOnly: (status) => status === 401 || status === 423,
    }),
  );
  /**
   * A body is buffered before zod ever sees it, so "the schema rejects it" is
   * not a size control. Split by content-type rather than one global number:
   * file import is legitimately multipart and large (routes/imports.ts caps it
   * at 20 MB and is the authority on that), while every JSON route on this
   * server sends kilobytes.
   */
  app.use("/api/*", (c, next) => {
    const isUpload = (c.req.header("content-type") ?? "").includes("multipart/form-data");
    return bodyLimit({
      maxSize: isUpload ? MAX_UPLOAD_BYTES : MAX_JSON_BYTES,
      onError: (ctx) => ctx.json({ error: "Request body too large" }, 413),
    })(c, next);
  });

  app.route("/api/auth", authRoutes);
  app.route("/api/auth", pinRoutes);
  app.route("/api/admin", adminRoutes);
  // Same prefix, softer guard: user accounts are managed by the LIS ADMIN and
  // by each establishment's OWNER (client req 2026-07-25).
  app.route("/api/admin", userAdminRoutes);
  // Same prefix again, its own guard: registered desktops are managed by the
  // LIS ADMIN and by each establishment's OWNER (devices.manage).
  app.route("/api/admin", deviceRoutes);
  app.route("/api/admin", pinAdminRoutes);
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
    .route("/", stockyRoutes)
    .route("/", syncRoutes);
  app.route("/api/locations/:locationId", locationScoped);

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  return app;
}
