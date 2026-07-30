import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";

/**
 * Prove a provisioned mirror computes the SAME numbers as the server.
 *
 * docs/sync-and-data-lifecycle.md §7.5 requires it: the desktop reconciles
 * locally from the same @fnb/core, and if the two ever disagree then the one
 * report the client trusts absolutely contradicts itself depending on which
 * screen it is read from. Counting rows proves nothing about that — only
 * reproducing the pinned anchors off the mirror does.
 *
 * Registers a device, pulls a real snapshot, applies it to a throwaway mirror,
 * and asserts both golden anchors.
 *
 * Needs a running server:
 *   npm run dev -w @fnb/server
 *   MIRROR_URL=http://localhost:3001 MIRROR_USER=owner MIRROR_PASS='Fnb!2026' \
 *     npm run verify:mirror -w @fnb/desktop
 */

const dir = mkdtempSync(path.join(tmpdir(), "fnb-mirror-"));
const dbFile = path.join(dir, "mirror.db");

try {
  await build({
    entryPoints: ["src/provision-test.ts"],
    outfile: "dist/provision-test.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "error",
    external: ["electron", "better-sqlite3", "@prisma/client/runtime/*", "pdfmake", "exceljs", "@foliojs-fork/*"],
    banner: {
      js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
    },
  });

  // Under Electron's own Node, so the Electron-ABI better-sqlite3 loads — the
  // same binary the shipped app uses.
  execFileSync("npx", ["electron", "dist/provision-test.mjs"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      TEST_DB: dbFile,
      TEST_URL: process.env.MIRROR_URL ?? "http://localhost:3001",
      TEST_USER: process.env.MIRROR_USER ?? "owner",
      TEST_PASS: process.env.MIRROR_PASS ?? "Fnb!2026",
    },
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
  console.log(`\n== cleaned up ${dir}`);
}
