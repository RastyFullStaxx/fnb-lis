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

## Before this runs: rebuild the native module

`better-sqlite3` 12.11.1 is compiled against raw V8, **not** Node-API, so it is
locked to one `NODE_MODULE_VERSION` and must be rebuilt for Electron's ABI:

```bash
npm run rebuild-native -w @fnb/desktop
```

Note the `--module-dir ../..`: npm workspaces hoist `better-sqlite3` to the
**repo root**, and `@electron/rebuild` defaults to scanning the app directory —
so without that flag it finds nothing and silently rebuilds zero modules. Re-run
it after every Electron version bump.

## Dev loop

```bash
npm run dev -w @fnb/desktop
```

Bundles the server with esbuild, then launches Electron. It serves the SPA from
`apps/web/dist`, so run `npm run build -w @fnb/web` first (or point the window at
the Vite dev server while iterating on UI).

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

## Still to do before this ships

- IPC handlers for the three `preload.ts` methods, and the renderer-side status
  banner and conflict inbox that consume them.
- The PIN unlock screen, with the **local** lockout counter (5 attempts / 1 hour,
  mirroring the server) and offline events pushed via `/sync/ack`.
- First-run provisioning flow: register the device, pick the location, pull the
  first snapshot.
- `electron-builder` config, code signing, and `asarUnpack` for the rebuilt
  `better_sqlite3.node`.
- Run the golden fixtures against a device mirror — docs §7.5 requires the
  desktop and the server to agree on the numbers, and that comparison is the
  only thing that proves it.
