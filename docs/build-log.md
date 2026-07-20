# Build log

What shipped, in order, with the findings worth remembering. Planning-era task checklists were
dropped when the work landed — this is the record, not the plan. Hand-computed numbers live in
[golden-fixtures.md](golden-fixtures.md); architectural *why* lives in
[architecture.md](architecture.md) (deviation log).

## Phase 0 — Blueprint (2026-07-02)

Product, design, and architecture locked before any code: PRODUCT.md, DESIGN.md,
architecture.md (portability rules, model inventory, formula appendix, deviation log), and the
phase series. Formulas were verified against the legacy PHP line-by-line *before* being written
down.

## Phase 1 — Foundation (2026-07-03)

npm workspaces (`apps/*`, `packages/*`), **all models on day one** (migrations additive
afterwards), WAL + `busy_timeout` boot pragmas, seed v1 (5 role users, 2 clients, units,
categories with legacy density factors), Hono + session middleware + `/api/auth` with the legacy
lockout rule (5 fails → 1 hour), Vite + React 19 + Tailwind v4 (CSS-first, **no
tailwind.config.js**) + shadcn + Geist, React Router v7 library mode under `/l/:locationId/*`.

## Phase 2 — Master data & location catalog (2026-07-03)

Units (custom, kind + factor), categories (productType + defaultDensityFactor), items/variants
(size + unit, `contentTracked`, tare, density override), per-location catalog with cost/retail
inline edit (ActivityLog old→new), missing-price red badge (legacy behaviour), copy-from-location,
suppliers. **Universality proof:** a "Table Napkins" pack (Supplies, COUNT) behaves identically to
beverages, with weighing fields hidden.

## Phase 3 — The audit cycle (2026-07-03)

The product's heart: rapid count entry (combobox → FULL qty or WEIGH scale → live preview via
`core/weighing` in the browser → Enter saves + refocuses), purchases draft→commit, forfeits,
sales/non-revenue/production, and the **Full Audit report** — half-open `[begin, end)` activity
with counts read ON each boundary date. Committed records became immutable here; edits are
rejected server-side and the UI offers void/correct.

## Phase 4 — Versioned recipes & menu sales (2026-07-03)

Menu sales deplete ingredients through **snapshotted** recipe versions (`recipeVersionId` on the
sale), so editing a recipe changes nothing historical. Revenue share uses legacy `menuTotalServing`
(servings summed across lines regardless of unit) and the discount deduction
`((SRP × disc%) / ingredientCount) × qty`.

## Phase 5 — Report suite & exports (2026-07-03)

Sales, Purchases (+ supplier rollup), Non-Revenue (+ reason rollup), Inventory on Hand
(valuation) — each with a page, an endpoint, and xlsx/CSV export. Listing reports use **inclusive**
`[from, to]`; the half-open window is Full-Audit-only. exceljs workbooks (frozen header, category
groups, red negatives, A4 landscape); CSV via core `toCsv` with a BOM so Excel opens it clean.
Print stylesheets strip app chrome. Drill-down from any Full Audit row reaches the exact source
records. Export is gated on `reports.export`.

## Phase 6 — Imports, deterministic + AI (2026-07-03)

Upload (sha256, ≤20 MB) → parse (papaparse CSV / exceljs XLSX with header heuristics; PDF and
images via Anthropic structured outputs, **env-gated**) → match (exact → `ItemAlias` → fuzzy
Levenshtein ≥0.6) → **human review grid** → commit with `resultType`/`resultId` backlinks → one-click
reverse.

Two behaviours worth knowing: manual matches **write back an `ItemAlias`**, so re-importing the
same vendor's file auto-matches; and **reversal restores the prior report byte-for-byte** (verified
against the golden fixture's variance arrays). Without an API key the CSV/XLSX path works fully and
the PDF path returns a friendly setup notice. COUNTS kind is parked — it needs count-session
semantics.

## Phase 7 — Dashboard, admin & polish (2026-07-04, refined 2026-07-10)

Dashboard driven by a **deterministic next-action resolver** (role permissions + location
readiness + open work) rather than equal-weight launch cards — unfinished counts, import reviews,
and draft deliveries pull the user back before a new workflow is offered. Attention cards deep-link
and are role-gated. Admin: clients/locations CRUD, users (generated credentials, role, client
access, disable, reset — **no deletes**), activity viewer, settings (product types, company info
feeding report branding). Command palette searches real entities.

Analytics (PostHog + Sentry) are **env-gated no-ops** loaded via an indirect specifier, so the
default build carries no dependency and never sends inventory values or PII.

## Phase 8 — Stocky assistant (2026-07-04)

**Design pivot (user request):** Stocky is a working chatbot with **no API key** — a deterministic
rule engine (intent classify → entity/period extraction → same tools → composed answer). A key
transparently upgrades the *same* endpoint to a streaming `claude-sonnet-5` tool loop. This
replaced the planned "no key → setup notice" gate.

Provably read-only: the tool registry (6 tools) imports only report services and core helpers —
no Prisma, no writes. Write requests are refused with a link to the right screen. Every turn is
logged to ActivityLog with `{mode, outcome}`.

## Phase 9 — Transfers & the 2026-07 client round (2026-07-19)

The client's 16-item request list (tracked with status in
[project-overview.md](project-overview.md)) plus inter-location transfers.

**Transfers design.** A `Transfer` is a two-sided document: the **source** drafts lines from its own
catalog and commits on a `businessDate` (stock leaves its pool that day); the **destination**
confirms what actually arrived per line, with its own `receiptDate` (stock joins its pool that day).
Sent and received may differ, and the gap is deliberately left visible as the difference between the
two locations' Transfer reports rather than absorbed into either one's variance. Guards: the
destination must be an ACTIVE location of the **same client**; commit fails if the destination's
modules don't cover a line's product type; receiving auto-creates the destination catalog row for a
shared item variant; corrections use void + `correctionOfId` on lines **and** receipts; and a
transfer or line cannot be voided while an ACTIVE receipt exists against it — the destination voids
first, so the audit trail reads in cause→effect order.

Reconciliation took `transferInQty`/`transferOutQty` as **optional** inputs (`?? 0`), so every
pre-transfer caller — and the sacred fixture — produces bit-identical output.

Also shipped: **Cost Analysis** report (legacy `*_downloadCA`) · per-user **module restrictions** ·
kitchen **NET weighing** · READONLY viewer hardening (20-min absolute sessions, export + watermark
+ "Exported by" footer) · "Variance vs Sold" rename · shared numeric-only `QuantityInput` ·
`Location.kind` labels · public landing + login flyer slots · default text size Large.

The Full Audit export was refactored from 17 hardcoded `getCell(n)` indices to a **declarative
column spec** driving the workbook, the CSV, and the totals row from one array — inserting the two
transfer columns would otherwise have required renumbering every downstream cell.

**Adversarial review round.** A five-dimension review of the finished diff produced 25 findings;
each was verified by hand and the confirmed ones fixed the same day. The notable ones: draft-line
DELETE never checked that the line belonged to the document in the URL (**also true of the
pre-existing `purchases` and `counts` routes** — a cross-tenant reach); the receive endpoint
validated against a pre-transaction snapshot (double-receipt race) and accepted duplicate line ids;
the destination could read the source's unpublished DRAFT; Cost Analysis omitted transfer valuation
(a transfer window showed phantom cost at the source and negative cost at the destination);
cancelling a subscription was a dead end with no way back (added `reactivate`); `Mark as paid`
disappeared exactly when it was needed after a period rollover; a user demoted to READONLY kept
their long session; and NET weighing rounded in scale units, quantizing kitchen counts to whole
ounces.

---

## Phase 10 — UI/UX overhaul & data visualization (2026-07-20)

Full-app design pass driven by a 153-finding audit (6 parallel reviewers against DESIGN.md), then
fixes applied across every page group. The headline pieces:

- **Chart layer** (`apps/web/src/components/charts/`): shared mark vocabulary (bars ≤ 24px, 4px
  rounded data-ends square at the baseline via a custom shape, solid hairline grids, tabular-nums
  ticks), `StatTile` with hand-rolled sparkline, `PeriodColumns` (time/period columns, diverging by
  sign), `MagnitudeBars` (horizontal category bars with end labels). Palette validated with the
  dataviz six-checks tool: the red↔blue diverging pair clears CVD ΔE 27, the blue ramp is a legal
  ordinal ramp — **no theme tokens changed**. Two real chart bugs caught live in the DOM: missing
  `fill` (black bars) and a diverging domain that dropped the zero baseline when all values were
  negative.
- **Trends endpoint** — `GET …/dashboard/trends?periods=N` (`services/trends.ts`): per-audit-period
  rollups computed by re-running `buildFullAudit` over consecutive committed count dates. No new
  math; the golden period reproduces byte-identical totals. Serial execution, capped at 12 periods.
- **Dashboard** — "Audit trends" band (three stat tiles + Sales-by-period / Variance-by-period
  small multiples), variance leaders became drill-through links (`?drill=` opens the Full Audit
  dialog), status-strip hierarchy fixed, boot spinner replaced by a shell-shaped skeleton.
- **Full Audit density redesign** — verdict strip (period variance at cost/retail + items short +
  variance-by-category diverging bars) lands the answer before the 15-column table; two-tier
  grouped headers (Stock movement | Usage | Sold & used | Variance); sticky Item column; toolbar
  search + "Variance only" filter with an honest "n rows hidden — exports include every row" note;
  keyboard-accessible drill rows.
- **Report pages** — every report got its correct chart form per the data's job (sales revenue by
  day, purchases cost by supplier with "Other" fold, non-revenue cost by reason, on-hand value by
  category, cost-analysis net-% bars per section); error states (`TableError`) so an outage never
  reads as "no data"; hub cards carry live latest-period pulses. Listing reports now default to the
  **open period** (last count → today) so new entries are visible on first paint.
- **Landing page** — royal-ink drench, the hero imagery is a truthful Full Audit verdict card
  (golden-fixture numbers), reconciliation formula typeset as the centerpiece. Entrance animation
  keeps a readable from-state (a paused renderer must never show a blank hero).
- **Simulation pass (all roles)** — a 19-check role×endpoint matrix now fully green. Fixed in the
  process: cross-tenant location probes returned 403 (an existence oracle; now 404, matching the
  transfers convention), readonly dashboards told viewers to "finish setup" they can't touch, and
  a delivery-draft hint showed to roles that can't act on it. READONLY watermark, export stamp,
  and staff export-block re-verified live.
- **Subagent fix wave** — 100+ audited fixes across entry/master/admin pages, including a real P0
  (menu sales couldn't save: the button gated on the wrong state variable) and a data-loss-shaped
  P1 (count line edits deleted before re-adding; now add-first). `--warning-text` token added for
  AA-safe amber text; global `prefers-reduced-motion` rule added.

### Phase 10 addendum (2026-07-20, second pass)

- **Sticky-header rendering fix** — the Full Audit's two-row header showed scrolled rows bleeding
  through it (user screenshots): Chrome leaves row backgrounds/borders behind when a `thead`
  sticks under `border-collapse`. Rebuilt as **per-cell sticky** (`th` at `top-0`/`top-10`, cell
  backgrounds, `border-separate border-spacing-0`, borders on cells). Verified by DOM paint
  probes with the scroller engaged.
- **Compact view** for the Full Audit: an 8-column toggle (Item · Begin · End · Usage · Sold ·
  Variance · At cost · At retail) — the whole reconciliation fits with **no horizontal scroll**.
- **`.scrollbar-thin`** utility (6px pill thumb) on every table scroller + the sidebar rail;
  **LIS logo is the favicon**.
- **Sidebar fit**: tightened group padding/label height/menu gaps + `py-1.5` items so the full
  admin nav (14 items, 3 groups) fits a 13" laptop viewport at the Large font — measured
  646/646px, no scroll; hit targets stay ≥ 32px.
- **Client GC requests (Lourd)**: non-revenue encoding collapsed to the three canonical buckets
  (Spoilage & Spillages / Trimming / Marketing & OTH) with per-bucket report tabs + exports —
  legacy reasons fold in via `nonRevenueGroupOf`, unmapped ones (Staff/Internal/Other) appear
  only in the unfiltered view; Sales report gained **Discounted** and **Production** view tabs
  (server `?view=` + exports). Full Audit's Non-Revenue rollup untouched — fixture re-verified.
- Listing-report defaults switched to the **open period** (last count → today) so entries since
  the last count are visible on first paint (deviation #20).

### Phase 10 addendum 2 (2026-07-20, third pass)

- **Client report formats received** (request #11 resolved into a spec): two XLSX examples decoded
  — both share ONE 24-column layout (Shot|Bottle sales split, B-Cost/E-Cost, Used-vs-Sales +
  Overall Variance with non-rev added back, category TOTAL rows, headline Beverage-Cost ratio).
  Full mapping to `ReconRow` + the 11-report status table live in
  [client-report-formats.md](client-report-formats.md); example files copied to `docs/reference/`.
  Four decisions blocked on the client (averaged cost basis, Cost-of-Sold formula, PDF route,
  shot/bottle mapping).
- **Quick wins**: Variance Report hub card (`full-audit?variance=only` pre-arms the filter);
  Transfers card labeled "(Requisition)" to match the client's vocabulary.
- **Full Audit no-horizontal-scroll**: `SidebarInset min-w-0` (one wide child was dragging the
  whole page sideways and hiding the export buttons) + chart containers clip stale measurements +
  Compact-by-default (8 columns, 0px overflow; "All Columns" opt-in with short headers in compact).
- **Adversarial review round 3 (12 agents): 8 confirmed, 8 fixed** — atomic count-line edits via
  the existing PUT (add-then-remove could double-count inventory), honest titles on view/bucket
  exports, negative-bar end-label geometry (traced into recharts source), zero-delta suppression,
  `₱1000K`→`₱1M`, palette `?q=` deep links now actually filter Stock/Recipes/Suppliers.
- **Title Case sweep** (client preference, recorded in DESIGN.md Voice): nav, buttons, tabs,
  column headers, section headings across the app; sentences stay sentences.
- Resolved the merge conflict in `pages/recipes/index.tsx` (kept both: teammate's copy-menus
  feature + palette `?q=` seeding) and fixed the type errors in the teammate's `menus.ts`
  copy-from-location route. Teammate's Top Sellers report noted and left as-is.

## Phase 11 — Client report suite (2026-07-20, evening)

The client's two sample XLSX files + 11-report list turned into working software in one pass
(spec + decisions: [client-report-formats.md](client-report-formats.md)):

- **Legacy 24-column layout** (`services/report-suite.ts` → `legacyAuditReport`): one dataset
  serves both *Detailed Full Audit* and *Inventory Report* (only title + headline cost ratio
  differ — exactly like the client's own files). All 24 columns project from `ReconRow`
  (one additive core echo: `purchasedCost` — golden fixture re-verified byte-identical).
  Formulas verified against the legacy PHP (`fnb-main` reports controller + ACOST procedure)
  AND regression-tested against the sample files' own numbers. Exported from the Full Audit
  page's new "Client Formats" menu (XLSX with two-row merged headers / CSV / PDF).
- **Four new reports** with pages + XLSX/CSV/PDF: Beginning/Ending Cost (weighted-average
  purchase cost basis with per-row fallback flags), Forfeited Bottles, Usage Cost, and
  Sales by Item (Shot & Bottle). All are projections — no new reconciliation math.
- **PDF everywhere**: pdfmake 0.2 generic table renderer (`services/pdf.ts`) + per-report
  adapters; dedicated PDF button beside Excel/CSV on every report page. Cost Analysis and
  Top Sellers PDFs deferred (multi-section layouts).
- **Non-Revenue completed** per client #8: UOM + Est. Retail columns across screen and all
  exports, plus the **Stock Transfer** fourth tab (transfer-out lines at cost & retail — the
  legacy presentation of transfers, fed from our first-class Transfer records).
- **Variance Report** (#10) finished: `?variance=only` now filters the screen AND every export
  format, with subset totals recomputed from surviving rows.
- Resolved the teammate's merge conflict (recipes) and their `menus.ts` type errors; Top Sellers
  kept as-is. Live verification: legacy GRAND TOTAL cross-foots the golden fixture exactly
  (18,561.50 / 16,699.70 / 7,248.54 / 17,520 / −330.69 / −869.57), averaging basis visibly
  correct on the Ending Cost page (Absolut ₱615 avg vs ₱620 price), PDFs and XLSX magic bytes
  verified, typecheck green both workspaces.

## Contributor history

| Window | Who | What |
|---|---|---|
| 2026-06-26 → 07-12 | Rasty (owner) | Phases 0–8: the whole build, plus UI/design passes |
| 2026-07-09 → 07-10 | JjByteX | UI fixes (segmented controls, sidebar), login redesign |
| 2026-07-18 → 07-19 | JjByteX | Subscription/plans/clients arc: `Subscription`, `SubscriptionModule`, `LocationModule`, billing state, clients admin UI. A Plan catalog was added (`dd51046`) then fully reverted (`5af9668`) |
| 2026-07-19 | Claude session | Phase 9 (above) + audit and remediation of the arc |

**Audit outcome for the JjByteX arc** — what held and what didn't, so it isn't re-litigated:

- **Held:** route authorization (all admin endpoints ADMIN-only), `$transaction` + ActivityLog on
  every mutation, SQLite portability, seed idempotency, `packageType` derived server-side (the
  badge can't drift), and a clean Plan-catalog revert with no dangling references.
- **Fixed:** the `mark as paid` fix in `fd8f84b` accepted payments across a ~2-month window, so one
  payment showed the next month as paid (see golden-fixtures §4); `+32 days` mis-stepped over
  February for month-end anchors; billing logic was hand-duplicated in server and web (now one
  source in `@fnb/core/billing`); `mark-paid` had no status guard; orphaned, drifted zod schemas in
  core were unused by the route that defined its own copies.
- **Collateral found:** repo typecheck was failing (stale generated Prisma client + a missing
  `cancelledAt` on the web `AdminSubscription` type), and `npm run db:seed` failed against the live
  DB on leftover catalog rows violating the module guardrail (history-free, removed).
