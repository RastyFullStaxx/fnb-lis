# DESIGN.md — FNB/LIS

**Register:** product. The tool disappears into the task. Earned familiarity over novelty; delight lives in moments (a live weigh calculation, a clean commit), not decoration.

**Frictionless is a first-class priority.** Every screen must feel instant and anchored: the app chrome (sidebar, topbar) and each page's own chrome (title, action buttons, filter toolbar) stay fixed while only the data scrolls. Nothing the user reaches for should scroll out from under them, no navigation should jump the layout, and no load should block the view. Speed and stillness are features — treat them as such.

## Design read

Operational software for people counting bottles at 2 AM and accountants signing off on variance. It must read as **calm, precise, premium** — closer to Linear/Stripe than to a legacy admin panel. Royal blue is the identity; white is the canvas; data is the hero.

## Color

Strategy: **Restrained** — neutral surfaces, one committed accent. OKLCH, defined as shadcn theme tokens in `apps/web/src/index.css`.

| Token | Value | Use |
|---|---|---|
| `--primary` | `oklch(0.488 0.217 264)` (royal blue ≈ #3A56E4) | Primary actions, active nav, focus rings, selection |
| `--primary-foreground` | `oklch(0.985 0 0)` | Text on primary |
| `--background` | `oklch(1 0 0)` (white) | Page canvas |
| `--muted` | `oklch(0.972 0.004 264)` | Blue-tinted panel/second neutral (sidebar rail, table headers) |
| `--foreground` | `oklch(0.19 0.015 264)` | Ink — near-black with a blue cast |
| `--muted-foreground` | `oklch(0.46 0.02 264)` | Secondary text — must stay ≥ 4.5:1 on white |
| `--border` | `oklch(0.916 0.008 264)` | Hairlines |
| `--destructive` | `oklch(0.55 0.2 25)` | Voids, blocking errors, **negative variance** |
| Success | `oklch(0.55 0.15 155)` | Commits, in-stock, sync OK |
| Warning | `oklch(0.62 0.15 75)` | Low-confidence matches, missing prices, CONTENT_EXCEEDS_SIZE |

Rules: one accent — royal blue — locked across every screen. Semantic colors appear only as state (badge, row tint, inline message), never decoration. Charts (Recharts): primary blue for the main series, `--muted-foreground` for comparisons, destructive red reserved for negative variance. No gradients on controls; no purple; no glassmorphism.

**Sidebar** is the one Committed surface: deep royal ink `oklch(0.28 0.09 264)` with white/70 labels, white active item on `--primary`. It brands every screen without shouting.

## Typography

One family: **Geist Variable** (`@fontsource-variable/geist`), with **Geist Mono** only for record IDs/hashes. Fixed rem scale, ratio ≈1.2:

- Page title 20/28 semibold · Section 16/24 semibold · Body & controls 14/20 · Table cells 14/20 · Caption/meta 12/16 · Display numbers (dashboard stats, weigh preview) 28/34 semibold
- **Every numeric cell uses `tabular-nums`** and right-alignment. Currency: `₱1,650.00` (two decimals, thin thousands separators).
- `text-wrap: balance` on empty-state headings; 65ch cap on prose (help/explainers).

## Space, shape, depth

- Spacing grid 4px; page gutter 24px; card padding 16–20px; dense table rows 40px, forms 8px gaps.
- **Page width is consistent across every route.** Page content fills the `main` container (its `p-6` gutter is the only inset) — no per-page `max-w-[…]` cap or `mx-auto` centering on the top-level page wrapper. A page that constrains its own width sits narrower than its siblings and reads as a bug. Constrain width *within* a page (prose at 65ch, a form column) never at the page root.
- Radius scale, locked: **controls, badges, pills and chips all share the 8px control radius (`rounded-md`)** — same roundness as buttons, for one consistent corner across every small element; cards/panels 10px. Nothing above 12px. `rounded-full` is reserved for genuinely circular elements only — avatars, status dots, loading indicators, the switch track/thumb, scrollbars — never for text pills.
- Depth via borders and the `--muted` second neutral, not shadows. Shadows only on floating layers (popover/dialog: `0 8px 24px oklch(0.2 0.03 264 / 0.12)`).
- Tables: sticky header on `--muted`, hairline dividers, hover `--muted/50`, no zebra.

## Page skeleton & uniformity

**The goal: navigating between pages feels like the content swaps under a fixed frame — title, controls, and data table never move.** Every list/report page is built from the same three stacked parts, in the same order, at the same position. Only the contents change. This is what makes the app feel frictionless and fast — the eye never re-hunts for where things are.

- **Header** — `PageHeader`: title (left) + the page's primary action button(s) (right), on **every** page. **All create/receive/import/export buttons live in this title row — never in the toolbar strip**, so the same action sits in the same spot on every page (tabbed pages included; the button just changes label per active tab). **No subtitle.** Explanatory prose belongs in docs/help, empty states, or tooltips — not stacked under every title where it pushes the data down. One `text-xl` title, always at the same y-position.
- **Data surface** — `TableSurface`: one bordered, rounded card. Segmented **tabs (first), then search (`ToolbarSearch`), then filters** are fused into a single `border-b bg-muted/30` toolbar at the top of the card — never a control strip or tab row floating in the gap above the table. The toolbar's right slot is only for controls that *operate the strip's own filters* (e.g. Apply/Clear on a server-submitted filter); page actions never go here. This keeps the body at the same y-position on every page, tabbed or not. Loading and empty states render *inside* the surface (`TableLoading`, `TableEmpty`) so the toolbar stays put and only the body swaps.
- **Tabs live in the toolbar, not above it.** A page with tabs (Purchases, Sales, Items) puts its `TabsList` in the toolbar's left slot (before any search); the active tab's body renders inside the surface, and the tab's primary action sits in the title row. Table bodies render flush; form/workspace bodies (Sales entry, Returned bottles) get `bodyClassName="p-4"` and drop their own outer border so the surface reads as one card. Never leave tabs as a separate row that pushes the table down.
- **Search/filter earns its place by table size, not uniformity.** Add a toolbar search/filter when a table can grow past ~15–20 rows or is inherently unbounded; below that, a search box over a handful of rows is dead chrome. The *frame* is always identical (same surface, radius, position); the *controls* appear only when they do real work. Client-side filtering is fine for the small reference tables.
- **No nested or stacked panels.** One bordered surface per page area — never a panel inside a panel, and never two bordered cards stacked. Content inside a surface (a form, a "recent" list, a two-column workspace) is written **directly into the main area** — borderless, separated by whitespace or a single hairline divider (`border-l`/`border-t`), never wrapped in its own card. A boxed thing inside a boxed thing reads as visual debris.
- **Fixed chrome, scrolling data.** The app shell is exactly one viewport tall (`h-svh`); the topbar is pinned and the content area scrolls, never the window. On a single-table page the page root is a flex column (`flex min-h-0 flex-1 flex-col`): the title row and toolbar are fixed, and the `TableSurface` fills the remaining height (`flex-1`) with **only its table body scrolling** — the table header stays pinned (`sticky top-0`) so column labels never leave. Tables therefore self-size to the screen: natural up to the viewport, then scroll internally. Pages that are more than one table (dashboard, workspaces, reports with a summary below) scroll as a whole under the fixed topbar — that's expected; the single-table pattern is the default for list pages.
- **Secondary blocks** — rollups/summaries (e.g. "by supplier", "by reason") render as a flat section *below* the surface: a small `text-sm font-semibold` heading + a bare table or inline stat row, **no card wrapper**. The primary table is always the first thing under the header.

## Motion (design-motion-principles applied)

State, not theater. 150–250 ms, `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-quint family), no bounce.

- Dialog/sheet: 200 ms fade+scale(0.98→1) / slide. Popover/dropdown: 150 ms fade+2px rise.
- Live weigh preview: number transitions with a 150 ms opacity/translate tick — visible feedback that the math ran.
- Row void: 200 ms tint sweep to muted+strikethrough. Commit: button → check morph, then Sonner toast.
- Skeletons shaped like the final layout — never centered spinners. `prefers-reduced-motion`: crossfade only.
- **Loading bar:** a slim (2px) royal-blue indeterminate bar pinned to the top of the viewport (`TopProgress`, driven by React Query's global fetching count) is the one global load cue on every navigation/data fetch — it appears the instant a fetch starts and clears the moment data lands. In-place skeletons handle the body; the top bar handles the "something is happening" signal. No route-level spinners or full-page blockers.
- No page-load choreography, no infinite loops, max one animated attention cue per screen.

## Components (shadcn/ui, one vocabulary)

Buttons: primary (filled blue) / secondary (outline) / ghost (toolbars) / destructive (voids — always behind an AlertDialog with a required reason field). One primary per view. Labels above inputs; helper text present; errors below in destructive; no placeholder-as-label. Icons: lucide-react at 16px/`strokeWidth 1.75` in controls, 20px in nav.

Signature patterns:
- **Operational dashboard**: a border-separated status strip answers audit stage, latest committed count, auditable period, unresolved work, and data freshness. One role- and state-aware primary action leads; delivery, sale, and import remain compact secondary actions. Attention shares one panel with the next action, while variance and location-only activity occupy the lower row. New locations see a three-step setup checklist instead of empty variance chrome.
- **Rapid-entry pane** (counts/sales/purchases): left = form column with autofocused item combobox, Enter commits line and refocuses; right = "recent entries" list (modernized legacy live preview) + running totals.
- **Weigh calculator**: scale input with unit suffix; beneath it a computed strip — `(812 g − 478 g) × 30.12 → 673 ml · 0.96 of 700 ml` — updating live; blocking error when scale < tare, amber note when content exceeds container.
- **Report table**: sticky first column + header, category group rows, negative variance rows tinted `destructive/8%` with red variance text, click-through drill-downs, print stylesheet (A4 landscape, repeating header, no chrome).
- **Match badges** (imports): EXACT (blue), ALIAS (blue outline), FUZZY n% (amber), UNMATCHED (red outline).
- **Empty states teach**: icon, one sentence, one primary action ("No counts yet — start your first count").

The dashboard never shows four equal launch cards or an unqualified "All clear." Its next-action precedence is open count → unmatched import → purchase draft → empty catalog → beginning count → missing prices → Full Audit → next count → read-only reports. Variance leaders expose direction, percentage, cost, and retail values as semantic text; magnitude bars are supplementary only.

The authenticated entry surface remains `/login`. A public marketing landing now lives at `/` (client request, 2026-07: tagline "Your partner in inventory management", Facebook link + promo-video slots as placeholders until LIS sends the assets); signed-in visitors hitting `/` are bounced to their dashboard. The login page's brand panel can show a per-module flyer via `/login?m=bar|kitchen` once the flyer files land in `src/assets/flyers/`. Its permanent copy is "Welcome back" / "Sign in to continue to your assigned inventory locations" on the form side and "Know what changed between counts" / "Count, review, reconcile, and trace every variance to its source" on the brand side. Remember-me defaults off for shared workplace devices.

## Voice

Plain, specific, calm. "Commit count" not "Submit." "Void with reason" not "Delete." Explain the date rule where it matters: "Activity from Jun 1 up to — not including — Jun 8 (your ending count day)." Errors say what happened and what to do next. No jargon (`STOCK_IN`) outside the activity log's technical detail view.

## Accessibility floor

WCAG AA contrast everywhere (including placeholders and the blue sidebar labels), visible focus rings (`--primary` 2px offset), full keyboard paths on entry screens, `aria-live="polite"` on the weigh preview and recent-entries list, hit targets ≥ 32px.
