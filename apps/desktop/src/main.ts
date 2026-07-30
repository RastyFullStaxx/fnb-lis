import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, utilityProcess, type UtilityProcess } from "electron";
import { decryptSession, initConfig, isProvisioned, readConfig, writeConfig } from "./config";
import { configFrom, fetchSnapshot, registerDevice, type SetupInput } from "./provision";

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

/** `--sidebar` from apps/web/src/index.css, converted from oklch(0.28 0.09 264). */
const TITLE_BAR_COLOR = "#112555";
const TITLE_BAR_HEIGHT = 32;

let host: UtilityProcess | null = null;
let win: BrowserWindow | null = null;

function startHost(): Promise<number> {
  const cfg = readConfig();
  return new Promise((resolve, reject) => {
    host = utilityProcess.fork(path.join(here, "host.mjs"), [], {
      env: {
        ...process.env,
        FNB_LOCAL_DB: localDb,
        FNB_MIGRATIONS_DIR: migrationsDir,
        FNB_UNLOCK_HTML: path.join(here, "..", "unlock.html"),
        // Everything the sync engine and the unlock screen need. The device
        // session is decrypted HERE and handed over in the child's env rather
        // than left on disk in the clear — safeStorage lives in the main
        // process, and the utility process has no business reading config.json.
        FNB_REMOTE_URL: cfg?.remoteUrl ?? "",
        FNB_DEVICE_COOKIE: decryptSession(cfg?.sessionEnc) ?? "",
        FNB_DEVICE_ID: cfg?.deviceId ?? "",
        FNB_DEVICE_NAME: cfg?.deviceName ?? "This computer",
        FNB_CLIENT_ID: cfg?.clientId ?? "",
        FNB_LOCATION_ID: cfg?.locationId ?? "",
        FNB_LAST_PULL_AT: cfg?.lastPullAt ?? "",
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

/**
 * Setup runs in the MAIN process, not the utility process, for one reason: it
 * must work before the local server exists. On first run there is no mirror
 * worth serving and no session to serve it with.
 */
let pendingRegistration: Awaited<ReturnType<typeof registerDevice>> | null = null;

ipcMain.handle("setup:register", async (_e, input: SetupInput) => {
  const existing = readConfig();
  pendingRegistration = await registerDevice(input, existing?.fingerprint);
  return pendingRegistration.result;
});

ipcMain.handle("setup:finish", async (_e, { locationId, locationName }: { locationId: string; locationName: string }) => {
  if (!pendingRegistration) throw new Error("Connect to the server first");
  const cfg = configFrom(pendingRegistration, locationId, locationName, pendingRegistration.result.deviceId
    ? (readConfig()?.deviceName ?? "This computer")
    : "This computer");

  const payload = await fetchSnapshot(
    pendingRegistration.remoteUrl,
    pendingRegistration.result.cookie,
    locationId,
  );

  // Config is written only AFTER the snapshot downloads. Writing it first would
  // leave a machine that believes it is provisioned but holds nothing — and the
  // app would then boot into an empty mirror instead of back into setup.
  const applied = await applyFirstSnapshot(payload);
  writeConfig({ ...cfg, lastPullAt: (payload.meta as { generatedAt?: string })?.generatedAt });

  // Relaunch into the app proper. Simpler and more honest than hot-swapping the
  // window: the server has to start against a mirror that now has content.
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 900);
  return applied;
});

/**
 * Applies the first snapshot by asking the utility process to do it — the
 * mirror is opened there, and two processes writing one SQLite file is the
 * corruption case WAL does not save you from.
 */
async function applyFirstSnapshot(payload: Record<string, unknown>): Promise<{ total: number }> {
  const proc = utilityProcess.fork(path.join(here, "host.mjs"), ["--apply-snapshot"], {
    env: {
      ...process.env,
      FNB_LOCAL_DB: localDb,
      FNB_DB_FILE: localDb,
      FNB_MIGRATIONS_DIR: migrationsDir,
      FNB_WEB_DIST: webDist,
      FNB_APPLY_ONLY: "1",
    },
    stdio: "inherit",
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out writing the downloaded data")), 120_000);
    proc.on("message", (m: { type?: string; total?: number; error?: string }) => {
      if (m?.type === "applied") {
        clearTimeout(timer);
        proc.kill();
        resolve({ total: m.total ?? 0 });
      } else if (m?.type === "applyError") {
        clearTimeout(timer);
        proc.kill();
        reject(new Error(m.error ?? "Could not save the downloaded data"));
      }
    });
    proc.on("spawn", () => proc.postMessage({ type: "applySnapshot", payload }));
  });
}

/** The setup window — shown when this machine has never been provisioned. */
async function createSetupWindow(): Promise<void> {
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 720,
    height: 820,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadFile(path.join(here, "..", "setup.html"));
}

async function createWindow(): Promise<void> {
  initConfig(dataDir);
  // Unprovisioned: no server yet, because there is nothing worth serving.
  if (!isProvisioned(readConfig())) {
    await createSetupWindow();
    return;
  }

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

  /**
   * No File/Edit/View/Window/Help bar.
   *
   * Those are Electron's stock menu, not ours, and every entry in them is
   * either irrelevant to an inventory terminal or actively unwanted on one —
   * "Toggle Developer Tools" and "Force Reload" sitting one click away from a
   * staff member mid-count. The app is a single full-screen workspace with its
   * own navigation; a desktop menu bar adds a second, contradictory one.
   *
   * Windows/Linux only. macOS requires an application menu for the standard
   * edit accelerators to work at all, so it keeps the default there. On Windows
   * Chromium handles Ctrl+C/V/X/A inside text fields natively, so removing the
   * menu costs nothing.
   */
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    // Belt and braces: also stops the bar reappearing on Alt.
    autoHideMenuBar: true,
    /**
     * Royal blue title bar instead of the OS default black.
     *
     * Electron gives no way to recolour a NATIVE caption, so this hides it and
     * draws native window controls as an overlay — the buttons stay real
     * (snap layouts, tooltips, accessibility) while the strip takes our colour.
     *
     * The colours are the design tokens converted from oklch, not eyeballed:
     * `--sidebar: oklch(0.28 0.09 264)` is #112555. Picking a "close enough"
     * blue is exactly how a product ends up with five slightly different brand
     * colours.
     */
    titleBarStyle: "hidden",
    titleBarOverlay: { color: TITLE_BAR_COLOR, symbolColor: "#e8ecf8", height: TITLE_BAR_HEIGHT },
    backgroundColor: TITLE_BAR_COLOR,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
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

  // The PIN screen first, not the SPA. It is served by the LOCAL server so the
  // session cookie it sets belongs to the same origin the app then runs on;
  // loading it off disk would put it on file:// where no cookie would stick.
  await win.loadURL(`http://127.0.0.1:${port}/_desktop/unlock.html`);
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
