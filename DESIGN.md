# DESIGN.md — FNB/LIS

**Register:** product. The tool disappears into the task. Earned familiarity over novelty; delight lives in moments (a live weigh calculation, a clean commit), not decoration.

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
- Radius scale, locked: controls 8px, cards/panels 10px, badges/pills full. Nothing above 12px.
- Depth via borders and the `--muted` second neutral, not shadows. Shadows only on floating layers (popover/dialog: `0 8px 24px oklch(0.2 0.03 264 / 0.12)`).
- Tables: sticky header on `--muted`, hairline dividers, hover `--muted/50`, no zebra.

## Motion (design-motion-principles applied)

State, not theater. 150–250 ms, `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-quint family), no bounce.

- Dialog/sheet: 200 ms fade+scale(0.98→1) / slide. Popover/dropdown: 150 ms fade+2px rise.
- Live weigh preview: number transitions with a 150 ms opacity/translate tick — visible feedback that the math ran.
- Row void: 200 ms tint sweep to muted+strikethrough. Commit: button → check morph, then Sonner toast.
- Skeletons shaped like the final layout — never centered spinners. `prefers-reduced-motion`: crossfade only.
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

The authenticated entry surface remains `/login`; no public marketing route is planned until LIS has an approved sales workflow and public proof assets. Its permanent copy is "Welcome back" / "Sign in to continue to your assigned inventory locations" on the form side and "Know what changed between counts" / "Count, review, reconcile, and trace every variance to its source" on the brand side. Remember-me defaults off for shared workplace devices.

## Voice

Plain, specific, calm. "Commit count" not "Submit." "Void with reason" not "Delete." Explain the date rule where it matters: "Activity from Jun 1 up to — not including — Jun 8 (your ending count day)." Errors say what happened and what to do next. No jargon (`STOCK_IN`) outside the activity log's technical detail view.

## Accessibility floor

WCAG AA contrast everywhere (including placeholders and the blue sidebar labels), visible focus rings (`--primary` 2px offset), full keyboard paths on entry screens, `aria-live="polite"` on the weigh preview and recent-entries list, hit targets ≥ 32px.
