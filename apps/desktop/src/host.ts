import path from "node:path";
import { serve } from "@hono/node-server";
import Database from "better-sqlite3";
import { migrateLocal } from "./migrate";
import { OUTBOX_DDL } from "./sync/outbox";
import { captureWrites } from "./sync/capture";

/**
 * The embedded server, running in an Electron **utilityProcess**.
 *
 * Not the renderer, and this is a hard constraint rather than a preference.
 * Prisma 7.8 has no Rust query engine: it compiles queries with a ~3.5 MB WASM
 * module instantiated through a SYNCHRONOUS `new WebAssembly.Module()`
 * (apps/server/src/generated/prisma/internal/class.ts). Chromium forbids
 * synchronous WASM compilation above 4 KB on a document thread, so this code
 * physically cannot run in a renderer. better-sqlite3 is also a native addon,
 * which a renderer should not be loading either.
 *
 * Not the main process either: the same 3.5 MB compile plus every SQLite query
 * would block the UI thread, so a Full Audit would freeze the window.
 */

const dbFile = process.env.FNB_LOCAL_DB!;
const migrationsDir = process.env.FNB_MIGRATIONS_DIR!;

/**
 * Pin the working directory before anything reads it.
 *
 * `serve-static` takes a RELATIVE root and resolves it against `process.cwd()`
 * at request time. In dev that is apps/desktop and everything lines up, but a
 * packaged app inherits cwd from whatever launched it — a Start Menu shortcut
 * with a different "Start in", or a terminal in another folder, and every
 * request for the SPA 404s while the API keeps working. That failure looks like
 * a blank window, not a path bug.
 */
if (process.env.FNB_CWD) process.chdir(process.env.FNB_CWD);

// Migrate BEFORE the Prisma client opens the file, so the schema the client
// introspects is the one it expects.
const result = migrateLocal(dbFile, migrationsDir);
if (result.applied.length > 0) {
  console.log(`[fnb-desktop] applied ${result.applied.length} migration(s): ${result.applied.join(", ")}`);
}

// The outbox lives in the same file but outside Prisma's schema, so a snapshot
// merge can never touch it.
const raw = new Database(dbFile);
raw.exec(OUTBOX_DDL);

/**
 * Apply-only mode, used during first-run setup.
 *
 * The mirror is written from THIS process even then, because two processes
 * writing one SQLite file is the corruption case WAL does not protect against.
 * Exits without starting a server: at setup time there is no session to serve
 * requests with anyway.
 */
if (process.env.FNB_APPLY_ONLY === "1") {
  const { applySnapshot } = await import("./sync/apply-snapshot");
  process.parentPort?.on("message", (e) => {
    const data = e.data as { type?: string; payload?: Record<string, unknown> };
    if (data?.type !== "applySnapshot" || !data.payload) return;
    try {
      const result = applySnapshot(raw, data.payload);
      console.log(`[fnb-desktop] first snapshot applied: ${result.total} rows`);
      process.parentPort?.postMessage({ type: "applied", total: result.total });
    } catch (err) {
      process.parentPort?.postMessage({
        type: "applyError",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
} else {

// FNB_DB_FILE is set by the PARENT (main.ts), not here — the server reads it at
// module-init time and esbuild inlines dynamic imports, so assigning it in this
// file would race its own bundle's initialisation order.
const { createApp } = await import("../../server/src/app");
const { initDb } = await import("../../server/src/db");
const { serveStatic } = await import("@hono/node-server/serve-static");

  const { verifyPassword } = await import("../../server/src/auth/password");
  const { createSession, SESSION_COOKIE } = await import("../../server/src/auth/session");
  const { desktopRoutes, drainPinEvents, LOCKOUT_DDL } = await import("./desktop-routes");
  const { cycle } = await import("./sync/engine");

  raw.exec(LOCKOUT_DDL);

  const app = createApp();
  // Capture must wrap every route, so it is registered before serving rather
  // than inside createApp — the hosted server must never carry it.
  app.use("*", captureWrites(raw));

  const remote = {
    baseUrl: process.env.FNB_REMOTE_URL ?? "",
    locationId: process.env.FNB_LOCATION_ID ?? "",
    cookie: process.env.FNB_DEVICE_COOKIE ?? "",
  };

  /**
   * One sync cycle: push → reconcile → ack → pull.
   *
   * Failures are swallowed on purpose. Being offline is the NORMAL state for
   * this app, not an error — surfacing a toast every 5 minutes because the bar's
   * wifi is down would train people to ignore the one that matters. The banner
   * shows the queue depth instead, which is the honest signal.
   */
  const runSync = async () => {
    if (!remote.baseUrl) return { skipped: "not configured" };
    const events = drainPinEvents(raw);
    // No cursor from the environment any more. It was read once at boot and
    // never written back, so `since` stayed at whatever first-run setup saw for
    // the life of the install. The engine now keeps it in the mirror, next to
    // the outbox, and advances it only after a merge actually lands.
    return cycle(raw, remote, {}, events);
  };

  // Desktop-only routes, mounted BEFORE the static handlers so /_desktop/* is
  // never swallowed by the SPA fallback.
  app.route(
    "/",
    desktopRoutes({
      db: raw,
      deviceId: process.env.FNB_DEVICE_ID ?? "",
      deviceName: process.env.FNB_DEVICE_NAME ?? "This computer",
      clientId: process.env.FNB_CLIENT_ID ?? "",
      locationId: remote.locationId,
      verifyPassword,
      createSession,
      sessionCookieName: SESSION_COOKIE,
      onSync: runSync,
    }),
  );

// Serve the SPA. `createApp()` deliberately does not do this — on the hosted
// server it lives in index.ts — so the desktop wires its own, pointed at the
// packaged bundle. Without it the window loads a 404.
  const webDist = process.env.FNB_WEB_DIST!;
  const relWeb = path.relative(process.cwd(), webDist).split(path.sep).join("/");
  app.use("*", serveStatic({ root: relWeb }));
// SPA fallback: deep links like /l/:id/counts are client-side routes with no
// file behind them, so anything unmatched returns index.html.
  app.use("*", serveStatic({ root: relWeb, path: "index.html" }));

  await initDb();

// Port 0 = let the OS pick a free one. A fixed port would collide with anything
// else on the machine, and the renderer is told the real one over IPC.
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
    // 127.0.0.1, never 0.0.0.0: this serves a full copy of an establishment's
    // books with no network authentication in front of it beyond the session
    // cookie, and it must not be reachable from the bar's wifi.
    process.parentPort?.postMessage({ type: "listening", port: info.port });
    console.log(`[fnb-desktop] local API on http://127.0.0.1:${info.port}`);
  });

  /**
   * Background sync every five minutes.
   *
   * Frequent enough that a shift's work is rarely more than one cycle behind,
   * infrequent enough not to hammer a bar's connection. The first run is
   * delayed so it never competes with startup — the window opening quickly
   * matters more than syncing three seconds sooner.
   */
  setTimeout(() => {
    void runSync().catch(() => {});
    setInterval(() => void runSync().catch(() => {}), 5 * 60 * 1000);
  }, 15_000);

  process.parentPort?.on("message", (e) => {
    if ((e.data as { type?: string })?.type === "shutdown") {
      server.close(() => process.exit(0));
    }
  });
}
