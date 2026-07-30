import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, utilityProcess, type UtilityProcess } from "electron";

/**
 * Electron main: owns the window, forks the server, and does nothing else.
 *
 * All database and API work lives in the utility process (see host.ts) so the
 * ~3.5 MB Prisma WASM compile and every SQLite query stay off this thread — a
 * Full Audit must not freeze the window.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** Per-user, outside the install directory — survives an app update. */
const dataDir = app.getPath("userData");
const localDb = path.join(dataDir, "mirror.db");
const migrationsDir = app.isPackaged
  ? path.join(process.resourcesPath, "migrations")
  : path.resolve(here, "..", "..", "server", "prisma", "migrations");
/** The built SPA — the same bundle the hosted server serves in production. */
const webDist = app.isPackaged
  ? path.join(process.resourcesPath, "web")
  : path.resolve(here, "..", "..", "web", "dist");

let host: UtilityProcess | null = null;
let win: BrowserWindow | null = null;

function startHost(): Promise<number> {
  return new Promise((resolve, reject) => {
    host = utilityProcess.fork(path.join(here, "host.mjs"), [], {
      env: {
        ...process.env,
        FNB_LOCAL_DB: localDb,
        FNB_MIGRATIONS_DIR: migrationsDir,
        // Set HERE, in the parent, not inside host.ts. The server reads
        // FNB_DB_FILE at module-init time (apps/server/src/db.ts), and esbuild
        // inlines dynamic imports — so an assignment inside the child would be
        // racing its own bundle's initialisation order. Getting that wrong
        // points the desktop at the DEVELOPER'S database, silently.
        FNB_DB_FILE: localDb,
        FNB_WEB_DIST: webDist,
      },
      stdio: "inherit",
    });
    const timer = setTimeout(() => reject(new Error("Local server did not start in time")), 30_000);
    host.on("message", (msg: { type?: string; port?: number }) => {
      if (msg?.type === "listening" && msg.port) {
        clearTimeout(timer);
        resolve(msg.port);
      }
    });
    host.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Local server exited with code ${code}`));
    });
  });
}

async function createWindow(): Promise<void> {
  let port: number;
  try {
    port = await startHost();
  } catch (err) {
    // A dead local server means no data at all, so it must be loud. Silently
    // showing an empty app would look like "the bar sold nothing tonight".
    const { dialog } = await import("electron");
    dialog.showErrorBox(
      "LIS could not start",
      `The local database service failed to start.\n\n${err instanceof Error ? err.message : String(err)}`,
    );
    app.quit();
    return;
  }

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(here, "preload.mjs"),
      // The renderer is the untrusted surface even though we wrote it: it runs
      // the same SPA a browser does, and nothing there needs Node.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Loaded over http from the local server, NOT file://. Two reasons: the SPA's
  // API calls are root-relative, so a real origin makes them resolve with no
  // code change; and the session cookie needs an http origin — cookies are not
  // set on file://.
  // Listener BEFORE loadURL: `ready-to-show` fires during the load, so
  // attaching it afterwards means it has already gone and the window never
  // appears — a running app with no UI, which looks exactly like a crash.
  win.once("ready-to-show", () => win?.show());
  await win.loadURL(`http://127.0.0.1:${port}/`);
  // Belt and braces: if the event was somehow missed, still show rather than
  // leave the user staring at nothing.
  if (!win.isVisible()) win.show();
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  host?.postMessage({ type: "shutdown" });
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => host?.postMessage({ type: "shutdown" }));

// Single instance: two copies against one SQLite file is the corruption case
// WAL does not save you from, and §18 sells this as one computer anyway.
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
