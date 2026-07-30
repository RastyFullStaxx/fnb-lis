import { contextBridge, ipcRenderer } from "electron";

/**
 * The only bridge between the SPA and the desktop.
 *
 * Deliberately tiny. The SPA is the same code the browser runs and must stay
 * that way — anything richer here becomes a fork of the web app, and the whole
 * argument for embedding the real server was that there is one write path to
 * get right.
 *
 * Note what is NOT exposed: no filesystem, no database handle, no arbitrary
 * IPC. The renderer talks to the local server over HTTP exactly as a browser
 * would, so it needs nothing else.
 */
/**
 * First-run setup only. Exposed on every page because the setup HTML is loaded
 * before the SPA exists; the SPA never calls it.
 */
contextBridge.exposeInMainWorld("lisSetup", {
  register: (input: unknown) => ipcRenderer.invoke("setup:register", input),
  finish: (input: unknown) => ipcRenderer.invoke("setup:finish", input),
});

contextBridge.exposeInMainWorld("lis", {
  isDesktop: true,
  /** Sync state for the status banner: last sync, queue depth, conflicts. */
  syncStatus: () => ipcRenderer.invoke("sync:status"),
  /** Ask for a sync now (the engine also runs on its own schedule). */
  syncNow: () => ipcRenderer.invoke("sync:now"),
  /** Entries the server refused, for the conflict inbox. */
  conflicts: () => ipcRenderer.invoke("sync:conflicts"),
});
