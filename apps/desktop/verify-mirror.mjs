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
 *
 * It registers under a FIXED fingerprint, so repeat runs reuse one device
 * rather than burning a licence slot each time — but it still needs ONE free
 * slot. A dev machine that also has the desktop app provisioned therefore needs
 * `Subscription.maxDevices >= 2`; the shipped default is 1, matching §18's "one
 * client computer".
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
} catch (err) {
  // The two commonest failures, neither of which says what to do about it in a
  // DEV context.
  //
  // MFA first: since two-factor became mandatory for OWNER, this harness cannot
  // reach any location-scoped route at all, and the message it surfaces
  // ("isn't allowed to download data yet") points at the wrong thing entirely.
  if (String(err).includes("two-factor") || String(err).includes("MFA_SETUP_REQUIRED")) {
    console.error(
      "\nThis check signs in as OWNER, and that role must hold a second factor\n" +
        "(MFA_REQUIRED_ROLES). Enrolling the demo owner does NOT help — an enrolled\n" +
        "account then needs a CODE to open a device session, which a harness cannot\n" +
        "supply. Start the dev server with enforcement off for this run:\n\n" +
        "  FNB_REQUIRE_MFA=0 npm run dev -w @fnb/server\n",
    );
  } else if (String(err).includes("licence covers")) {
    console.error(
      "\nThis check needs one free licence slot, and the desktop app is probably holding it.\n" +
        "Raise Subscription.maxDevices to 2 for the test client, or revoke the registered computer.",
    );
  }
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
  console.log(`\n== cleaned up ${dir}`);
}
