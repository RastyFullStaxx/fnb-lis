import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { initDb } from "./db";
import { createApp } from "./app";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");

// .env lives next to package.json (also read by the Prisma CLI).
const envPath = path.join(serverRoot, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

mkdirSync(path.join(serverRoot, "data", "uploads"), { recursive: true });

const app = createApp();

// Production: serve the built SPA from apps/web/dist (single origin, no CORS).
const webDist = path.resolve(serverRoot, "..", "web", "dist");
if (existsSync(webDist)) {
  const relDist = path.relative(process.cwd(), webDist);
  app.use("*", serveStatic({ root: relDist }));
  app.use("*", serveStatic({ root: relDist, path: "index.html" }));
}

const port = Number(process.env.PORT ?? 3001);

await initDb();
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[fnb-lis] API listening on http://localhost:${info.port}`);
});
