import { cpSync, mkdirSync } from "node:fs";
import { build } from "esbuild";

/**
 * Assets the server resolves from `import.meta.url`.
 *
 * `exports.ts` and `pdf.ts` both do
 * `new URL("../assets/lis-logo.png", import.meta.url)` and read it at MODULE
 * SCOPE — so once bundled, that resolves next to the bundle instead of next to
 * the source, and the whole server dies on first import with an ENOENT nobody
 * would connect to a logo.
 *
 * Copying beats patching the server: those paths are correct for the hosted
 * app, and rewriting them to satisfy a bundler would put desktop concerns into
 * shared code. `dist/host.mjs` sits in `dist/`, so `../assets` lands here.
 */
mkdirSync("assets", { recursive: true });
cpSync("../server/src/assets", "assets", { recursive: true });

// `imports.ts` resolves an uploads dir the same way; AI file imports need
// somewhere to land, and it is created eagerly by the server at boot.
mkdirSync("data/uploads", { recursive: true });

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
  /**
   * Give bundled CommonJS a real `require`.
   *
   * ESM has no `require`, so esbuild substitutes a shim that throws "Dynamic
   * require of X is not supported". Several dependencies are CJS and call
   * `require("crypto")` lazily at module scope — exceljs does, and it takes the
   * whole server down on first import. Rebuilding `require` from
   * `import.meta.url` satisfies them without giving up the ESM output that the
   * generated Prisma client and the server's top-level `await` both need.
   */
  banner: {
    js: `import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);`,
  },
  external: [
    "electron",
    // Native addon — must resolve to the .node rebuilt for Electron's ABI and
    // left unpacked outside the asar. Bundling it is not possible.
    "better-sqlite3",
    // ~4.7 MB of base64 WASM. Inlining it would bloat the bundle and defeat
    // any lazy load; it resolves from node_modules at runtime.
    "@prisma/client/runtime/*",
    /**
     * Document libraries that read their OWN data files off `__dirname` —
     * fontkit's `data.trie`, pdfkit's .afm font metrics. Bundling rewrites
     * `__dirname` to the bundle's directory, so those reads fail at import time
     * and take the whole server down. Chasing each file with a copy step is a
     * losing game; leaving these external keeps their paths self-consistent.
     *
     * They are declared as dependencies of THIS workspace so they resolve from
     * apps/desktop — pdfmake in particular is not hoisted, it lives under
     * apps/server/node_modules where a desktop bundle could never find it.
     */
    "pdfmake",
    "exceljs",
    "@foliojs-fork/*",
  ],
};

await Promise.all([
  build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.mjs" }),
  /**
   * The preload is CommonJS, alone among these three.
   *
   * Electron only supports ESM preload scripts when `sandbox: false`. With
   * sandboxing ON — which is what we want, since the renderer runs the same SPA
   * a browser does and needs no Node — an `.mjs` preload is **silently ignored**:
   * no error, no warning, the script simply never runs. That failure cost an
   * hour of "why is the status bar not appearing".
   */
  build({
    ...common,
    entryPoints: ["src/preload.ts"],
    outfile: "dist/preload.cjs",
    format: "cjs",
    banner: {},
  }),
  // The server + sync engine, run in a utilityProcess. See src/host.ts for why
  // it cannot live in the renderer.
  build({ ...common, entryPoints: ["src/host.ts"], outfile: "dist/host.mjs" }),
]);
