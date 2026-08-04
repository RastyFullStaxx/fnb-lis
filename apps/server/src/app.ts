import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { timeout } from "hono/timeout";
import { HTTPException } from "hono/http-exception";
import { prisma } from "./db";
import { errorHandler } from "./lib/errors";
import {
  originCheck,
  requireAuth,
  requireLocationAccess,
  requireMfaEnrolment,
  sessionMiddleware,
  type AppEnv,
} from "./middleware/auth";
import { rateLimit, securityHeaders } from "./middleware/security";
import { authRoutes } from "./routes/auth";
import { mfaRoutes, mfaAdminRoutes } from "./routes/mfa";
import { pinRoutes, pinAdminRoutes } from "./routes/pin";
import { adminRoutes, userAdminRoutes } from "./routes/admin";
import { deviceRoutes } from "./routes/devices";
import { masterRoutes } from "./routes/master";
import { areaRoutes } from "./routes/areas";
import { bottleKeepRoutes } from "./routes/bottle-keep";
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

/**
 * Per-request ceiling. Two minutes, not two seconds — see the middleware below
 * for why this is a resource guard rather than a latency budget.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.FNB_REQUEST_TIMEOUT_MS ?? 120_000);

/**
 * `hono/timeout` requires an HTTPException, not our AppError — so the body is
 * built by hand to keep the `{ error, code }` shape every other failure on this
 * server uses. The web client reads `body.error`; a differently-shaped timeout
 * would surface as "[object Object]", which is the exact bug lib/validate.ts
 * exists to prevent.
 */
const timeoutError = () =>
  new HTTPException(504, {
    res: new Response(
      JSON.stringify({ error: "That request took too long and was stopped. Try a narrower range.", code: "TIMEOUT" }),
      { status: 504, headers: { "content-type": "application/json" } },
    ),
  });

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

  /**
   * READINESS, not just liveness.
   *
   * This used to return `{ ok: true }` unconditionally — so it reported healthy
   * while SQLite was locked, corrupt, or the disk was full, which is precisely
   * when the process supervisor and any uptime monitor most need to know. A
   * health check that cannot fail is decoration.
   *
   * One trivial query is enough: it proves the file opens, the schema is
   * readable, and the WAL is not wedged. `busy_timeout=5000` (db.ts) bounds how
   * long this can hang.
   */
  app.get("/api/health", async (c) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return c.json({ ok: true, db: "ok" });
    } catch (err) {
      console.error("[health] database unreachable", err);
      // 503, so a supervisor restarts and a load balancer would drain rather
      // than keep sending traffic at a process that cannot serve it.
      return c.json({ ok: false, db: "unreachable" }, 503);
    }
  });

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
   * A 6-digit code is 10^6 guesses, which is only strong because it is
   * throttled. Its own bucket rather than the login one: a legitimate user
   * mistyping a code must not consume the allowance that stops password
   * guessing, and vice versa.
   */
  app.use(
    "/api/auth/mfa/verify",
    rateLimit({
      id: "mfa",
      limit: LOGIN_RATE_LIMIT,
      windowMs: 15 * 60_000,
      message: "Too many failed codes from this network. Try again in a few minutes.",
      countOnly: (status) => status === 401 || status === 423,
    }),
  );
  /**
   * A ceiling on how long one request may hold a connection.
   *
   * Deliberately generous rather than tight. This is not a latency budget — it
   * exists so a handler blocked on something external cannot hold a slot
   * forever. AI import extraction legitimately runs tens of seconds on a large
   * PDF, so a "sensible" 30s would break real work.
   *
   * Stocky is EXCLUDED and must stay excluded: it is a Server-Sent Events
   * stream (routes/stocky.ts) that is *supposed* to stay open for minutes while
   * the model answers. Timing it out would sever the response mid-sentence and
   * look like a broken feature rather than a protection.
   */
  app.use("/api/*", async (c, next) => {
    if (c.req.path.endsWith("/stocky/chat")) return next();
    return timeout(REQUEST_TIMEOUT_MS, timeoutError)(c, next);
  });

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

  // After sessionMiddleware (there must be a user to inspect) and before every
  // route group (so no path predates the check). The enrolment routes it
  // allows through are mounted on /api/auth for exactly this reason.
  //
  // Scoped to /api/* and NOT pathless: in production this same app serves the
  // built SPA (index.ts), so a pathless guard also refused GET
  // /account/security — the very page the gate sends people to. The user got
  // the raw 403 JSON instead of the enrolment screen, which is as locked out as
  // having no screen at all.
  app.use("/api/*", requireMfaEnrolment);

  app.route("/api/auth", authRoutes);
  app.route("/api/auth", pinRoutes);
  app.route("/api/auth", mfaRoutes);
  app.route("/api/admin", mfaAdminRoutes);
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
    .route("/", areaRoutes)
    .route("/", bottleKeepRoutes)
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
