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
/**
 * The sync indicator lives IN the app's header, beside Search.
 *
 * It began as a full-width strip that reserved 30px forever, then a corner pill
 * that floated over the content. Both were the same mistake in different sizes:
 * treating desktop status as something bolted onto the app rather than part of
 * it. The header already collects exactly this kind of ambient control — alerts,
 * Stocky, search — so it belongs there and costs no layout at all.
 *
 * Styled with the app's OWN custom properties, not hard-coded colours, so it
 * tracks the design system and any future theme instead of drifting from it.
 */
#lis-syncchip {
  display: inline-flex; align-items: center; gap: .5rem;
  height: 2rem; padding: 0 .625rem; border-radius: .375rem;
  border: 1px solid var(--border); background: var(--background);
  color: var(--muted-foreground);
  /* Matched to the sibling buttons by measurement, not by eye: Geist Variable
     inherited from the app, 0.875rem, and weight 500. The "font" shorthand alone was
     the bug — the shorthand pulled the BODY's weight (400), so the chip read as
     a different typeface next to Stocky and Search at 500. */
  /* No line-height: the chip is a centred flex row, so it changes nothing
     here, and hard-coding a ratio only invented a 0.0005px mismatch with the
     buttons beside it. Inheriting matches them exactly. */
  font-family: inherit; font-size: .875rem; font-weight: 500;
  cursor: default; white-space: nowrap;
}
#lis-syncchip .dot { width: .5rem; height: .5rem; border-radius: 50%; background: #16a34a; flex: none; }
#lis-syncchip.pending .dot { background: #d97706; }
#lis-syncchip.bad .dot { background: var(--destructive, #dc2626); }
#lis-syncchip .label { font-variant-numeric: tabular-nums; }
/* The action appears only when there is something to do — otherwise the chip is
   a read-only status, and a permanently-enabled button invites pointless taps. */
#lis-syncchip button {
  font-family: inherit; font-size: .8125rem; font-weight: 500; cursor: pointer;
  border: 0; background: transparent; padding: 0; color: var(--primary);
  text-decoration: underline; text-underline-offset: 2px; display: none;
}
#lis-syncchip.pending button, #lis-syncchip.bad button { display: inline; }
#lis-syncchip button:disabled { opacity: .6; cursor: default; }
#lis-syncbar .dot { width: .5rem; height: .5rem; border-radius: 50%; background: #4ac47f; flex: none; }
#lis-syncbar.pending .dot { background: #e8b23a; }
#lis-syncbar.bad .dot { background: #ef5a6f; }
#lis-syncbar .spacer { margin-left: auto; }
#lis-syncbar button {
  /* flex:none — otherwise the button stretches to fill the row. */
  flex: none; font: inherit; color: #cfd8f5; background: transparent;
  border: 1px solid #3a4a86; border-radius: .375rem; padding: .125rem .5rem; cursor: pointer;
  line-height: 1.4;
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
/* Only the custom title strip reserves space now. */
:root { --lis-chrome-top: 32px; --lis-chrome-bottom: 0px; }
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
  if (!document.getElementById("lis-chrome-style")) {
    const style = document.createElement("style");
    style.id = "lis-chrome-style";
    style.textContent = CHROME_CSS;
    document.head.appendChild(style);
  }

  if (!document.getElementById("lis-titlebar")) {
    const titlebar = document.createElement("div");
    titlebar.id = "lis-titlebar";
    const t = document.createElement("span");
    t.className = "title";
    t.textContent = "LIS — Inventory Solution";
    titlebar.appendChild(t);
    document.body.prepend(titlebar);
  }

  const panel = document.getElementById("lis-conflicts") ?? (() => {
    const el = document.createElement("div");
    el.id = "lis-conflicts";
    document.body.appendChild(el);
    return el;
  })();

  const ago = (t: number | null) => {
    if (!t) return "not yet";
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
  };

  /** Build the chip once; re-parented rather than rebuilt when React re-renders. */
  function chip(): HTMLElement {
    let el = document.getElementById("lis-syncchip");
    if (el) return el;
    el = document.createElement("div");
    el.id = "lis-syncchip";
    const dot = document.createElement("span");
    dot.className = "dot";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = "Checking…";
    const action = document.createElement("button");
    action.type = "button";
    action.textContent = "Sync now";
    action.addEventListener("click", async () => {
      action.disabled = true;
      const was = action.textContent;
      action.textContent = "Syncing…";
      await fetch("/_desktop/sync-now", { method: "POST" }).catch(() => {});
      action.disabled = false;
      action.textContent = was;
      void refresh();
    });
    el.append(dot, label, action);
    el.addEventListener("dblclick", () => void openConflicts());
    return el;
  }

  /**
   * Put the chip in the header's action group, beside Search.
   *
   * React owns that subtree and re-creates it on navigation, which silently
   * drops anything injected — so this re-attaches rather than assuming one
   * insertion sticks. Falls back to doing nothing if the header is absent
   * (login and landing pages), instead of appending it somewhere arbitrary.
   */
  function place(): boolean {
    const group = document.querySelector("header .ml-auto");
    if (!group) return false;
    const el = chip();
    if (el.parentElement === group) return false;
    group.appendChild(el);
    return true; // newly attached — the caller must refresh it
  }

  async function refresh(): Promise<void> {
    place();
    const el = document.getElementById("lis-syncchip");
    if (!el) return;
    const label = el.querySelector(".label")!;
    try {
      const s = (await fetch("/_desktop/sync").then((r) => r.json())) as {
        queued: number; conflicts: number; lastPushAt: number | null; deviceName: string;
      };
      // Short by default: the header is shared with three other controls, and
      // "all work synced" said nothing an operator needed twice a minute.
      label.textContent =
        s.conflicts > 0 ? `${s.conflicts} to review` : s.queued === 0 ? "Synced" : `${s.queued} to sync`;
      el.className = s.conflicts > 0 ? "bad" : s.queued > 0 ? "pending" : "";
      el.title =
        `${s.deviceName} — ` +
        (s.queued === 0 ? "all work is on the server." : `${s.queued} change(s) not yet sent.`) +
        ` Last sent ${ago(s.lastPushAt)}.` +
        (s.conflicts > 0 ? ` Double-click to review ${s.conflicts}.` : "");
    } catch {
      label.textContent = "Sync unavailable";
      el.className = "bad";
    }
  }

  async function openConflicts(): Promise<void> {
    if (panel.style.display === "block") {
      panel.style.display = "none";
      return;
    }
    const { conflicts } = (await fetch("/_desktop/conflicts").then((r) => r.json())) as {
      conflicts: Array<{ seq: number; method: string; path: string; attempts: number }>;
    };
    panel.innerHTML =
      "<h2>Changes the server wouldn't accept</h2>" +
      '<p class="why">Nothing here has been thrown away. Each one needs a person to decide — usually because someone changed the same record elsewhere, or permissions changed while this computer was offline.</p>' +
      (conflicts.length === 0
        ? '<p class="why">Nothing outstanding.</p>'
        : conflicts
            .map(
              (c) =>
                `<div class="row"><div class="path">${esc(c.method)} ${esc(c.path)}</div>` +
                `<div class="err">Rejected after ${esc(c.attempts)} attempt${c.attempts === 1 ? "" : "s"}.</div>` +
                `<button data-seq="${esc(c.seq)}" class="dismiss" style="margin-top:.5rem">Dismiss</button></div>`,
            )
            .join(""));
    panel.querySelectorAll<HTMLButtonElement>(".dismiss").forEach((b) =>
      b.addEventListener("click", async () => {
        await fetch(`/_desktop/conflicts/${b.dataset.seq}/dismiss`, { method: "POST" });
        b.closest(".row")?.remove();
        void refresh();
      }),
    );
    panel.style.display = "block";
  }

  /**
   * React replaces the header on navigation, so watch for it coming back.
   *
   * Refreshing only when the chip is NEWLY attached matters: the header usually
   * renders after this script runs, so the first `place()` finds nothing and the
   * chip is inserted by the observer instead — leaving it stuck on "Checking…"
   * until the 20-second tick. Refreshing on attach fills it immediately, without
   * firing a fetch on every unrelated DOM mutation.
   */
  new MutationObserver(() => {
    if (place()) void refresh();
  }).observe(document.body, { childList: true, subtree: true });

  void refresh();
  setInterval(() => void refresh(), 20_000);
}

window.addEventListener("DOMContentLoaded", () => {
  if (location.protocol === "file:") return;
  if (location.pathname.startsWith("/_desktop/")) return;
  mountChrome();
});
