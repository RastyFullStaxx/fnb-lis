import { build } from "esbuild";

/**
 * Bundle the Hono server (and the desktop's own main/host code) to ESM.
 *
 * The server has never been compiled — apps/server runs through tsx, and
 * tsconfig.base.json sets `noEmit: true`, so `tsc` cannot emit from it as
 * configured. On top of that the Prisma 7 `prisma-client` generator emits
 * TypeScript, not JavaScript: apps/server/src/generated/prisma is ~3.5 MB of
 * .ts. Shipping tsx into a packaged app would mean compiling all of that on
 * every cold start, so a real bundle step is mandatory.
 *
 * ESM, not CJS, and that is not a style choice: the generated client uses
 * `import.meta.url` and the server uses top-level `await`, both of which a CJS
 * output turns into errors.
 */

/** @type {import("esbuild").BuildOptions} */
const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
  external: [
    "electron",
    // Native addon — must resolve to the .node rebuilt for Electron's ABI and
    // left unpacked outside the asar. Bundling it is not possible.
    "better-sqlite3",
    // ~4.7 MB of base64 WASM. Inlining it would bloat the bundle and defeat
    // any lazy load; it resolves from node_modules at runtime.
    "@prisma/client/runtime/*",
  ],
};

await Promise.all([
  build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.mjs" }),
  build({ ...common, entryPoints: ["src/preload.ts"], outfile: "dist/preload.mjs" }),
  // The server + sync engine, run in a utilityProcess. See src/host.ts for why
  // it cannot live in the renderer.
  build({ ...common, entryPoints: ["src/host.ts"], outfile: "dist/host.mjs" }),
]);
