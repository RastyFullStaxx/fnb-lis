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

contextBridge.exposeInMainWorld("lis", { isDesktop: true });

/**
 * The sync status bar and conflict inbox, injected into the page.
 *
 * Injected rather than built into apps/web on purpose. This is desktop CHROME,
 * not application content — it is meaningless in a browser, where there is no
 * queue and no mirror. Adding it to the SPA would mean shipping dead UI to every
 * web user and, worse, forking the renderer the desktop was specifically
 * designed to reuse verbatim.
 *
 * It talks to the local server over plain fetch on the same origin, so it needs
 * no privileged bridge at all.
 */
const CHROME_CSS = `
#lis-syncbar {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 2147483000;
  display: flex; align-items: center; gap: .75rem; padding: .375rem .75rem;
  font: 12px/1.4 "Segoe UI", system-ui, sans-serif; color: #e8ecf8;
  background: #16255c; border-top: 1px solid #2b3c78;
}
#lis-syncbar .dot { width: .5rem; height: .5rem; border-radius: 50%; background: #4ac47f; flex: none; }
#lis-syncbar.pending .dot { background: #e8b23a; }
#lis-syncbar.bad .dot { background: #ef5a6f; }
#lis-syncbar .spacer { margin-left: auto; }
#lis-syncbar button {
  font: inherit; color: #cfd8f5; background: transparent;
  border: 1px solid #3a4a86; border-radius: .375rem; padding: .1875rem .5rem; cursor: pointer;
}
#lis-syncbar button:hover { border-color: #6f8bff; }

/* Make room for the desktop chrome by SHRINKING THE APP, not by padding the
   body.
 *
 * Padding the body was the first attempt and it was wrong: the shell is sized
 * with h-svh (100svh), so adding padding made the document taller than the
 * viewport — a second, outer scrollbar beside the app's own, and a header
 * scrolled half out of view. Reducing the height the shell is measured against
 * keeps exactly one scroll container, which is what the SPA was built for.
 */
:root { --lis-chrome-top: 32px; --lis-chrome-bottom: 30px; }
.h-svh { height: calc(100svh - var(--lis-chrome-top) - var(--lis-chrome-bottom)) !important; }
.min-h-dvh { min-height: calc(100dvh - var(--lis-chrome-top) - var(--lis-chrome-bottom)) !important; }
/* The fixed sidebar is pinned with inset-y-0, so it would still run under both
   strips without this. */
[data-slot="sidebar-container"], .fixed.inset-y-0 {
  top: var(--lis-chrome-top) !important;
  bottom: var(--lis-chrome-bottom) !important;
  height: auto !important;
}

/* The native caption is hidden so it can take our colour, which means the page
   now owns that strip — including the ability to drag the window. */
#lis-titlebar {
  position: fixed; top: 0; left: 0; right: 0; height: var(--lis-chrome-top); z-index: 2147483001;
  display: flex; align-items: center; gap: .5rem; padding: 0 .75rem;
  background: #112555; color: #cfd8f5;
  font: 12px/1 "Segoe UI", system-ui, sans-serif;
  -webkit-app-region: drag; user-select: none;
}
#lis-titlebar .title { font-weight: 600; letter-spacing: .01em; }
/* Everything sits below the title strip. */
body > #root { margin-top: var(--lis-chrome-top); }
#lis-conflicts {
  position: fixed; inset: auto 0 2rem 0; max-height: 60vh; overflow: auto; z-index: 2147483000;
  background: #0f1b47; border-top: 1px solid #2b3c78; padding: 1rem; display: none;
  font: 13px/1.5 "Segoe UI", system-ui, sans-serif; color: #e8ecf8;
}
#lis-conflicts h2 { font-size: 1rem; margin: 0 0 .25rem; }
#lis-conflicts .why { color: #a8b3d8; font-size: 12px; margin: 0 0 1rem; }
#lis-conflicts .row { border: 1px solid #2b3c78; border-radius: .5rem; padding: .625rem .75rem; margin-bottom: .5rem; }
#lis-conflicts .path { font-family: ui-monospace, monospace; font-size: 12px; color: #9fb0e8; }
#lis-conflicts .err { color: #ffc9d1; font-size: 12px; margin-top: .25rem; }
`;

/**
 * Escape before interpolating into markup.
 *
 * The method and path come from this machine's own outbox, so they are not
 * attacker-controlled in any realistic sense — but they ARE request-derived
 * strings rendered into innerHTML, and "trusted because we wrote it" is how
 * that assumption stops being true later. Cheap to do, so do it.
 */
const esc = (v: unknown) =>
  String(v).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );

function mountChrome(): void {
  if (document.getElementById("lis-syncbar")) return;

  const style = document.createElement("style");
  style.textContent = CHROME_CSS;
  document.head.appendChild(style);

  const titlebar = document.createElement("div");
  titlebar.id = "lis-titlebar";
  // textContent, not innerHTML — nothing here is dynamic, so no reason to open
  // that door at all.
  const t = document.createElement("span");
  t.className = "title";
  t.textContent = "LIS — Inventory Solution";
  titlebar.appendChild(t);
  document.body.prepend(titlebar);

  const bar = document.createElement("div");
  bar.id = "lis-syncbar";
  bar.innerHTML =
    '<span class="dot"></span><span id="lis-sync-text">Checking…</span>' +
    '<span class="spacer"></span>' +
    '<button id="lis-conflict-btn" style="display:none"></button>' +
    '<button id="lis-sync-btn">Sync now</button>';
  document.body.appendChild(bar);

  const panel = document.createElement("div");
  panel.id = "lis-conflicts";
  document.body.appendChild(panel);

  const ago = (t: number | null) => {
    if (!t) return "not yet";
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
  };

  async function refresh(): Promise<void> {
    try {
      const s = (await fetch("/_desktop/sync").then((r) => r.json())) as {
        queued: number;
        conflicts: number;
        lastPushAt: number | null;
        deviceName: string;
      };
      const text = document.getElementById("lis-sync-text")!;
      // The queue depth is the honest signal, not a green tick: "offline" is
      // this app's normal state, and what an operator needs to know is how much
      // work has not reached the server yet.
      text.textContent =
        s.queued === 0
          ? `${s.deviceName} · all work synced · last sent ${ago(s.lastPushAt)}`
          : `${s.deviceName} · ${s.queued} change${s.queued === 1 ? "" : "s"} waiting to sync · last sent ${ago(s.lastPushAt)}`;
      bar.className = s.conflicts > 0 ? "bad" : s.queued > 0 ? "pending" : "";

      const cbtn = document.getElementById("lis-conflict-btn")!;
      cbtn.style.display = s.conflicts > 0 ? "" : "none";
      cbtn.textContent = `${s.conflicts} need${s.conflicts === 1 ? "s" : ""} attention`;
    } catch {
      document.getElementById("lis-sync-text")!.textContent = "Sync service unavailable";
      bar.className = "bad";
    }
  }

  document.getElementById("lis-sync-btn")!.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    b.textContent = "Syncing…";
    await fetch("/_desktop/sync-now", { method: "POST" }).catch(() => {});
    b.disabled = false;
    b.textContent = "Sync now";
    void refresh();
  });

  document.getElementById("lis-conflict-btn")!.addEventListener("click", async () => {
    const open = panel.style.display === "block";
    if (open) {
      panel.style.display = "none";
      return;
    }
    const { conflicts } = (await fetch("/_desktop/conflicts").then((r) => r.json())) as {
      conflicts: Array<{ seq: number; method: string; path: string; attempts: number }>;
    };
    panel.innerHTML =
      "<h2>Changes the server wouldn't accept</h2>" +
      '<p class="why">Nothing here has been thrown away. Each one needs a person to decide — usually because someone changed the same record elsewhere, or permissions changed while this computer was offline.</p>' +
      conflicts
        .map(
          (c) =>
            `<div class="row"><div class="path">${esc(c.method)} ${esc(c.path)}</div>` +
            `<div class="err">Rejected after ${esc(c.attempts)} attempt${c.attempts === 1 ? "" : "s"}.</div>` +
            `<button data-seq="${esc(c.seq)}" class="dismiss" style="margin-top:.5rem">Dismiss</button></div>`,
        )
        .join("");
    panel.querySelectorAll<HTMLButtonElement>(".dismiss").forEach((b) =>
      b.addEventListener("click", async () => {
        await fetch(`/_desktop/conflicts/${b.dataset.seq}/dismiss`, { method: "POST" });
        b.closest(".row")?.remove();
        void refresh();
      }),
    );
    panel.style.display = "block";
  });

  void refresh();
  setInterval(() => void refresh(), 20_000);
}

// Only on the SPA — the setup and unlock pages have their own chrome.
window.addEventListener("DOMContentLoaded", () => {
  if (location.pathname.startsWith("/_desktop/")) return;
  mountChrome();
});
