# @fnb/desktop — the offline local mirror

The Electron desktop from proposal §18. It runs the **same** Hono server and the
**same** React SPA as the web app, against a local SQLite mirror, and syncs.

Design and rules: [../../docs/sync-and-data-lifecycle.md](../../docs/sync-and-data-lifecycle.md).
Read §7 before changing anything here.

## Shape

```
Electron main (main.ts)          window only — no DB work on this thread
  └─ utilityProcess (host.ts)    the real Hono server + local SQLite + sync
       ├─ migrate.ts             applies Prisma migrations without the CLI
       ├─ sync/capture.ts        records local writes into the outbox
       └─ sync/engine.ts         push → reconcile → ack → pull
renderer                         apps/web, unmodified, over http://127.0.0.1
```

## Why the server is in a utility process, not the renderer

Not a preference — two hard constraints:

- **Prisma 7.8 has no query engine binary.** It compiles queries with a ~3.5 MB
  WASM module built via a *synchronous* `new WebAssembly.Module()`. Chromium
  forbids sync WASM compilation above 4 KB on a document thread, so this code
  cannot run in a renderer at all.
- **better-sqlite3 is a native addon** (and a raw-V8 one, not N-API — see below).

Main process would technically work, but the same 3.5 MB compile plus every
SQLite query would block the UI thread and freeze the window during a Full Audit.

## Run this after every `npm install`

```bash
npm run native -w @fnb/desktop
```

`better-sqlite3` 12.11.1 is compiled against raw V8, **not** Node-API, so one
build works under exactly one ABI — and this repo needs two: Node's for the
hosted server and both verify harnesses, Electron's for this app. Rebuilding the
shared copy in place would silently break `npm run dev` and `verify:seed`.

So `native.mjs` gives the desktop its own private copy under
`apps/desktop/node_modules` and fetches the Electron prebuild into it (a
download, not a compile — no build tools needed). It then asserts the two
binaries differ, because a silent no-op there fails much later with an
unhelpful `NODE_MODULE_VERSION` error.

**It must be re-run after every `npm install`**: npm owns workspace
`node_modules` and prunes anything it did not install, so the copy disappears.

## Dev loop

```bash
npm run build -w @fnb/web     # the renderer is served from apps/web/dist
npm run dev  -w @fnb/desktop  # bundles the server, then launches Electron
```

### Debugging startup

Electron detaches stdout on Windows, so a crash in the utility process leaves
**no output at all** — you get the "LIS could not start" dialog and nothing else.
Run the bundle directly under Electron's own Node to see the real error:

```bash
ELECTRON_RUN_AS_NODE=1 FNB_DB_FILE=<mirror.db> FNB_LOCAL_DB=<mirror.db> FNB_MIGRATIONS_DIR=../server/prisma/migrations FNB_WEB_DIST=../web/dist npx electron dist/host.mjs
```

The mirror lives at `%APPDATA%/@fnb/desktop/mirror.db`.

## What is deliberately NOT here

- **No forked SPA.** The renderer is `apps/web` verbatim. Every API path in it is
  root-relative, so pointing it at the local origin needs no code change — and
  keeping it identical is what stops the desktop drifting from the browser on
  validation, permissions and activity logging.
- **No second write path.** Push replays the ordinary create routes; there is no
  desktop-only API.
- **No Prisma CLI.** See `migrate.ts` — shipping 60 MB of tooling to run some
  `CREATE TABLE` statements is not defensible, and the checksums it writes are
  byte-compatible with the CLI's.

## Status

**It launches.** The window opens, the utility process migrates a fresh mirror
(22 migrations, 38 tables, no Prisma CLI), the embedded Hono server listens on
127.0.0.1, and the SPA loads and renders against it — `/api/health` OK,
`/api/auth/me` correctly 401 with no session.

## Gotcha: the preload must be CommonJS

`dist/preload.cjs`, not `.mjs`, and the build treats it differently for that
reason. **Electron only supports ESM preload scripts when `sandbox: false`.**
With sandboxing on — which is what we want, since the renderer runs the same SPA
a browser does — an `.mjs` preload is *silently ignored*: no error, no warning,
the script simply never runs and the status bar never appears.

## Still to do before this ships

- `electron-builder` config, code signing, and `asarUnpack` for the
  Electron-ABI `better_sqlite3.node`.
- Licence enforcement at startup (proposal §20).
- Edit-and-retry in the conflict inbox — it currently lists and dismisses.
