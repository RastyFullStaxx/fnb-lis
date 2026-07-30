import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

/**
 * Give the desktop its own better-sqlite3, built for Electron's ABI.
 *
 * The problem this solves: better-sqlite3 12.11.1 is a raw-V8 addon, not
 * Node-API, so one build works under exactly one ABI. The repo needs TWO —
 * Node's, for the hosted server and both verify harnesses, and Electron's, for
 * this app. Rebuilding the shared copy in place would silently break
 * `npm run dev` and `verify:seed`.
 *
 * So the root copy stays Node's, and this makes a private Electron-ABI copy
 * under apps/desktop/node_modules, which resolves first from dist/host.mjs.
 *
 * MUST be re-run after every `npm install`: npm owns workspace node_modules and
 * prunes anything it did not install, so the copy disappears. It is also much
 * faster than it sounds — better-sqlite3 publishes Electron prebuilds, so this
 * downloads a binary rather than needing a compiler.
 */

const ELECTRON_VERSION = JSON.parse(readFileSync("package.json", "utf8")).devDependencies.electron.replace(
  /^[^\d]*/,
  "",
);

const src = path.resolve("../../node_modules/better-sqlite3");
const dest = path.resolve("node_modules/better-sqlite3");

if (!existsSync(src)) {
  console.error("better-sqlite3 is not installed at the repo root — run `npm install` first.");
  process.exit(1);
}

mkdirSync(path.dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });

execFileSync(
  "npx",
  [
    "prebuild-install",
    "--runtime=electron",
    `--target=${ELECTRON_VERSION}`,
    "--dist-url=https://electronjs.org/headers",
  ],
  { cwd: dest, stdio: "inherit", shell: process.platform === "win32" },
);

// Prove the two copies actually differ. A silent no-op here is the failure mode
// that matters: the app would then load a Node-ABI binary and die at require()
// time with an unhelpful NODE_MODULE_VERSION error.
const hash = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12);
const rel = "build/Release/better_sqlite3.node";
const rootHash = hash(path.join(src, rel));
const deskHash = hash(path.join(dest, rel));
if (rootHash === deskHash) {
  console.error(`\nFAILED: desktop binary is identical to the Node one (${rootHash}) — the Electron prebuild did not apply.`);
  process.exit(1);
}
console.log(`\nok  node ABI ${rootHash}  |  electron ABI ${deskHash}`);
