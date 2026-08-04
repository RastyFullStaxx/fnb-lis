import { appendFileSync } from "node:fs";
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
        // See host.ts — serve-static resolves its root against cwd, which a
        // packaged app inherits from whatever launched it.
        FNB_CWD: app.isPackaged ? process.resourcesPath : path.resolve(here, ".."),
        // Program Files is read-only for the account running the app, so
        // uploads go to the per-user data directory instead of beside the code.
        FNB_UPLOADS_DIR: path.join(dataDir, "uploads"),
      },
      /**
       * Piped to a file, not inherited.
       *
       * Windows gives a packaged GUI app no console, so "inherit" sends every
       * line the server prints — including the stack trace of whatever killed
       * it — straight to nowhere. When the host dies the user sees "exited with
       * code 1" and there is nothing else to look at, on a machine that is
       * usually behind a bar. This is the file to ask for.
       */
      stdio: "pipe",
    });
    const hostLog = path.join(dataDir, "host.log");
    const capture = (chunk: Buffer | string) => {
      try {
        appendFileSync(hostLog, chunk);
      } catch {
        /* diagnostics must never be the reason the app fails to start */
      }
    };
    host.stdout?.on("data", capture);
    host.stderr?.on("data", capture);
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

/**
 * The name the person actually typed on the setup form.
 *
 * Held across the two IPC calls because `setup:finish` used to derive it from
 * the OLD config with a `?? "This computer"` fallback — so a fresh setup, which
 * by definition has no old config, discarded "Front bar PC" and stored the
 * literal placeholder. The sign-in screen then read back "This computer: This
 * computer", and the administrator's device list showed a machine with no
 * distinguishing name at all.
 */
let pendingDeviceName: string | null = null;

ipcMain.handle("setup:register", async (_e, input: SetupInput) => {
  const existing = readConfig();
  pendingDeviceName = input.deviceName?.trim() || null;
  pendingRegistration = await registerDevice(input, existing?.fingerprint);
  return pendingRegistration.result;
});

ipcMain.handle("setup:finish", async (_e, { locationId, locationName }: { locationId: string; locationName: string }) => {
  if (!pendingRegistration) throw new Error("Connect to the server first");
  // Prefer what was just typed, then whatever a previous setup stored, and only
  // then the placeholder.
  const deviceName = pendingDeviceName ?? readConfig()?.deviceName ?? "This computer";
  const cfg = configFrom(pendingRegistration, locationId, locationName, deviceName);

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
    width: 760,
    height: 860,
    autoHideMenuBar: true,
    // Same caption treatment as the main window — a black OS title bar on the
    // FIRST screen anyone sees is the worst place to skip it.
    titleBarStyle: "hidden",
    titleBarOverlay: { color: TITLE_BAR_COLOR, symbolColor: "#e8ecf8", height: TITLE_BAR_HEIGHT },
    backgroundColor: TITLE_BAR_COLOR,
    // See the note on the main window — without this, Windows 11's Mica
    // backdrop wins over backgroundColor and the caption strip renders
    // translucent, showing the desktop wallpaper through it.
    backgroundMaterial: "none",
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadFile(path.join(here, "..", "setup.html"));
}

/**
 * A one-line startup record in userData.
 *
 * Electron discards stdout on Windows, so when a bar PC "opens on the setup
 * screen again" there is otherwise nothing to look at. This is the file to ask
 * for first.
 */
function logStartup(line: string): void {
  try {
    require("node:fs").appendFileSync(
      path.join(dataDir, "startup.log"),
      `${new Date().toISOString()}  ${line}
`,
    );
  } catch {
    /* diagnostics must never be the reason the app fails to start */
  }
}

async function createWindow(): Promise<void> {
  initConfig(dataDir);
  const cfg0 = readConfig();
  logStartup(
    `userData=${dataDir} config=${cfg0 ? "found" : "MISSING"} ` +
      `deviceId=${cfg0?.deviceId ?? "-"} locationId=${cfg0?.locationId ?? "-"} ` +
      `session=${cfg0?.sessionEnc ? "present" : "MISSING"} provisioned=${isProvisioned(cfg0)}`,
  );
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
    /**
     * A floor, because nothing else provides one.
     *
     * The web app is responsive and clean down to ~820px, but an Electron
     * window has no minimum unless you give it one — it can be dragged to a
     * sliver. 880 keeps the sidebar's icon rail plus a readable table; 600 of
     * height keeps a count's item picker and Save on screen together.
     */
    minWidth: 880,
    minHeight: 600,
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
    /**
     * Opt OUT of the Windows 11 backdrop.
     *
     * `backgroundColor` alone did not hold the caption strip: Windows 11 applies
     * a Mica backdrop to that region by default, which is TRANSLUCENT and paints
     * over it — so the 32px above the page rendered as the user's wallpaper with
     * the OS title drawn on top, while `titleBarOverlay` correctly coloured only
     * the button strip on the right. One brand-navy bar with a mismatched
     * translucent half is worse than no styling at all.
     *
     * "none" is the documented switch for "let my own background show".
     */
    backgroundMaterial: "none",
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
  /**
   * Ctrl+R / F5 reload, and Ctrl+Shift+I for devtools.
   *
   * Removing the menu bar took these with it — they are menu accelerators, not
   * built-in browser behaviour — leaving no way to reload short of quitting the
   * app. Re-registered explicitly so the keys people already reach for work,
   * without putting "Force Reload" and "Toggle Developer Tools" back on screen
   * one click from a staff member mid-count.
   */
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key.toLowerCase();
    if (key === "f5" || (input.control && key === "r")) {
      win?.webContents.reloadIgnoringCache();
      event.preventDefault();
    }
    if (input.control && input.shift && key === "i") {
      win?.webContents.toggleDevTools();
      event.preventDefault();
    }
    /**
     * Zoom, for the same reason reload is here.
     *
     * Ctrl+scroll — and pinch, on a bar PC with a touchscreen — still zooms the
     * renderer, but removing the menu took Ctrl+0/+/− with it. Someone who
     * knocks the wheel mid-count is left at 150% with no menu, no shortcut and
     * no way back for the rest of the session; it only clears on restart, and
     * only by accident, because the local server takes a new port each launch
     * so the origin Electron remembers the zoom against is different anyway.
     *
     * Ctrl+0 is the one that matters. The steps are here so the pair someone
     * reaches for after over-zooming both exist.
     */
    if (input.control && !input.shift) {
      const wc = win?.webContents;
      if (!wc) return;
      if (key === "0") {
        wc.setZoomLevel(0);
        event.preventDefault();
      } else if (key === "=" || key === "+") {
        wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 3));
        event.preventDefault();
      } else if (key === "-") {
        wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3));
        event.preventDefault();
      }
    }
  });

  /**
   * Paint the caption strip from the PAGE, because nothing else can.
   *
   * Measured: `getContentBounds().y === getBounds().y`, so the web contents
   * already extend to the very top of the window — there is no reserved strip
   * for `backgroundColor` or `backgroundMaterial` to fill. Windows keeps a
   * caption for the Window Controls Overlay, `titleBarOverlay.color` reaches
   * only the button strip on the right, and the OS paints its own backdrop and
   * window title across whatever the page leaves unclaimed. Hence one bar with
   * two different looks.
   *
   * So the page claims it: a fixed 32px band in the brand navy, marked
   * `-webkit-app-region: drag` so the window still moves by that strip. Injected
   * from here rather than added to the SPA because the same build serves the
   * browser, where there is no caption to cover.
   */
  win.webContents.on("did-finish-load", () => {
    void win?.webContents.insertCSS(`
      html::before {
        content: "";
        position: fixed;
        top: 0; left: 0; right: 0;
        height: ${TITLE_BAR_HEIGHT}px;
        background: ${TITLE_BAR_COLOR};
        z-index: 2147483647;
        -webkit-app-region: drag;
        pointer-events: auto;
      }
    `);
  });

  win.once("ready-to-show", () => {
    win?.show();
    /**
     * Re-apply the caption overlay AFTER the window is shown.
     *
     * The constructor options are honoured on the setup window, which is created
     * visible — but this one is created with `show: false` and revealed later,
     * and in that order Windows had already laid out a default caption by the
     * time the overlay was meant to take effect. The result was a split bar:
     * `titleBarOverlay` coloured the button strip brand navy, while the rest
     * stayed system chrome with the window title drawn across it.
     *
     * Setting it again once the window actually exists on screen makes the whole
     * strip take the same colour. Cheap, idempotent, and it runs once per launch.
     */
    win?.setTitleBarOverlay({
      color: TITLE_BAR_COLOR,
      symbolColor: "#e8ecf8",
      height: TITLE_BAR_HEIGHT,
    });

  });

  // The landing page, same as the web front door. "Open the System" leads to
  // /login, which renders the PIN keypad in place of the username/password form
  // when it detects the desktop — one definition of the sign-in layout, so the
  // desktop cannot drift from the web on the first thing anyone sees.
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
