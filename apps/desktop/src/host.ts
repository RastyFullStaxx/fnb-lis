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

// FNB_DB_FILE is the same override the seed-verification harness uses — the
// server reads it in src/db.ts, so pointing the embedded instance at a local
// mirror needs no change to shared code at all.
process.env.FNB_DB_FILE = dbFile;

const { createApp } = await import("../../server/src/app");
const { initDb } = await import("../../server/src/db");

const app = createApp();
// Capture must wrap every route, so it is registered before serving rather
// than inside createApp — the hosted server must never carry it.
app.use("*", captureWrites(raw));

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

process.parentPort?.on("message", (e) => {
  if ((e.data as { type?: string })?.type === "shutdown") {
    server.close(() => process.exit(0));
  }
});

export { app, raw as localDb, dbFile };
