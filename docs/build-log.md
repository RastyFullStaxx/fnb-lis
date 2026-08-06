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

## Phase 11 addendum — inventory cost basis (2026-07-20, late)

Client answered the open questions: keep the new VAT treatment; offer both averaging and
non-averaging cost ("may accountant na gusto based sa original price, meron naman na average").
Verification before building surfaced two real defects, both fixed:

- **The Cost Reports disagreed with the Full Audit.** Same date, same quantities, ₱16,699.70 vs
  ₱16,589.47 — a ₱110 gap an accountant would read as a bug. Both now resolve through one basis
  and tie exactly (verified: 16,699.70 = 16,699.70 on PRICE, 16,663.61 = 16,663.61 on AVERAGE).
- **The averaging was the wrong figure.** It averaged purchase lines only, so Absolut's 14.25
  units were valued entirely at a single 6-unit purchase (₱615), ignoring 8.25 units of opening
  stock. Now true periodic weighted average — `(opening + purchases) ÷ total units` — giving
  ₱618.38 for Absolut and ₱44.67 for San Miguel, both matching hand computation.

Adversarial review (15 agents, 10 confirmed / 2 refuted) then caught five more, all fixed: the WAC
purchase cutoff was inclusive while the audit window is half-open (a purchase dated on the
beginning count inflated opening value *and* counted again as a period purchase — now `< asOfDate`);
transfer-in receipts were excluded from the average pool despite being costed stock-ins (now
included at the dispatching location's unit cost); a computed average of 0 could override a real
catalog cost (now only a positive average wins, matching core); Stocky's on-hand tool was hardcoded
to PRICE and contradicted the report page it links to; and the cost-basis GET sat behind
`master.write`, so non-editors saw "Purchase Price" regardless of the real policy. The review also
flagged, correctly, that deviation #21 overclaimed — the Beginning/Ending Cost reports *do* restate
(that is the intended fix); the doc now says so.

Shipped: `Client.costBasis` (migration `20260720121446_client_cost_basis`, default `PRICE` — the
Full Audit and golden fixtures unchanged), `services/valuation.ts` (weighted average as of a date),
optional `begin/endValuationUnitCost` on `ReconItemInput` (valuation columns only — variance is
structurally unable to read them), a Settings section with the policy explained, ActivityLog on
every change, and the basis stamped into export filenames *and* in-file headers so two files with
the same title can never be confused. Deviations #21–23. Golden fixture byte-identical on the
default basis; variance/usage/non-revenue costs bit-identical under both bases.

## Phase 12 — Supplier contact & payment terms (2026-07-20, night)

Client req: "sa Purchase report pala lagay din natin options info ng supplier, contact details at
kung ano terms ng payment nila (C.O.D, 7, or 15 days)". `Supplier` gained structured
`contactPerson / phone / email / address / paymentTerms` (migration
`20260720181110_supplier_contact_terms`; the freeform `contactInfo` is kept as Notes so nothing is
lost). Terms vocabulary lives in `@fnb/core PAYMENT_TERMS` — C.O.D. / 7 / 15 / 30 Days / Prepaid,
TEXT not enum per the SQLite rule, with a `PAYMENT_TERMS_DAYS` map ready for future due-date work.
Editable on the Suppliers page (which now shows Contact / Phone / Terms columns); the Purchase
report's By-Supplier rollup and its XLSX, CSV and PDF exports all carry the details.

Caught while verifying: the rollup keyed by supplier NAME, and the seed data contains two distinct
suppliers sharing "Metro Beverage Distribution" — that would have merged one vendor's spend and
contact details into another. Now keyed by supplier ID.

## Phase 13 — Demo seed depth (2026-07-21)

The app only ever held one hand-built audit period, so most surfaces demoed as empty states:
Casa Verde had no committed counts at all, trend charts had nothing to trend, and the Full Audit
showed 4 of the Main Bar's 12 catalog rows.

**`prisma/seed-demo.ts`** now stacks five audit periods (2026-06-15 → 07-20) across Main Bar,
Kitchen, Depot and Casa Verde, plus a live open period on 07-20/07-21 so the reports that default
to *last count → today* are not blank on arrival. Suppliers carry the full contact block spread
across the whole `PAYMENT_TERMS` vocabulary, with one inactive vendor so the status filter has
something to filter.

Two things make it authorable rather than emergent:

- **Variances are declared, not discovered.** Since `variance = expected − usage` and
  `usage = begin + in − end`, setting the closing count to `begin + in − consumed + v` makes `v`
  exactly the variance the report will show. `VARIANCE_PLAN` names which item is off in which
  period; everything else reconciles clean.
- **Jitter is a seeded LCG, not `Math.random`.** A reseed reproduces the same numbers, so
  hand-checks and screenshots in these docs don't go stale.

The fixture layer is untouched: nothing is written on or before 2026-06-15 at Main Bar or Depot.
Fixtures 1 and 2 were captured before the change and re-verified byte-identical after, on both
cost bases.

**Three defects the realistic data exposed**, none visible against the old single-period seed:

1. **Transfers weren't in the ledger.** The transfer pass and the count pass were independent, so
   every transferred bottle read as a variance (+12 and +18 exactly). The ledger now reads back
   committed transfer lines for each window rather than restating the quantities, so the two
   passes cannot drift.
2. **A 0.1 oz scale step can't express the millilitre a movement implies** (~3 ml per step), so
   every weighed row carried a hairline variance. Readings are now chosen at 0.01 oz, which
   recomputes to the exact intended millilitre.
3. **`variance !== 0` is the wrong test** — see below.

### `hasVariance` (core)

A weighed quantity is `full + content / size`, and 700 ml is not representable in binary, so a
period that reconciles *perfectly* lands on ~1e-16 rather than zero. The four places testing
`variance !== 0` — the Variance Only filter, the Variance Report route, and the variance-only
export — therefore listed items that balance exactly as exceptions, displaying "0.00" in the
variance column. All four now use `hasVariance()` (`VARIANCE_EPSILON = 1e-6`). The smallest
variance a human can cause is one millilitre, ~0.0014 of a 700 ml bottle — three orders of
magnitude above the threshold, so nothing real is suppressed. Measured on the live 07-14 → 07-20
period: 6 rows listed before, 3 after; the suppressed three were 8.9e-16, 8.9e-16 and 1.8e-15.
No computed number changes — this is a filter predicate, not reconciliation math — and the
fixtures were re-verified after it landed.

### Duplicate supplier

Two suppliers shared the name "Metro Beverage Distribution". Not a seed bug: during live testing of
the Phase 12 fields, the contact form was submitted against **Bar Essentials Supply** carrying
Metro's details *and* its name. Repaired by restoring the row rather than deleting it — it owns
`DRAFT-BAR-001`, and Bar Essentials is one of the four vendors the seed intends to exist. Logged to
ActivityLog with before/after. The ID-keyed rollup from Phase 12 meant reports stayed correct
throughout.

## Phase 14 — Variance highlight & report breakdowns (2026-07-21)

The client's 2026-07-21 GC message brought five asks; a coverage audit (12-agent fan-out, each
finding adversarially re-verified) sorted them into three builds and two parks.

**A — Over/short materiality highlight.** New pure predicate `@fnb/core varianceSeverity(row)`:
content-tracked items are material at `|variancePct| ≥ MATERIAL_VARIANCE_PCT` (11%), 1:1 whole-unit
items at `|variance| ≥ 1` (a single bottle is the finding; content items with zero usage fall back
to the same absolute rule). Material **short = red, over = amber** — richer than the legacy's
sign-only red, which the client *believed* was an 11% rule but never was (it was `$short < 0 →
"danger"`; there was no legacy formula to port). Drives the Full Audit **row tint on screen** and,
in **every download** (modern Full Audit *and* the legacy Detailed/Inventory format, all of
xlsx/csv/pdf), a **row fill + a "Flag" column** — the Flag carries the finding into CSV, which can't
hold a colour, and makes Excel sortable on it. Sibling of `hasVariance`: reads only computed
outputs, moves no reconciliation number; golden fixtures re-verified (deviation #25).

**B — Non-revenue "Other / Unspecified".** The encode select gained a fourth option so a user can
record a plain input without forcing one of the three buckets — but it's a *named* reason, never a
null, so nothing escapes the audit trail. The Non-Revenue report's breakdown now rolls up by the
**canonical bucket** (`nonRevenueGroupOf`) instead of the raw reason label, so mixed legacy data
(Complimentary, Spillage, Staff use…) collapses into its parent bucket / Other. Full Audit rollup
untouched.

**C — Sales regular-vs-discounted.** `salesReport` gained a `byPriceType` split derived from
`discountPct > 0` (no schema change, no toggle — the split is automatic). The Sales page shows a
**By Price Type** strip (Regular vs Discounted: count / qty / net) plus **Total Discount Given**;
the Sales Excel/CSV carry a matching block. Full Audit revenue stays a single figure.

**D (barcode) and E (offline count → upload) parked** with specs in
[project-overview.md](project-overview.md) — barcode is greenfield and cheap (keyboard-wedge HID,
nothing to "install"); offline is the deferred Electron phase plus the parked `COUNTS` import kind.

Both workspaces typecheck clean.

**Threshold as a per-establishment setting (same day).** The client asked to make the 11% tunable and
per-tenant. Added `Client.varianceThresholdPct` (migration `20260721072637`, default 11) with a
GET/PUT on `/settings/variance-threshold` — read-only for report viewers, `master.write` to change,
scoped by `assertClientAccess` (so a system ADMIN can set any establishment's, a MANAGER only their
own). `varianceSeverity(row, thresholdPct)` now takes the value; the screen threads it via a
`useVarianceThreshold` hook and the exports via `ReportMeta.varianceThresholdPct` / `thresholdOf(c)`.
A *Variance Highlight Threshold* control sits in Settings next to the cost basis. Verified live per
tenant: at 15% Butter (−11.4%) drops, at 30% only the 1-bottle-off Salmon survives — and the
`STANDALONE`-style caution doesn't apply here, this is a plain Float policy. The one real bug during
the build was mine: `contentTracked` is *not* a whole-unit discriminator (kitchen NET items and the
beer bottle are both content-tracked=false), which first hid Butter/Cooking Oil's material shorts —
fixed by making the % and ±1 rules additive.

**Demo seeder loaded for the new features.** The fixture layer is sacred, so the enrichment went in
the demo layer (`seed-demo.ts`, additive + idempotent, dated inside the open period): an
**"Other / Unspecified"** non-revenue on each sales location so the By-Bucket breakdown shows all four
buckets (legacy Staff/Internal-use rows fold into Other too), and **distinct per-tenant thresholds**
(Prime 11%, Casa Verde 8%) so the new setting shows variety. Golden fixtures re-verified after the
reseed — Main Bar Jun 1–8 still −₱330.69.

## Phase 15 — Open-amount counts, Par Level & Non-Moving reports (2026-07-21)

A second batch of client notes. One was a confirm-and-extend, two were net-new reports.

**Open-amount count entry (client note #1).** The client wanted to record an open item "by weight
without liquid/tare weight." The tare-free path already existed (a decimal FULL count), but to close
the literal ask we added a third count mode, **"Open Amount"**: the counter types the remaining
content directly, no scale/tare. Stored as a WEIGH line with `remainingContent` set straight from
input (scale/tare null) — reconciliation reads it identically, so no math moved (`countLineCreate`
gained an optional `remainingContent`; the WEIGH `superRefine` skips the scale/tare requirement when
it's present; `buildLineData` short-circuits to store it). Verified live: a line saved as
`{countType:"WEIGH", remainingContent:350}` persisted with null scale/tare; golden fixture still
−₱330.69.

**Par Level report (#3).** A purchasing guide: for every item with a reorder point, current on-hand
vs par, how much moved last closed period (the "beginning-and-ending movement" the client named), and
a **suggested order** (`par − on-hand`), below-par first, with an order-value total. New
`parLevelReport` in report-lists (projects `buildFullAudit`, so it cross-foots), full route +
xlsx/csv/pdf + web page + hub + palette. Verified: Main Bar shows 5 below par, ₱5,797.40 to buy.

**Non-Moving Items report (#4).** Dead stock: items still on hand with **zero** usage over the latest
closed period, ranked by idle value. Same shared `stockSnapshot` helper. The demo had no dead stock
(everything moved), so `seedDeadStock` adds one deliberately-idle item per sales location — Blue
Curaçao behind the bar, truffle paste in each kitchen — counted equally on the period's boundaries so
usage is zero and variance is zero (a brand-new item the ledger never touches; golden fixture still
−₱330.69). The report now lists them (Main Bar: ₱2,880 idle).

**Client note #2 (GCash / bank-transfer payment gate)** stayed a thought exercise per the client:
record method + proof, gate activation on the subscription (staff creation is inherently exempt), no
gateway, never store instruments. Not built.

Both workspaces typecheck clean.

## Phase 16 — Asset breakage & the Asset module, live (2026-07-21)

The client clarified that the **Asset** inventory module (equipment, alongside Bar/Kitchen) needs a
**"usage" column = breakage** in the reports — "what happened to the item." Assets aren't consumed;
they leave the register when they break, go missing, or are retired.

**Recording** reuses non-revenue (no new record type, no reconciliation change): a breakage is a
non-revenue entry on an asset item, with a **note** = what happened. The encode is now asset-aware —
when the selected item's `category.productType === "Asset"`, the reason list becomes **Broken / Lost /
Stolen / Retired** (`ASSET_LOSS_REASONS`) instead of the consumable buckets.

**The report** — Reports → **Asset Breakage** (new, in "Losses & Returns"): one row per breakage
event — Date · Item · Reason · **What Happened** · Qty · Value — plus a By-Reason summary and a
loss-by-reason chart, filtered to the Asset product type (empty on bar/kitchen locations).
`assetBreakageReport` in report-lists + route + xlsx/csv/pdf + web page + hub + palette.

**Demo / real data** — the module wasn't on anywhere, so `seedAssets` enables it: adds ASSET to
Prime's subscription + an **"Assets"** register location. The client then sent two Asset Management
reports, so the register is now their **70 real items** (`prisma/asset-seed-data.ts`) — name /
category / UOM kept verbatim (typos and all; costs are demo placeholders by category since their
report left cost blank) — across 21 asset categories, with opening counts and a few breakage/loss
events dated in the open period (so they show in the report's default range and the closed period
reconciles to zero variance). Verified live: 70 items / 21 categories, ₱2.13M on hand; 7 breakage
events / ₱16,280 written off; golden fixture still −₱330.69; Assets closed period variance 0/0.

Not touched: the packaging-tier mismatch (Basic 1 / Medium 5 / **Full 10** vs. our Basic/Medium/
One-Time) — parked pending the client's confirmation of the intended tier structure. Resolved in
Phase 18.

## Phase 17 — Asset module: catalog fields, per-location register, two reports (2026-07-23)

Phase 16 gave Asset a breakage report; this phase gives it the rest of the module the proposal
scoped — a register (Brand/Model, Serial No., Condition, Status, Initial Cost, Remarks, Asset Code)
and Beginning/Ending counting, built from `asset-module-proposal.md` and sequenced in
`asset-module-phases.md`. Same discipline as Phase 4/#15: additive fields on the existing
`ItemVariant`/`LocationItem` shape, no parallel model, no touch to `reconciliation.ts`.

**Schema.** Migration `20260723080000_asset_module_fields` adds, all nullable: `ItemVariant.brand`,
`ItemVariant.model`; `LocationItem.initialCost`, `serialNo`, `condition`, `status`, `remarks`, and a
**unique** `assetCode`. `assetCode` lives on `LocationItem`, not `Item` — the proposal's own default,
since both client sheets grain per-location and the register is `LocationItem`'s shape already.
Logged as architecture.md deviation #26. Condition/Status are Setting-backed lists
(`conditionOptions`, `statusOptions`), same pattern as `productTypes` — `GET`/`PUT
/condition-options` and `/status-options` mirror `/product-types` exactly, gated `admin.manage`.

**Brand/Model (catalog).** Plain optional inputs on the item form, same treatment as the existing
`barcode` field. The creation-time inputs alone left a gap — no way to fix Brand/Model on an
already-created variant — so a `BrandModelEditDialog` was added to `ItemEditSheet`'s variant row,
mirroring `VariantQuickEditDialog`'s conventions but kept separate: Brand/Model have no validity math
worth sharing with the tare/density gating.

**Asset details (per location).** Six fields, edited via a `Dialog` (`asset-details-edit.tsx`), not a
`Popover` — `PriceEdit`'s 3-field popover gets cramped past ~4 fields, and the repo already reaches
for `Dialog` at that size (`AttachItemDialog`). Condition/Status are dropdowns sourced from the two
new option endpoints, with a client-side "Other" branch that reveals free text. Scoped to
`itemVariant.item.category.productType === "Asset"` rows only in the Local Database view, next to a
new Condition/Status badge so the row is scannable without opening the dialog.

**Supplier and asset code are derived, not stored.** `deriveCurrentSupplier` (new
`services/asset-supplier.ts` — not `pricing.ts`, which has no Prisma access) reads the most recent
`COMMITTED` Purchase / `ACTIVE` PurchaseLine linked to the `LocationItem`, following the same
derive-don't-duplicate idiom `resolveCostBasis` already uses. The `assetCode` generator lives
alongside it: sequential across the whole client (never resets per category, matching the client's
own AST-001→070 numbering), read-then-increment inside the same `$transaction` as the
`LocationItem` create — the unique constraint is the race backstop, not the primary guard. Wired
into `POST /location-items`, scoped to Asset attaches only.

**Counting needed no new code.** Verified rather than built: two `CountSession` rows against the
same `LocationItem` (different `countDate`) already reproduce Beginning/Ending Inventory with zero
schema or `counts`-route changes — no uniqueness constraint blocks it, and `buildLineData` branches
only on `countType`, never on `Category.productType`. The count-entry screen already hides weighing
fields for Asset rows, since `weighable` derives from `contentTracked || weighMode === "NET"`, which
is always false for Asset variants — no fix needed, confirmed rather than assumed.

**Sales stays visible on Asset-only locations** — decided, not defaulted. The proposal's own framing
("nothing sells or is comped") turned out not to hold: Phase 16's breakage flow already runs Asset
losses through Sales → Non-Revenue (`ASSET_LOSS_REASONS`, `assetBreakageReport`), so gating Sales the
way Recipes is gated (`requiresProductTypes`) would have hidden a working feature, not an
inapplicable one. Reasoning recorded inline in `nav.ts`.

**Two new reports.** `Asset Register` (`services/asset-register.ts`) — a snapshot over `LocationItem`
joined to `ItemVariant`/`Item`/`Category`/`Unit`/`Location`, filtered to `productType = "Asset"`,
plus the derived supplier and latest breakage note; no variance math, deliberately not routed through
`report-assembly.ts`. `Asset Inventory` (`services/asset-inventory.ts`) — Beginning vs Ending
`CountLine.qtyFull` for two given dates, two lookups, no new query shape. Both get view + export
routes (`reports.export` guard on export) and pages built on `TableSurface`/`ToolbarSearch`, closest
analog `on-hand.tsx`; both added to the Reports hub. Exports follow the `ONHAND_HEADERS` declarative
pattern, not `FULL_AUDIT_COLUMNS`'s variance-coloring — Asset has no variance to color. Purely
additive to `exports.ts`: no existing `_HEADERS` array or exported function touched, so no golden
fixture is at risk — confirmed, not assumed.

**Seed data.** Fixed the "Safert First" typo (→ "Safety — First Aid") and trimmed trailing whitespace
("Furniture ", "Recorder ", "Chair ", and others the same pass turned up) in the client's AST-001→070
sheet before it became seed data, keeping the continuous non-per-category numbering and the
one-category-per-item shape as-is.

**Both implementation calls the proposal left open landed on its own recommended defaults** —
`LocationItem.assetCode` over `Item.assetCode`, and a sibling `Dialog` component over extending
`PriceEdit` — so neither needed a tie-breaker beyond following the doc's own stated preference.

Both workspaces typecheck clean.

## Phase 18 — Max users, Full tier (2026-07-25)

Client: "monthly, add **Full** — max users up to 10"; "**standalone**, he sets the number himself so
users can't be generated without his knowledge."

**Finding first:** `maxEntities` capped **locations**, not users — there was no user cap anywhere, so
this was net-new, not a tweak.

- **`Subscription.maxUsers`** (migration `20260725115405`), `0` = no cap saved (legacy rows).
- **Enforced** in `assertUserSeatsAvailable` — called from BOTH `POST /users` and
  `PUT /users/:id/access` (the access route replaces all rows, so capping only creation would be
  trivially bypassed). Counts `UserClientAccess`; excludes the edited user from their own seat.
- **`FULL` tier** added; `derivePackageType(billingCycle, maxEntities, maxUsers)` now names the tier
  by USERS (1 → Basic, ≤5 → Medium, 6+ → Full), falling back to the old location rule when
  `maxUsers = 0` so existing rows keep their badge instead of jumping to a different tier the first
  time this runs against them.
- **UI:** tier dropdown reads "Basic — 1 user / Medium — up to 5 / Full — up to 10" and sets the cap;
  Standalone shows an editable **Max Users** number input (owner-set, never unlimited) alongside a
  free-form **Max Locations** input (0 = unlimited, but only when explicitly chosen — never implied).
- Seeded Prime = Full (10), Casa = Medium (5).

**Bug found while verifying:** both seeded clients had **no subscription row at all** —
`upsertClientWithSubscription` returned early for an existing client, so a client whose subscription
went missing stayed broken through every re-seed. Now backfills. Golden fixture still −₱330.69.

**Reconciled with Phase 17's Asset module** (same week, parallel branches): Phase 17 left the
tier-mismatch question open ("packaging-tier mismatch... parked pending the client's confirmation
of the intended tier structure") — this phase is that confirmation landing. `maxEntities` still
gates location creation on its own (`POST /clients/:id/locations`), but no longer determines the
package tier; `maxUsers` does. Both `LocationItem`-level Asset fields (Phase 17) and
`Subscription.maxUsers` (this phase) are independent additive migrations — no overlap, no
reconciliation needed at the schema level, just at the shared `constants.ts`/`admin.ts` files both
touched.

Parked: note 3 ("gayahin ang full audit") — the legacy 24-column layout already ships as
Full Audit → **Client Formats → Detailed Full Audit Report** (xlsx/csv/pdf). Confirm with the client
whether he means that download or wants it rendered on screen before building anything.

## Phase 17 — Max users, Full tier (2026-07-21)

Client: "monthly, add **Full** — max users up to 10"; "**standalone**, he sets the number himself so
users can't be generated without his knowledge."

**Finding first:** `maxEntities` capped **locations**, not users — there was no user cap anywhere, so
this was net-new, not a tweak.

- **`Subscription.maxUsers`** (migration `20260725115405`), `0` = no cap saved (legacy rows).
- **Enforced** in `assertUserSeatsAvailable` — called from BOTH `POST /users` and
  `PUT /users/:id/access` (the access route replaces all rows, so capping only creation would be
  trivially bypassed). Counts `UserClientAccess`; excludes the edited user from their own seat.
- **`FULL` tier** added; `derivePackageType(billingCycle, maxEntities, maxUsers)` now names the tier
  by USERS (1 → Basic, ≤5 → Medium, 6+ → Full), falling back to the old location rule when
  `maxUsers = 0` so existing rows keep their badge.
- **UI:** tier dropdown reads "Basic — 1 user / Medium — up to 5 / Full — up to 10" and sets the cap;
  Standalone shows an editable **Max Users** number input (owner-set, never unlimited).
- Seeded Prime = Full (10), Casa = Medium (5).

**Bug found while verifying:** both seeded clients had **no subscription row at all** —
`upsertClientWithSubscription` returned early for an existing client, so a client whose subscription
went missing stayed broken through every re-seed. Now backfills. Golden fixture still −₱330.69.

Parked: note 3 ("gayahin ang full audit") — the legacy 24-column layout already ships as
Full Audit → **Client Formats → Detailed Full Audit Report** (xlsx/csv/pdf). Confirm with the client
whether he means that download or wants it rendered on screen before building anything.

## Phase 18 — Legacy layout on screen, branch filter, profit, Bar/Kitchen qty (2026-07-25)

A batch of client notes, audited first (7 parallel readers, each adversarially verified) — three of
them turned out to be the opposite of what the note implied.

**Full Audit by Category, on screen** (he sent a screenshot of his old system). The 24-column dataset
already existed — `legacyAuditReport()` — but was export-only. Added the JSON sibling route
(deliberately NOT behind `exportGuard`; the router's `reports.view` already scopes it, and that is
what lets a view-only auditor read the layout), a `useLegacyAuditReport` hook, and a page that renders
the same rows the XLSX/CSV/PDF build — so screen and file cannot disagree. Category banding,
per-category TOTAL rows, the cost-ratio badge, Detailed/Inventory variants, and the same materiality
highlight as the Full Audit. Verified: its grand total is −₱330.69, identical to the golden fixture.

**Transfers: branch selector.** `transferReport()` gained an optional `counterpartyId`; the route
accepts `?counterparty=`, the export filename names the branch, and the page has a To/From Branch
Select reusing the same sibling-location list the Transfers screen uses. Verified it genuinely
filters: Depot 4 rows / qty 50, Kitchen and Assets 0.

**Gross & Net Profit.** Cost Analysis already computed every input and only ever *divided* — added the
subtraction: `grossProfit = grossSales − cost`, `netProfit = netSales − costNet`, on screen and in
both exports. Verified ₱50,820 − ₱18,202.68 = ₱32,617.32. **Stated plainly to the client:** this
system records no operating expenses, so "net" here means net-of-VAT, NOT accounting net profit.

**Non-revenue qty (Bar vs Kitchen).** The note read as "allow decimals", but decimals were already
accepted end-to-end — the real gap was the inverse. Bar non-revenue now takes WHOLE bottles plus the
separate content/ML field (his legacy screenshot); Kitchen and Asset take a plain decimal quantity
like Production, with no ML field. Applied to both QuickEntry and EditSaleDialog so they can't drift.
Verified live: Absolut Vodka → `inputmode=numeric` + ML shown; Butter → `decimal`, no ML.

**Bug fixed in last phase's seat cap:** a DISABLED user still consumed a `maxUsers` seat, so an owner
could not hire a replacement. Seats now count ACTIVE accounts only, re-enabling re-checks the cap
(otherwise disable→enable walks past it), and `/subscriptions/:clientId/check` counts the same way so
the UI can't disagree with the 403.

Not built, needs the client (see the review doc): owner-managed sub-accounts (today ALL user
management is LIS-admin-only, and opening it up needs per-client scoping + a role ceiling first),
the tare-weight notification/approval gate, and the decoupled audit/activity date range — where
JJ's "yes" was half-wrong.

## Phase 19 — OWNER role, bottle-weight visibility (2026-07-25, later)

**OWNER role (client: "the owner client is the only one who can disable his employee's account,
including the Manager role").** Every mechanism already existed but was locked to the LIS ADMIN, so
this was a permission problem, not a feature one. Added `OWNER` to `ROLES` and a new `users.manage`
permission (`ADMIN` + `OWNER` — deliberately NOT MANAGER, per the client's wording). The four user
routes moved out of `adminRoutes` into `userAdminRoutes`, mounted on the same `/api/admin` prefix
under the softer guard, with three checks: `actorScope` (an owner acts only on his own clients),
`assertActorMayTouchUser` (target must share his establishment, and can never be an ADMIN), and
`assertActorMayAssign` (`OWNER_ASSIGNABLE_ROLES` — he can never mint an ADMIN or a peer OWNER).

Gotcha worth remembering: `adminRoutes` had a bare `.use()`, which Hono expands to `/api/admin/*` —
it 403'd the new user routes before they ran. Both routers now scope their middleware by path.

Verified live as `owner`: sees only his 5 Prime staff (admins filtered out), **disables a MANAGER →
200**, `/api/admin/clients` → 403, minting an ADMIN → 403 "You cannot assign the ADMIN role",
assigning into another tenant → 403.

**Bottle weights on the Local Database (client: "is the list showing Liquid Weight and Tare Weight,
or only while inputting the weight?").** It was the latter — the columns didn't exist. Added a
**Tare / Liquid Wt** column plus a **"Needs weight"** status badge, and a matching `missingWeights`
count in the dashboard's existing *Needs Attention* list. That is the answer to the notification note
too: a real work-queue where the admin already looks, instead of a notification system this app has
no infrastructure for — and no hard approval gate, because `weigh-calculator` refuses to compute
without a tare, so blocking first-time entry would strand a live count. Verified: House Red Wine
shows `15.8 oz / —` + Needs weight; non-weighable rows show `—`.

Golden fixture still −₱330.69.

## Phase 20 — Notification bell (2026-07-25, later)

The dashboard already knew what was outstanding; you just had to be *on* the dashboard to see it.
Added a **bell in the topbar** beside Stocky: same items, chunked (Missing data / Needs review /
Open work), each row linking to the page that fixes it, with a count badge.

Two decisions worth keeping:

- **Derived, never stored.** No Notification model, no read/unread, no dismiss. Each row is a live
  query result, so it disappears when the work is genuinely done — a stored notification would keep
  claiming "pending" after the fact and would need per-user read state, a whole subsystem for what a
  badge count answers.
- **One source.** `attentionItems()` moved out of dashboard.tsx into `lib/attention.ts`; the panel
  and the bell now call the same function, so they cannot disagree about what is outstanding
  (verified live — both list the same four items).

## Phase 21 — Bottle weights are LIS's own data (2026-07-25, later)

Client decision: the tare / liquid-weight library is his IP; clients see it only if he releases it.
Implemented as a ROLE rule rather than a screen rule, because the list was the *least* leaky of the
three surfaces — the weigh screen printed both constants to Staff on every weigh, and Manager could
edit them.

- `weights.manage` permission (**ADMIN only**) — separate from `master.write`, so a client manager
  still runs his catalog without reading or rewriting the weight library. Server rejects weight
  fields on `PUT /master/variants/:id` loudly rather than dropping them silently.
- `Client.showBottleWeights` (migration `20260727113600`, default **false**) — the per-client release
  switch, in Settings → *Bottle Weights (LIS only)*. Chosen over the client's "I'll produce each
  download myself" because that is recurring manual work; the toggle is the same control, self-serve.
- **Admin-only CSV**: `GET /location-items/export` — the catalog *with* weights, for handing over
  without switching the display on. Staff gets 403.
- Three surfaces gated through one hook (`useCanSeeBottleWeights`): the Local Database column, the
  weigh screen's working, and the item-form fields.

**UX pass, walked as each role.** Two dead ends found and fixed — both introduced by the gating:
1. The weigh screen still said *"set it in Items before weighing"* to people who can no longer do
   that. It now tells them what they CAN do: count under Full Units, or enter the Open Amount.
2. "Needs weight" in the list was unexplained jargon with no next step — now a tooltip naming who
   fixes it and what to do meanwhile.

Verified end to end: Staff sees no numbers but still sees the flag; admin flips the toggle and the
whole app re-gates off `/me`; Staff then sees the values but still cannot export (403). Restored to
hidden. Golden fixture −₱330.69.

## Phase 22 — Clients can request a weight change (2026-07-25, later)

Gap found while reviewing Phase 21: the derived flag only fired when a weight was **missing**. A
bottle whose weight is present but WRONG (supplier changed the bottle) was invisible — and since
clients can no longer edit weights, they had no way to say so. That is the "or need update" half of
the client's original note, previously only half-covered.

`ItemVariant` gained `weightReviewNote` / `weightReviewBy` / `weightReviewAt` (migration
`20260727115045`). Pending = note non-null — derived like every other attention item, so there is no
request lifecycle to keep in sync, and only ever one open ask per bottle (no duplicate queue). No new
model.

- **Raise**: `POST /master/variants/:id/weight-review` under `master.write` — owner AND manager, as
  they are the ones who notice. Note required (min 3 chars): they report the symptom, LIS does the
  re-weigh.
- **Close**: `DELETE` the same path under `weights.manage` — admin only, typically right after
  correcting the value.
- Surfaces in the bell/Needs Attention as "Re-check N reported bottle weights" (admin only), and in
  the Local Database as a "Weight reported" badge whose tooltip carries the note and who raised it.

Verified the full round trip: manager reports → 200; manager still cannot edit the weight (403 "set
by your LIS administrator") nor close their own report (403); admin sees `weightReviews: 1`, edits
the weight → 200, closes → count returns to 0. Golden fixture −₱330.69.

## Contributor history

| Window | Who | What |
|---|---|---|
| 2026-06-26 → 07-12 | Rasty (owner) | Phases 0–8: the whole build, plus UI/design passes |
| 2026-07-09 → 07-10 | JjByteX | UI fixes (segmented controls, sidebar), login redesign |
| 2026-07-18 → 07-19 | JjByteX | Subscription/plans/clients arc: `Subscription`, `SubscriptionModule`, `LocationModule`, billing state, clients admin UI. A Plan catalog was added (`dd51046`) then fully reverted (`5af9668`) |
| 2026-07-19 | Claude session | Phase 9 (above) + audit and remediation of the arc |
| 2026-07-21 → 07-23 | Claude session | Phases 14–17: variance highlight, Par Level/Non-Moving reports, Asset breakage, and the full Asset module (catalog fields, per-location register, Asset Register/Inventory reports) |
| 2026-07-25 | Claude session (parallel branch) | Phase 18: `Subscription.maxUsers`, Full tier, seat enforcement — merged alongside Phase 17's Asset module work |

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

## Phase 23 — Clients weigh their own bottles (2026-07-28)

The client reversed the 2026-07-25 decision. Lourd: *"Sila na mag timbang… dapat
din makita nila. Since Local Database lang naman ang nakikita ni user at hindi
whole main database."* So the establishment does the weighing and sees the
numbers — but only inside **their** catalog.

`ItemVariant` is global (no `clientId`), so letting a client edit it would
silently rewrite every other tenant's weights. Instead, migration
`20260727190101_location_item_weight_overrides` puts `tareWeight`,
`tareWeightUnit`, and `densityFactor` on **`LocationItem`** — which is exactly
Lourd's "Local Database vs Main Database" distinction. One resolver,
`resolveBottleWeights()` in `packages/core/src/constants.ts` (local → master →
category default), is used by the counts route, the live weigh preview, the
catalog column, and the CSV export, so no two surfaces can quote different
weights. It lives in `constants.ts`, **not** in sacred `weighing.ts`.

- **Weigh dialog** — `apps/web/src/pages/stock/weight-edit.tsx`, on every
  weighable row in Local Database. Placeholders show the standard value; a blank
  box means "inherit", so saving an untouched dialog can't pin today's master
  value onto the location forever. Gated on `prices.edit` — the same permission
  the PUT enforces, so the button can never appear to someone the server refuses.
  The trigger lives **inside the Tare / Liquid Wt cell**, always visible: a
  scale icon when weights exist, a spelled-out **Weigh** button when one is
  missing. It first shipped as its own hover-reveal `Weight Check` column, which
  was wrong twice over — a reserved column costs its width on every row whether
  or not anything is in it, and hiding the control behind hover meant the
  "Needs weight" badge two columns over had no visible fix. Dropping the column
  took the table from 7 columns to 6 and killed the horizontal scroll at 1280
  (926px table in a 926px container, verified). An open weight report is now a
  **Status** badge (it *is* a status), and raising one moved into the Weigh
  dialog footer — you only dispute the standard after weighing it yourself.
- **"own" marker** next to a weight that came from the client's own weighing,
  so a manager can tell their number from the shared default.
- **Audit trail** splits: a weight edit now logs `locationItem.weightChange`,
  not `locationItem.priceChange`, with old and new values.
- **Retired** the `showBottleWeights` release gate — the Settings toggle, the
  `/api/settings/bottle-weights` route, `canSeeBottleWeights()`, the
  `lib/weights.ts` hook, and the `MeClient` field are gone. The `Client` column
  stays (migrations are additive) with a comment marking it dead. The weights
  CSV became a plain **Local Database** export, open to the catalog's own
  managers and carrying a "Source" column (Own weighing / Standard).
- **`WeightReport`** stays as the secondary path — it now means "the *standard*
  looks wrong", which only LIS can fix on the master library.

Verified live: recorded 17.4 oz over Absolut Vodka 700 ml's standard 16.9, and
the count screen read `(scale 30 − empty 17.4 oz) × Liquid Weight 30.12 = 380 ml`
— the client's own number, visible to the counter. Golden fixture unmoved with
the override in place (Main Bar Jun 1–8 still **−₱330.69 / −₱869.57**), because
committed lines snapshot their own weights and a later re-weighing cannot
rewrite a closed period. Both workspaces typecheck clean.

## Phase 24 — Full-app UX walk: five correctness fixes (2026-07-28)

Walked every flow as a real user (admin and staff). Five defects found, all
presentation-layer, none touching reconciliation math. Golden fixture re-verified
after each: Main Bar Jun 1–8 still **−₱330.69 / −₱869.57**.

1. **Dashboard "Unresolved work" disagreed with the bell** (3 vs 4).
   `unresolvedCount()` predated the weight categories and never added
   `missingWeights`/`weightReviews`, while the bell reads `attentionItems()`.
   Two counters for one truth in an audit product is the worst kind of bug.
2. **`-₱0.00` in the Full Audit.** Reconciliation sums land on `-5.5e-13`;
   `hasVariance()` already treats that as zero but `formatMoney` formatted the
   raw value and Intl kept the sign. Now snaps below half a centavo.
3. **`-0` quantities**, same cause via a `n2` helper that had been copy-pasted
   into **fourteen** report pages. Replaced with one `formatNumber()` in
   `lib/utils` so the fix lands everywhere at once.
4. **Verdict strip counted float dust as real.** `r.variance < 0` reported
   *"5 items short · 1 over"* for a period with three real shortages. Now uses
   `hasVariance()` — reads **"3 items short · 0 over"**.
5. **Dashboard Variance Leaders** filtered on `varianceCost !== 0` — the exact-zero
   comparison deviation #24 exists to forbid — so three no-variance items sat on
   the board labelled *"Shortage ₱0.00"*. Now `hasVariance()`; only the three
   real shortages remain.

Also confirmed (not a defect): an item missing from a count is **excluded** from
the reconciliation rather than counted as zero — a 6-line count over a 13-item
catalog produces a 4-row report. Safer than a false shortage, but silent; see the
count-completeness suggestion.

## Phase 25 — The six suggestions, built (2026-07-28)

Golden fixture re-verified throughout: **−₱330.69 / −₱869.57**.

**Count completeness.** The session showed "Entered lines: 1" and nothing else,
and Commit locked the period silently. Now: a **Progress** bar reading
`1 of 13 items`; the entries pane is two tabs, **Counted** and **Not counted**,
where every outstanding item is listed and *tapping one loads it into the form*;
and the commit dialog names what is missing —
*"12 items have not been counted… uncounted items are left out of the
reconciliation entirely — they won't appear as a shortage."* All derived from the
catalog, so nothing can drift out of sync.

**In-progress work first.** Counts and Purchases now sort OPEN/DRAFT rows to the
top. The open count was landing 8th under seven committed ones, right after the
dashboard told you to go finish it.

**One date format.** `formatDate()` in `lib/utils` — the app was rendering
`Jul 20, 2026` on the dashboard and raw `2026-07-30` in Counts, Transfers and
five report tables. Parsed at local midnight, never `new Date("2026-07-20")`,
which is UTC and lands a day early west of Greenwich.

**"16 + 0.11" explained.** Compact mode dropped the "(Full + Open)" suffix,
leaving the notation undecodable; Begin/End now carry an Info hint.

**Staff can report a bad weight.** Raising a weight problem moved from
`master.write` to `entries.create`, and the control now also sits in the weigh
strip on the **count screen** — where staff are standing with the bottle and the
scale. Filing a note changes no data; an admin still acts on it. Verified live:
Paolo Reyes (STAFF) filed one, it appeared on the admin's bell, admin closed it.

**Small-laptop layout.** The sidebar is 16rem — 288px at this app's 18px root,
28% of a 1024px screen — and always started expanded. It now defaults to the
icon rail below 1400px, with a saved preference always winning. Local Database
additionally folds Category under the item name below 2xl. Result at 1280:
content width **926 → 1160px**; at 1024 the catalog went from 958px-in-670 (hard
scroll) to **904-in-904, no scroll**. Swept all 13 pages at 1280 — no horizontal
scroll anywhere except `reports/legacy-audit`, which is the client's 24-column
layout and is meant to scroll.

## Merge — origin/main (asset module) into local work (2026-07-28)

Nine conflicted files. Most were both-sides-additive (new fields on the same
model, new routes in the same array) and were unioned. Three needed judgement:

- **`admin.ts`** — we extracted the user routes into `userAdminRoutes` with the
  softer `users.manage` guard so an OWNER can hire/disable his own staff; their
  branch left them inside `adminRoutes` and changed only comments there. Took
  ours; verified no duplicate `/users` handlers survived.
- **`item-form.tsx`** — they restructured the variant block around
  `isAsset`; we changed the weight-field permission gates. Rebuilt from their
  file and re-applied our four edits, so both survive.
- **`architecture.md`** — we both claimed deviation **#26**. Theirs landed on
  main first and their code comments already cite #26, so ours renumbered to
  **#27**.

Fallout the merge surfaced, fixed:

- `seed.ts` — their new Aurora client predates `maxUsers` becoming required.
  Set to 1, matching its own comment ("same Basic-tier shape as Casa Verde");
  BASIC is one seat.
- `seed.ts` — two unchecked index accesses into `createdItems`. Guarded rather
  than asserted: if those arrays ever desync, seeding a count line against the
  *wrong* asset is worse than skipping one.
- `admin/clients.tsx` — both branches added the same `PACKAGE_MAX_USERS` import
  and the merge kept both lines.

**A real bug on main, not a merge artifact** — migration
`20260724070711_add_asset_industry_field` declares `industry` on **Category** in
`schema.prisma` but the SQL adds the column to **LocationItem**. So
`Category.industry` never existed in any database built from migrations, and
every query joining Category — most of the reporting layer via
`report-assembly.ts` — died with `P2022 ColumnNotFound`. The dashboard 500'd on
first load after the merge. Fixed with a corrective migration
(`20260728060000_fix_category_industry_column`) rather than editing the applied
one, which would break its recorded checksum. The stray `LocationItem.industry`
is left in place: nullable, absent from the schema, never read.

Also gated the new **Asset Details** column on `locationModules.includes("ASSET")`
— it was a column of "—" on every Bar and Kitchen catalog, which undid part of
the small-laptop width work.

Verified after merging: both workspaces typecheck, Prisma schema validates,
migrations report in sync, all 18 pages render with no client or server errors,
and the **golden fixture is unchanged — −₱330.69 / −₱869.57 on both the Full
Audit and the Legacy Audit.**

### Post-merge audit of the asset module

Reviewed the incoming work against the project's non-negotiables rather than
assuming it. It holds up: `round2` for every money figure, ACTIVE-only /
COMMITTED-only filters on the ledger reads, `logActivity` inside the same
`$transaction` as each mutation, settings persisted as `String` (no `Json`
scalar), and all new report routes mounted under the existing
`requireAuth + requireLocationAccess` group. No `Math.round`/`toFixed` in domain
code and no exact-zero variance comparisons. The Asset Register's "last note"
column agrees item-for-item with the Asset Breakage report.

The one defect was the misplaced `Category.industry` column (above). One
integration gap remained: **two independent asset seeding paths** — `seed.ts`
creates Aurora / Main Warehouse (theirs), `seed-demo.ts` creates Prime / Assets
(ours) — and only theirs filled the new register fields. Prime's Asset Register
therefore rendered 70 rows of nulls, which reads as a broken feature. The demo
fixture now fills `initialCost` / `serialNo` / `condition` / `status` / `remarks`
on create **and backfills them on update**, so a database seeded before the asset
migration heals on the next run instead of needing a reset. Codes come from the
shared `generateAssetCode()` the live route uses — `assetCode` is globally
unique, so a locally-counted sequence collided with Aurora's AST-001…070 on the
first attempt.

Verified: both registers full (Aurora AST-001…070, Prime AST-071…140), 70/70
rows carrying condition, 7 breakage notes each, no code collisions; 18 pages
render clean; both workspaces typecheck; golden fixture still
**−₱330.69 / −₱869.57**.

### Second pass — write paths, pages, exports

The first audit was convention greps plus one numeric cross-check; it did not
cover their write paths, their two new pages, or their exports. Going back over
those found two more real defects:

- **The audit-log before-image was incomplete.** `PUT /location-items/:id` is
  the shared write path for prices, weights AND the asset register fields, but
  its `old` snapshot only captured cost/retail/par/isActive plus the weights I
  had added. Changing an asset's condition recorded the new value with nothing
  to compare it against — in a system whose rule is that every mutation is
  auditable, a half-captured before-image is the defect. `old` now covers every
  field the route can write, and the action splits three ways
  (`priceChange` / `weightChange` / `assetChange`) so an auditor can filter.
  Verified live: changing Amplifier's condition logs `locationItem.assetChange`
  with `old.condition: "Active"`.
- **Asset Register was 13 columns / 1,860px** — a sideways scroll at 1280,
  exactly what Phase 25 removed everywhere else. Given the same treatment the
  Full Audit already uses: compact by default (code, item, category, condition,
  status, initial and current cost), **All Columns** for the rest. 1,860 → 1,160,
  no scroll. Exports still carry all 16 columns, verified, so narrowing the
  screen loses nothing. Its "As of" date also rendered raw ISO; now `formatDate`.

Two things checked and cleared rather than assumed: `asset-inventory` returning
an empty report is only true of a bare API call — the page defaults to
`dates.at(-2)`/`.at(-1)` like every other count-anchored report. And the Asset
Register's notes agree with the Breakage report; an earlier claim that they
disagreed was my own field-name error (`lastNote` vs `latestNote`), not their
bug.

### Third pass — interactive asset UI, config, docs

`vite.config.ts` (ngrok `allowedHosts`, dev-server only) and the `PRODUCT.md`
asset workflow both read correctly — no action. The asset details dialog is
well-formed and prefills from the row. One real defect behind it:

**A duplicate asset code returned a raw 500.** `assetCode` is `@unique` across
every location and the field is user-editable, so typing one that is already
taken produced `{"error":"Internal server error"}` — which reads as "the app is
broken" rather than "pick another code". Fixed centrally in `lib/errors.ts`
rather than per-route: any Prisma P2002 now becomes a **409** with a readable
message, so every current and future unique constraint is covered by one guard.
Prisma reports the offending column in two different shapes — `meta.target` on
the classic engine, `meta.driverAdapterError.cause.constraint.fields` on the
driver adapter we run on SQLite — so both are read, and the message stays
specific if the adapter ever changes. Verified: the duplicate now returns 409
"That asset code is already in use…", the row is left unchanged, and routes that
already threw their own 409 (e.g. duplicate username) still win.

## Phase 26 — Reporting-layer audit (2026-07-28)

A subagent swept all 19 reports on screen and as exports. Golden fixture passed
in all three surfaces (API, screen, CSV). I reproduced every finding before
acting on it; one I chased turned out to be my own misreading and was dropped.

**Fixed**

1. **Legacy Audit cost ratio was 100× too small — the worst bug found.**
   `costRatio` is a FRACTION (cost ÷ revenue) and the screen appended a literal
   `%`, so a 33.79% beverage cost rendered as **"0.34%"**. On the one metric that
   report exists for, in the client's own layout. The exports were already
   honest — they label it "(cost of sold / revenue)" and write the fraction — so
   only the screen changed; it now reads **33.79%**.
2. **Full Audit claimed "exports always include every row" — false.** With
   Variance Only armed the server honours the filter, so the file drops the same
   rows (13 → 3, revenue total ₱50,820 → ₱8,998.09). Variance totals still
   agreed, so the sacred number was never at risk, but the sentence was a lie.
   The footer now distinguishes the two filters: search is screen-only, Variance
   Only applies to the export too.
3. **Top Sellers export ignored the Top 10/25/50 selector** — the read route
   threaded `limit`, the export route dropped it, so a Top 50 view downloaded as
   a Top 10 file. Both now share one `topSellersLimit(c)` helper.
4. **Three report services returned unrounded grand totals.** Rows were
   `round2`'d, the totals weren't, so CSVs printed `18117.969999999998` and
   `17169.899999999998` while the screen showed the rounded figure — screen and
   file disagreeing on the total. Forfeits, Usage Cost and Sales by Item now
   round like every sibling service already did.
5. **Raw ISO dates, second sweep.** The earlier pass missed the date columns in
   Sales / Purchases / Non-Revenue, the Full Audit verdict strip and drill
   subtitle, On Hand and Par Level "as of" lines, and the count-date dropdown
   labels on **seven** pages. All now `formatDate`. The helper was widened to
   accept null/undefined and render an em dash — forcing every caller to write
   `?? ""` is exactly how raw ISO leaked back in.

**Dropped after checking:** a per-category `0.34` next to the corrected ratio
looked like a second instance of the same bug. It is the "F" (forfeited) column.
No change made.

Golden fixture re-verified after every edit: **−₱330.69 / −₱869.57**, Full Audit
and Legacy Audit.

## Phase 27 — Two security holes, and the six judgement calls (2026-07-28)

### Security (from the ADMIN-role sweep) — both reproduced before fixing

- **`GET /api/admin/clients` shipped every user's `passwordHash` to the browser.**
  `access: { include: { user: true } }` returned the whole User row — nine scrypt
  digests, plus emails and lockout counters — on every Admin → Clients load.
  Replaced with a shared `CLIENT_ACCESS_USER_FIELDS` projection at both sites, so
  adding a column to User cannot silently re-open it. Verified: 9 hashes → 0,
  all 3 clients still returned.
- **Cross-tenant leak: an OWNER could read other establishments' names and
  subscription tiers.** `GET /api/admin/users` scoped WHICH users an owner sees
  but not the nested `clientAccess` on each, so the owner of Prime Hospitality
  learned Casa Verde's and Aurora's package type, billing cycle, status and
  modules through any shared user. The nested rows are now scoped to the actor.
  Verified as `owner`: foreign clients visible 2 → 0, own 5 users still returned;
  ADMIN still sees all 3.

### The six judgement calls

1. **Asset Register contradicted Asset Breakage.** Solved without mutating any
   status: the register now takes on-hand from `stockSnapshot` — last committed
   count *plus everything committed since* — so a written-off unit leaves the
   register because its breakage is a committed movement. Microphone AST-084 now
   reads **qty 2**, ₱16,000, beside its "Missing after a private event" note.
   Auto-flipping condition to Retired would have been wrong: three microphones
   minus one broken is two working microphones, still In Use.
2. **Register total ignored quantity.** It summed one unit cost per asset *type*.
   Now quantity-extended, with **Qty** and **Value** columns on screen and in both
   exports: ₱1,021,080 → **₱2,134,210** across **410 units**. This also reconciles
   with Asset Inventory: 423 at the Jul 20 count, 410 today, 13 written off after
   it — the two reports now tell one story rather than contradicting.
3. **Cost Analysis COGS vs Full Audit usage.** Left the math alone — both are
   correct, they answer different questions. Added a tooltip naming the method:
   balance-derived (begin + purchases + transfers − ending), which absorbs
   anything unaccounted for, versus the audit's usage figure.
4. **Date semantics.** Audit reports are count-to-count; Sales/Purchases take an
   inclusive range, hence ₱50,820 vs ₱59,040 for the same two dates. Deliberate,
   so nothing changed but the silence: the verdict strip now says activity on the
   beginning date belongs to the previous period, and that range reports differ.
5. **Breakage reading as a gain** turned out not to be a defect. The seed's
   write-offs are dated after the last count, so "more on hand than expected" is
   the system correctly reporting gear written off but still on the shelf. Left
   as is; the register change above makes the quantity story legible.
6. **Cost Analysis "Net %" could never differ from "Gross %"** — `costNet/netSales`
   and `cost/grossSales` divide both sides by the same 1.12. Collapsed to a single
   **Cost %** with a tooltip saying the ratio is VAT-neutral. The peso Gross and
   Net Profit figures do differ and both remain.

Golden fixture after all of it: **−₱330.69 / −₱869.57**, Full Audit and Legacy Audit.

## Phase 28 — Operator-role sweep (2026-07-28)

### Fixed

- **The activity trail leaked to roles that are explicitly denied it.**
  `/api/activity` is gated on `activity.view` (ADMIN/OWNER/MANAGER) and correctly
  403s — but `GET /dashboard` returned the same records, with usernames and
  summaries, to anyone who could load the page. Verified as READONLY: 403 on the
  endpoint, five entries on the dashboard, including *"Asked Stocky: Why is
  Absolut short this period?"*. The service now takes the permission and returns
  an empty list without it. Verified after: ADMIN 5, MANAGER 5, STAFF 0,
  ACCOUNTANT 0, READONLY 0.

- **No route-level permission guards — the sidebar filtered itself, the router
  did not.** A READONLY user who typed `/counts/<id>` got the full count editor
  with **Save line and Commit enabled**; STAFF reached Admin → Users and could
  open the New User dialog. The server was never at risk (403s confirmed
  throughout) — the defect is walking an operator all the way to a submit button
  before anything tells them no. Added one `RouteGuard` around the shell's
  `<Outlet />` that reads the **same nav declarations** the sidebar already uses
  (`permissionForPath`, longest-prefix match so `counts/<id>` inherits `counts`),
  so the two can never drift. Undeclared paths — dashboard, stock, reports —
  stay open to every signed-in role, as before.

  Verified with real page loads per role (a fetch-based login leaves React
  Query's `/me` cached, which produced a misleading first result):

  | Role | Open | Blocked |
  |---|---|---|
  | MANAGER | counts, suppliers, items, recipes, imports, stock, reports | admin/clients, admin/users |
  | STAFF | counts, purchases, sales, transfers, stock, reports | admin/*, imports, recipes, suppliers, items |
  | READONLY | dashboard, stock, reports | counts, counts/:id, suppliers, imports, items, recipes |

- **Cleaned up the agent's residue**: import batch `t.csv` (SALES, NEEDS_REVIEW,
  1 row) that it created while probing permission gating and could not delete —
  there is no DELETE route. Removed directly, after asserting the batch was not
  COMMITTED so it had never touched inventory. Imports list is back to the two
  seeded batches; `unmatchedRows` back to 0.

Golden fixture unchanged throughout: **−₱330.69 / −₱869.57**.

## Phase 29 — Working the backlog (2026-07-28)

1. **Assets no longer sit at "70 items need attention" forever.** `missingPrices`
   required a retail price on every row, but an Asset is never sold — the only
   way to clear the badge was to invent selling prices for 70 fire extinguishers.
   One shared `isMissingPrice()` in core now exempts Assets from retail while
   still requiring cost (the register and every asset valuation price from it),
   used by the dashboard count, the catalog badge, the row status **and** the
   `?missingPrices=1` server filter, so none of them can disagree. Assets 70 → 0;
   the Bar's one genuine missing price is untouched.

2. **Subscription "View-only" is now enforced.** The admin UI said *"Overdue by
   more than 7 days — mark as paid to restore access"* and showed a View-only
   badge while every write returned 200. Writes on a VIEW_ONLY subscription now
   return **403 `SUBSCRIPTION_VIEW_ONLY`**. Reads always pass — an establishment
   that owes money can still read its own audit history — and **ADMIN bypasses
   entirely**, or an unpaid client's LIS administrator could not get in to mark
   the invoice paid. Verified: unpaid → manager read 200, manager write 403,
   admin write 200; after mark-paid, writes restored.

   The demo clients were seeded unpaid from 2026-01-01, so all three derived to
   VIEW_ONLY and enabling this would have frozen the whole seed on first load.
   The seeder now marks them paid, and the existing rows were updated to match.

3. **A mistyped admin URL no longer drops you on another client's dashboard.**
   `<Navigate to="../clients">` popped BOTH segments of `admin/subscriptions`,
   resolving to `/l/:id/clients` — no route — then the catch-all sent you to `/`,
   which silently switched establishment. Now `to="clients" relative="path"`.

4. **The command palette stopped handing low-privilege users links the sidebar
   hides.** Menus and Suppliers results are gated on the same permissions the nav
   uses. (The route guard from Phase 28 already blocked the destination; the
   palette shouldn't have been offering it.)

5. **Stocky stopped telling bar staff to set a server env var.** *"Add an
   ANTHROPIC_API_KEY"* → *"Ask your administrator to enable free-form
   conversation"*, with the env-var detail shown only to ADMIN — the same split
   the Imports page already got right.

6. **Counting lost a keystroke per item.** Focus always returned to the item
   picker, so every item cost an extra Tab to reach the number field, and on the
   paths that already know the item (Edit, tapping a row in "Not counted")
   focusing the picker was actively wrong. A shared `focusEntry()` now moves to
   the right field for the active mode. Focus still returns to the picker *after
   save* — that part was already correct.

7. **Last of the raw ISO dates**: Purchases list and editor header, the Sales
   entry list, Imports, and the Admin → Activity **When** column (now
   "Jul 28, 2026 06:35"). Swept 10 pages: no raw `YYYY-MM-DD` left except inside
   historical activity *summaries* — those are stored strings in an immutable
   audit log, and rewriting them to change their formatting is exactly the kind
   of history edit this system exists to prevent. Left deliberately.

Golden fixture after all of it: **−₱330.69 / −₱869.57**.

## Phase 30 — The long tail (2026-07-28)

- **Pluralisation**: "1 users" → "1 user" (package fields), "1 rows" → "1 row"
  (import activity summaries).
- **The add-location control stopped vanishing without a reason.** `LocationsField`
  destructured `limitMessage` and never rendered it, so at the subscription limit
  the user got no input, no button and no explanation. Now rendered — and the
  Manage Client dialog, which never passed one, does.
- **An absent price reads as "—", not "₱0.00"** — every other blank in that table
  is a dash, and ₱0.00 asserts a real price of zero. On an **Asset** the retail
  column shows **"n/a"**: it isn't missing, it doesn't apply.
- **The notification bell deep-links into a filter** instead of dropping you on a
  200-row catalog: `stock?missingPrices=1`, `?needsWeight=1`, `?weightReported=1`,
  each with a matching chip. The weight filters are client-side off the same
  `weighInfo()` the rows render from, so a chip count and its list cannot disagree.
- **Asset categories no longer show the Liquid Weight field** or the density
  explainer — an Audio System category has nothing to weigh.
- **Categories tab gained a search.** 48 rows, and the page toolbar's search only
  ever filtered the Items tab.
- **Admin → Users sorts by the name it displays** (last, first) rather than by
  username, which made the list look unsorted.

### Data hygiene — mostly deliberately left alone

- **The typos are the client's own data.** "Reciept Printer", "Mesh Stairner",
  "Champagne Fluit", "Dinning Ware" are transcribed verbatim from their Asset
  Management sheet, and `asset-seed-data.ts` says in its header that this is
  "their data to correct, not ours to silently rewrite". Left as is — worth
  asking Lourd, not fixing behind his back.
- **`pc` vs `Piece` / `Unit` are not duplicates.** The seeder comments explain it:
  the asset register uses the client's exact UOM words, distinct from the
  Beverage/Food count units. Left.
- **Duplicate "First Aid" — root cause fixed, data left.** The two asset seeders
  used *different* lookup keys (`{name}` vs `{name, categoryId}`), so they
  disagreed about what already existed. Aligned, so a fresh seed produces one
  shared item. The two existing rows are each referenced by a real catalog row and
  committed count lines; merging them would rewrite records the audit trail points
  at, which is not worth it for a demo artifact.
- **Removed** the orphaned empty category "Safert First", superseded by
  "Safety — First Aid" in an earlier pass — after asserting it had zero items.

Verified: Bar catalog shows `₱180.00 / —` for Grenadine; the Assets catalog shows
`₱8,000.00 / n/a` and its bell reads **"Nothing needs attention"** (was 70).
Golden fixture: **−₱330.69 / −₱869.57**.

## Phase 31 — Client round 4 (2026-07-28)

### Report access tiers (client notes 1 & 2)

The roles already existed (a teammate renamed READONLY → **AUDIT_VIEWER** and
added **AUDIT_VIEWER_LIMITED**). Three things were missing.

- **Unpaid clients could still download.** The billing lockout only tested for
  writes, and an export is a GET — so a past-due establishment kept taking files
  out. Exports are now refused with a message that says downloads are paused
  while viewing continues. Verified: view 200, download 403.
- **A manual switch**, independent of billing: `Client.allowReportDownloads`
  (migration `20260728120000`, defaults true). The LIS admin can let an
  establishment read every report on screen while withholding the files.
  Verified on a *paid* client: manager view 200, download 403, ADMIN 200.
- **Reports are narrowed by role.** Audit-service viewers see the
  reconciliation set only — 19 cards down to 6. One declaration
  (`AUDIT_VIEWER_REPORTS`) read by the hub, the client route guard and the
  server, so a hidden card cannot still be reachable by URL. Verified as
  AUDIT_VIEWER: all 5 permitted reports reachable, **13/13 others 404, none
  leaked**, dashboard still 200.

  Paid and unpaid see the same list; only downloading differs. Withholding the
  numbers from an unpaid client removes their reason to settle up.

**A real bug the work surfaced:** the READONLY → AUDIT_VIEWER rename shipped
with **no data migration**, so every existing user still carrying `READONLY`
failed `can()` on every permission — they could sign in, then got 403 on the
dashboard and on every report. Silently bricked, not visibly broken. Backfilled
in `20260728130000_rename_readonly_role`.

### Centavos on unit prices (client note 3)

Storage was never the limit — `cost`/`retail` are doubles and `2.705`
round-trips exactly (verified end to end). Only the **display** truncated:
`formatMoney` is capped at 2dp, so a per-gram price rendered ₱0.00 and read as
unpriced. Added `formatUnitPrice` at 3dp — matching legacy's `decimal(11,3)` and
the `1.000` in the client's screenshot — for unit-price cells only, leaving
every total (and the whole Full Audit) on the 2dp formatter. Butter now reads
**₱1.08 / ₱2.705**.

### Typo detection when creating an item (client note 5)

Imports already fuzzy-match (alias → exact → Levenshtein); tested against six
realistic typos, all caught, unrelated names correctly rejected. The gap was
**creating** an item — a typo silently produced a second master item and split
that product's history. Now a near-duplicate returns `409 SIMILAR_ITEM` with
"Yes, it's a different item — create it" / "Let me fix the name". Threshold 0.85,
above the import matcher's 0.6, so `Absolut Vodkaa` is caught while
`Absolut Citron` saves normally — both verified.

`ApiError` now carries the server's `code`, which it had always been sending and
the client had been discarding — callers had to match on message text.

Golden fixture throughout: **−₱330.69 / −₱869.57**.

### Hub grouping and module relevance (2026-07-28)

Narrowing by role left an audit viewer looking at a **"Sales & Revenue" heading
over a single card**. The fix was not to move that card: the sections exist to
make nineteen reports findable, so below roughly six they stop earning their
space. Small set now renders as one flat grid, no headings — role-agnostic, and
it also covers the Asset-only case.

Took the chance to close a finding left open from the ADMIN sweep: **the hub
offered all 19 reports on an ASSET-only location**, seven of which opened to an
empty table. Reports now declare `requiresProductTypes` the way nav items
already did. Deliberately conservative — Par Level is left universal (a reorder
point applies to Supplies too), and Non-Revenue stays because that is exactly
where asset write-offs live.

The one judgement call: the Sales **report** is gated to Beverage/Food even
though the Sales **nav item** deliberately is not. Different objects — the page
records asset write-offs through its Non-revenue tab, the report is about
revenue. Checked rather than assumed: on the Assets location the sales report
returns 0 rows / ₱0 while Non-Revenue carries the 7 write-offs worth ₱16,280.

Verified: audit viewer 6 cards / no headings · Assets location 14 cards /
4 sections (was 19/5) · Main Bar 16 cards / 4 sections, Asset section correctly
absent · golden fixture **−₱330.69 / −₱869.57**.

## Phase 32 — Client note 4: long forms and edit-qty (2026-07-28)

### The primary button leaving the viewport

- **CRITICAL — the Transfer "Receive" dialog could not be completed.**
  `DialogContent` is `position:fixed` and vertically centred with **no height cap
  and no overflow**, so a tall dialog grows past both edges and the page never
  gains a scrollbar to chase it. Measured at 1280×800: at 10 receive lines
  "Confirm Receipt" sat at y=824 with no way to reach it; at 20 lines, y=1069.
  A ten-line transfer is ordinary. Capped at the primitive
  (`max-h-[calc(100vh-2rem)] overflow-y-auto`), which fixes every dialog at once
  including ones not written yet. Verified: at 20 rows the dialog now sits
  37→763 inside an 800px viewport and scrolls internally.

- **HIGH — the recipe builder, which is the client's actual screenshot.** Call
  sites put `overflow-y-auto` on `SheetContent` itself — the same element that
  holds the header, body and footer — so `SheetFooter`'s `mt-auto` only pushed
  the button to the bottom of the *content*, and it scrolled away with the
  ingredient list. Publish left the viewport at **4 ingredients** (button bottom
  819.9 on an 800px screen) and reached y=1508 at 13. "New version" broke a row
  earlier. Same defect on both item-form sheets, from **2 variants**.

  Fixed by making `SheetFooter` sticky to the bottom of the scrollport rather
  than restructuring three sheets — the item form's footer lives *inside* its
  `<form>`, so a body wrapper would have meant surgery at every call site.
  Verified 0 → 15 simulated rows: footer bottom stays at exactly 800.

  Not broken, and worth keeping as the reference pattern: the Purchases and
  Transfers editors put the add-line strip in a fixed `TableSurface` toolbar and
  the commit button in the fixed page header, so only rows scroll.

### Edit quantity

Every quantity field round-trips correctly — decimals, clearing, `0`, blur and
Enter all verified across recipes, sales, purchases, transfers and counts. The
client's "minsan hindi gumagana" was **not** the fields themselves:

- **My own regression from Phase 29.** `focusEntry()` read `activeMode` from the
  pre-update render, so whenever the same state update also changed the mode it
  focused a field that had just unmounted — and the `?.` swallowed the miss.
  Repro: pick a weighable item, switch to Weigh Partial, then Edit a Full-units
  line — focus stayed on the picker and the counter's keystrokes went nowhere.
  `focusEntry(mode)` now takes the target explicitly; `startEdit` passes the mode
  it is switching to, and the item picker derives it from the item being chosen
  (a non-weighable item forces FULL).

- **The recipe builder silently dropped ingredients.** `publish` filtered out any
  row whose serving quantity was blank or 0, with no warning — add six
  ingredients, miss one amount, publish, and that ingredient is simply gone with
  the recipe's cost and margin quietly understated. Far worse with the button
  off-screen, since you could not see the rows and the action at once. It now
  names the offending ingredients and refuses.

- **A cleared price silently stored ₱0.00.** `Number(cost) || 0` turned an empty
  field into a real price of zero — a different claim from "not set" — while
  every other quantity form rejects empty. Now rejected, with `parLevel` still
  mapping blank to null because it is genuinely optional.

### The boot hang — diagnosed and made survivable

**Symptom fixed; the underlying library behaviour is documented, not explained.**

Instrumenting the query cache found it immediately: with the API down, `["me"]`
sits at `fetchStatus: "paused"`, `status: "pending"`, `failureCount: 0` — never
attempted, no error — so `AppShell` renders its skeleton and never reaches
`BootError`. `["settings","preferences"]` errors normally in the same load, so it
is specific to the paused query, not to error handling in general.

Paused pointed at `networkMode`, whose default `"online"` pauses when offline.
Setting it to `"always"` **did not stop the pause**. Measured on
@tanstack/react-query **5.101.2**, with `networkMode: "always"` confirmed on the
query's own options, `onlineManager.isOnline()` true and `navigator.onLine`
true, the query still paused — and stayed paused through an explicit
`refetchQueries`. By React Query's own `canFetch` rule
(`networkMode !== "online" || onlineManager.isOnline()`) that combination should
never pause. I could not account for it, and say so rather than dress up a guess.

What shipped:

- `networkMode: "always"` on the QueryClient defaults. Kept because it is the
  right policy regardless — this API is same-origin, and the online heuristic
  answers "is a network interface up", not "is my server reachable".
- `AppShell` treats `fetchStatus === "paused"` as a reachability failure, before
  the `isPending` check. Order matters: a paused query is still pending.
- The recovery action is a **reload**, not `refetch()` — refetch provably does
  not escape the pause, so a Try Again wired to it is a dead button. The comments
  at both sites record the measurements, not the abandoned theory.

Verified end to end: API down → *"Can't reach the inventory service. Check your
connection, then reload."* with a working button; API back → one click restores
the app. No more infinite skeleton, and no manual URL editing to escape.

Golden fixture: **−₱330.69 / −₱869.57**.

## Phase 33 — Seeder verification harness (2026-07-28)

The ask was to wipe the seeders and rebuild them "fully loaded". Two things had
to exist before that was safe, and building them changed what the work should be.

**1. A way to prove a from-scratch seed.** `prisma migrate reset` is off-limits
here, so nothing could ever run the seeder against an empty database — meaning
no rewrite could be verified, and the golden fixture is *produced by* the seed
data. Added `FNB_DB_FILE` to `src/db.ts` and `prisma.config.ts` (defaults to the
dev database, so normal runs are unchanged), then `npm run verify:seed -w
@fnb/server`: temp file → `migrate deploy` → seed → assert → delete.

**2. Assertions worth trusting.** 41 checks: both period anchors, every table
that drives a screen, and the report-specific shapes (all three sale kinds,
discounted sales, forfeits, asset codes, par levels, the void trail, and each
dashboard next-action). **The existing seeder passes** — the golden fixture
reproduces byte-identical from empty, which is the answer to "can this be
rebuilt safely": yes, and now provably.

### What the harness found immediately

- **No voided records anywhere.** Void + correct is a core guarantee — committed
  records are immutable — and nothing in the seed demonstrated it, so the
  correction UI and the "corrected" badge were undemonstrable. Added
  `seedCorrections()`: a case of 24 keyed as 42, voided with a reason, replaced
  by a correction carrying `correctionOfId`, with the matching Activity entry.

- **A trap worth recording.** Dating that pair 2026-07-16 kept the June fixture
  perfect while silently shifting the 07-14 → 07-20 period by exactly the
  corrected quantity (₱1,080 = 24 × ₱45). "Outside the golden window" is not
  enough — it has to be outside **all** count-anchored periods. Moved to
  2026-07-25, after the last committed count, where it shows up in on-hand
  (correct — that is activity since the count) and moves no reconciliation.
  The 07-14 → 07-20 period is now a **second asserted anchor** so this class of
  mistake fails loudly instead of hiding behind a passing June.

### Test residue found and repaired

The dev database carried a committed count line of **3,123,123 bottles** of Blue
Curaçao — an audit agent had exercised void-and-correct with a junk quantity and
never restored it, which distorted the July period's variance to ₱1.5 billion.
The seeded line (qty 6) had been voided to make way for it. Removed the junk
line, restored the original to ACTIVE, and the period returned to its expected
−₱537 / −₱1,410. Worth noting the agents' "cleanup verified" claims were not
complete.

### On the rewrite itself

Given the harness now proves it, a rewrite is safe to attempt — but the measured
gaps are specific rather than structural: Depot is a stub (1 catalog item,
existing only for the transfer fixture), Non-Moving is empty on Main Bar, and
forfeits/par levels exist on one location each. That is filling, not rebuilding.
Recorded here so the next pass targets those rather than re-deriving them.

## Phase 34 — Filling the coverage gaps (2026-07-28)

Worked the three gaps from Phase 33 against `verify:seed`. Two of the three
turned out differently than the measurement suggested, which is the point of
re-measuring rather than trusting a note.

**Non-Moving on Main Bar was never a seeding gap.** It read 0 because the
corrupted Blue Curaçao count line (3,123,123 bottles) gave that item a usage of
−3.1M, so `hasVariance()` excluded it from the dead-stock filter. Repairing the
residue in Phase 33 already fixed it — Main Bar now reports 1 non-moving row.
No data added.

**Forfeits on more locations: deliberately not done.** They are returned bottles
a customer left behind. Main Bar has 13; the Depot is a stockroom and Casa Verde
is a kitchen. Seeding forfeits there to make a report non-empty would be worse
than an honest empty one — the report is correctly empty because the event
cannot happen at those locations.

**The Depot was the real gap, and is now a working stockroom.** It had one
catalog row and existed only to receive the transfer fixture, leaving Par Level,
Non-Moving, Purchases, On Hand, Cost Snapshot and Usage Cost all empty on the
app's only second BAR location — so a multi-location bar operation, which is the
shape most of these clients run, could not be demonstrated. Added a five-item
catalog with par levels, four committed counts bracketing the existing 06-10
transfer, and a delivery. Modelled honestly: no direct sales, no forfeits, one
item (Bacardi) stocked and never touched so Non-Moving has genuine dead stock.

Depot now reports: par-level 5 · non-moving 4 · purchases 2 · on-hand 5 ·
transfers-in 4 · usage-cost 1.

### What the harness caught in my own work

- **An over-broad idempotency guard.** `if (any Depot count exists) return`
  short-circuited the whole function, because the demo history also counts the
  Depot — so the delivery and the dead-stock row were silently never seeded, and
  the fresh-database run failed on exactly those two checks. Guarding on the
  function's own marker (`name: "Stockroom count"`) fixed it. A broad guard on
  shared data is indistinguishable from a no-op.
- **A comment asserting a number I don't control.** It claimed "a two-bottle
  shortage"; the Depot's period actually lands at +₱585 because the demo history
  counts this location too. Reworded — these lines shape the period without
  owning it, and only the two Main Bar anchors are pinned.

`verify:seed` now runs **47 checks** and passes from an empty database. Both
anchors unchanged on the dev database after reseeding: **−₱330.69 / −₱869.57**
and **−₱537 / −₱1,410**.


---

## Phase 35 — Offline-desktop groundwork (2026-07-30)

The question that started it: *"so if this is a local mirror, what now shall we
build in this system before we build the electron?"* — plus the standing
instruction to plan the data lifecycle for the long term.

### The architectural call, first

Proposal §18 sells the desktop as **"one (1) client computer"** acting as the
**"sole operational interface"**. That is not decoration — it is the reason a
local mirror is buildable at all. One writer per establishment means two-way
merge never arises, and the design collapses into two one-way flows that map
exactly onto the schema split that already existed: `ItemVariant` is global and
LIS-owned (server → device), transactions are per-location and append-only
(device → server). Written up in **docs/sync-and-data-lifecycle.md**, with the
ownership table, the failure cases, and the retention/backup policy.

### What was actually missing

A survey of the schema found four gaps, and the fix for the biggest one turned
out to be smaller than expected:

- **No idempotency anywhere, and no unique constraints on transactional tables.**
  One dropped connection mid-upload silently duplicates a night's sales. Fixed by
  accepting a client-supplied `id` on every create — **the record's primary key
  IS the idempotency key**. The device mints a cuid before writing to its local
  mirror, so a record has one identity from the moment it exists. No token table,
  and therefore no expiry policy for one.
- **7-day sliding sessions.** A machine offline for a fortnight could not
  re-authenticate. Device-bound sessions now last a year and do not slide.
- **`createdAt` is server time.** A day of offline work would stamp itself 9pm.
  Added `occurredAt` (device time) on all ten device-writable models. Purely
  additive and nullable — no report reads it, so the fixtures could not move.
- **No device identity.** Added `Device` + registration on first login
  (trust-on-first-use, capped by the new `Subscription.maxDevices`, default 1)
  + `POST /admin/devices/:id/revoke`.

### What was deliberately NOT built

`updatedAt` columns, tombstones, a "changes since X" cursor, and a batch push
endpoint — the obvious incremental-sync apparatus. A location is 1–2 MB of JSON,
so `GET /sync/snapshot` returns the whole thing and the device replaces its copy;
`?from=` bounds it later, safely, because committed periods are immutable. Push
reuses the ordinary create routes, so the desktop cannot drift from the browser
on validation, permissions or activity logging. Recorded as deviation **#34**.

### Two bugs caught in my own work

- **I deleted five fields while adding one.** The `occurredAt` edits on
  `CountSession` and `Purchase` used a multi-line anchor that swallowed
  `committedAt`/`committedById`/`voidedAt`/`voidedById`/`voidReason`. Caught by
  diffing the schema for removed lines rather than trusting that an "additive"
  edit was additive — `git diff | grep '^-'` on a migration-bearing file is now
  the habit. Final diff: 66 insertions, 0 deletions.
- **`purchaseCreate.partial()` on a PUT became a primary-key rewrite.** That route
  passes `data: body` straight through, so the moment `id` joined the create
  schema, a caller could PUT a new primary key onto a draft. Fixed by omitting the
  sync fields from the editable set — same for `transferCreate.partial()`. The
  lesson generalises: adding a field to a create schema silently widens every
  `.partial()` passthrough derived from it.

### Verified

- `npm run verify:sync -w @fnb/server` — **new**, 30 checks, passed first run:
  retry doesn't duplicate · a foreign id is refused and writes nothing · a
  far-future `occurredAt` is rejected · staff can't register a machine · the
  licence cap holds at one · a device session is 365 days · the snapshot is
  complete and carries no password hashes · revocation locks the machine out
  immediately.
- `npm run verify:seed -w @fnb/server` — 47 checks, **both anchors unchanged**
  after the migration: **−₱330.69 / −₱869.57** and **−₱537 / −₱1,410**.
- Typecheck clean in both workspaces.

The migration also finally drops the stray `LocationItem.industry` column that
`20260724070711` added to the wrong table. `20260728060000` chose to leave it;
the gain has since appeared, because Prisma regenerated that drop on every
`migrate dev`. Verified empty first — 172 rows, 0 non-null.

---

## Phase 36 — Offline login, attribution, and count sheets (2026-07-30)

Closing the one decision Phase 35 left open, plus the two things that turned out
to be inseparable from it.

### The decision: a device PIN, not the password

The client's instinct ("just a device pin with forgot password function") was
right, and for a sharper reason than convenience. The obvious alternative —
ship `User.passwordHash` in the snapshot and verify the ordinary password
locally — needs no new concepts and is wrong: the secret sitting on the bar PC
would be **the same secret** that logs into the web application. Stealing one
computer would become remote access to the establishment's books.

A PIN is a credential the **server never accepts as a login**. Cracking it buys
access to a machine the thief already physically holds. That asymmetry is the
entire design.

What it is not: four digits will not survive an offline attack on the file, and
it is not meant to. Whoever holds the machine holds the mirror; encryption at
rest answers that, not a longer PIN. The PIN buys casual-access control,
attribution, and a blast radius of one revocable device. Written down plainly in
the doc rather than left as an implied claim.

**Recovery, ordered by what actually happens** rather than by what is easiest to
build: online reset with your password (the network is usually up) -> a manager
clears it, which is stronger than any question because it needs a second human
who is present -> a self-written recovery question as the offline break-glass.
Self-written because shipping a canned "mother's maiden name" list is how that
becomes the weakest link. Rate-limited on the same 5-attempt/1-hour lockout as
login, and every use writes a `pin.recover` row that syncs to the admin — a
break-glass with an alarm on it.

Policy lives in `@fnb/core` (`validatePin`), so the Electron app enforces the
identical rule. A PIN the desktop accepted but the server would reject is a
credential that stops working the moment the machine reconnects.

### What the PIN surfaced: attribution was broken

Chasing "who is signing in offline" exposed a bug that had nothing to do with
PINs. A desktop holds **one** session — the one opened when the owner registered
it — while a whole shift uses the machine. Nineteen routes read the session user
for `createdById`. Every count line pushed from that computer would have carried
the owner's name. An audit trail that credits one person for everyone's work is
worse than no audit trail; it is a confident lie.

Fixed in `sessionMiddleware`, not in nineteen routes: the desktop sends
`X-Acting-User` and the middleware swaps the person in once. Because it happens
at the session layer, **permissions follow the real actor too** — verified that
STAFF still cannot void from the owner's device session. A browser session
cannot use the header at all, and an unrecognised claim is a 403 rather than a
silent fallback to the session user, which would have re-created the exact bug.

### Physical Count Sheets (§3.11)

Zero server code — the catalog hook already existed, so this is one page. The
only real decision was making it **blind**: no expected quantity, no par level,
no cost or retail. Printing the expected figure beside an empty box is how you
get counters copying the system's number instead of counting the shelf, and the
gap between those two numbers is the whole product. Every other report exists to
show expected-vs-actual; this one exists to collect the actual.

### Verified

- `npm run verify:sync -w @fnb/server` — **45 checks** (up from 30), all passing:
  guessable PIN refused, wrong password refused, recovery works
  case/space-insensitively and is logged, a wrong answer leaves the PIN alone,
  a device push is credited to the acting staff member rather than the owner,
  STAFF still cannot void on a device session, unknown actor 403, a browser
  session cannot impersonate, snapshot carries `pinHash` but never
  `passwordHash`.
- `npm run verify:seed -w @fnb/server` — 47 checks, both anchors unchanged.
- Typecheck clean in both workspaces; PIN set end-to-end through the real UI
  (weak-PIN rejection inline, POST 200, badge and forgot-link appear).

### Two notes from the run

- **A harness check that passed for the wrong reason.** "A wrong recovery answer
  is refused" returned 400 — but only because the throwaway question in the test
  body was 3 characters and failed zod's `min(5)` before the answer was ever
  checked. Every field in a negative test has to be independently valid or the
  test asserts nothing. Now asserts 401 specifically, and that the stored PIN is
  untouched.
- **A browser click that "failed" and hadn't.** The Set PIN button appeared not
  to fire; the fields were populated and the button enabled. The cause was the
  Browser pane not compositing frames, so synthetic clicks never reached React —
  not a bug in the form. Dispatching the click directly completed the flow.

---

## Phase 37 — Two-way operation: the plan (2026-07-30)

Client request: make the desktop a full replica of the web app, both usable at
the same establishment, changes flowing each way. This retires the
single-writer assumption Phase 35 was built on. **Planning only — no code.**
Design lives in docs/sync-and-data-lifecycle.md §7.

### Why this is cheap rather than a rewrite

Phase 35 justified the mirror with §18's "one (1) client computer" — one writer,
so no merge. That justification is gone, but the design survives, because the
real reason it works was never the single writer:

**Almost every write in this system is an append.** Sales, forfeits, count
lines, purchase lines, transfer lines, receipts — all INSERTs with globally
unique ids. Two sources inserting different rows have nothing to merge.
Corrections are already void-plus-replacement rather than edits, so even
"changing" a committed record is an append. That is the ledger discipline the
project has enforced since day one, now paying for itself.

Auditing every mutating route, the non-append surface is exactly **19 routes**:
3 hard deletes of draft lines, 3 draft/open mutations, ~10 status transitions,
3 catalog/master edits. That is the entire conflict surface, and it is small
enough to close case by case rather than with a merge engine.

### The four rules

1. **Open work belongs to where it started.** `originDeviceId` on CountSession /
   Purchase / Transfer; while OPEN or DRAFT only the origin may touch it, the
   other side sees it read-only. This *deletes* the draft-merge problem instead
   of solving it, and matches reality — one person is walking round with the
   scale. Needs a force-release escape hatch or a dead bar PC freezes an open
   count forever.
2. **The server decides status.** Commit/void become compare-and-set with the
   expected status; a mismatch is a 409 that goes to a human, never auto-applied.
   This is the one place a genuine idempotency-TOKEN table is unavoidable: for
   creates the primary key answers "did this apply?" for free, but a void is not
   a new row, so a replayed void is indistinguishable from someone else's
   without an `opId`. Hence `SyncOp` — and it is the first table in the project
   with a retention policy (90 days), which is why §7.6 exists.
3. **Catalog and master data stay server-authoritative.** Offline you can count,
   sell, receive, forfeit — you cannot re-price. `LocationItem` carries cost and
   retail, and last-write-wins on a price is how a client's stated inventory
   value changes without anyone deciding to change it.
4. **Nothing is silently dropped.** Rejected pushes land in a conflict inbox. A
   sync that quietly discards work is worse than one that fails loudly, because
   the count still balances — against the wrong numbers.

### The two things flagged as genuine costs

- **Duplicate human entry is unfixable by sync.** Staff records a delivery on the
  desktop, the manager records the same delivery in the browser: two records,
  different ids, both valid, indistinguishable from a genuine repeat delivery.
  The single-writer rule prevented this structurally. Mitigation is product-level
  (detect same item+date+qty from a different source, show provenance on every
  record), not algorithmic — and the client should be told before it happens.
- **A stale Full Audit is the most dangerous artefact this feature can produce.**
  The desktop can compute the one report the client trusts above all from a
  mirror that is hours old. Decided: every screen shows "synced <time>", and the
  Full Audit refuses to print or export while unsynced changes exist or the last
  sync predates the reported period — overridable only as an explicitly
  watermarked draft.

### Also decided

Stale-authorisation cases were worked through rather than left implicit. The
governing principle: **never destroy real audit records to enforce an
access state.** A user disabled mid-offline-stretch keeps working locally; their
pushed records are accepted and flagged, not discarded, because the work actually
happened. Same for a subscription that lapses mid-stretch — accept what was
recorded before the lockout, block what comes after. Permission changes are
re-checked at push time, so a demoted user's void is rejected into the inbox,
which is the correct outcome and the reason permissions are enforced at push and
not only in the UI.

Suggested build order is in §7.7. Steps 1–5 are all server-side and verifiable
through `verify:sync` before any Electron code exists; only step 6 (outbox,
merge-on-pull, conflict inbox) lives in the desktop.

---

## Phase 38 — Two-way operation, server half (2026-07-30)

Building the §7 plan from Phase 37: browser and desktop both writing, changes
flowing each way. Everything here is server-side and verified before any
Electron code exists.

### Shipped

- **Migration `two_way_sync`** — purely additive, no table rebuilds:
  `originDeviceId` on CountSession / Purchase / Transfer (ownership) and on
  SaleRecord / Forfeit (provenance), plus the `SyncOp` table.
- **Rule 1, draft ownership** (`assertMayEditDraft`): while a document is
  OPEN/DRAFT only the source that started it may add, edit, delete or commit.
  Wired into all six draft-mutating routes across counts, purchases and
  transfers. Plus `POST /drafts/:entity/:id/release` — an owner can free a draft
  stranded on a dead machine, because without it a bar PC that dies mid-count
  freezes that count open forever.
- **Rule 2, replay-safe status transitions**: `opId` + `expectedStatus` on
  commit/void. This is the one place a genuine idempotency-TOKEN table is
  unavoidable — a create carries its own primary key, but a void changes an
  existing row, so without a token a replayed void is indistinguishable from
  someone else's void, and those need opposite handling. `recordOp` writes in
  the same transaction as the mutation.
- **Rule 3, catalog stays server-authoritative** (`assertNotQueuedEdit`) on
  price/weight and supplier edits.
- **Rule 4 surfacing**: `GET /sync/duplicates` (double-entry review) and
  `GET /sync/status` (which machines hold unpushed work).
- **`SyncOp` pruning on `/sync/ack`** — 90 days. The only table in this schema
  that is not kept forever, so it is the only one needing this. Done at ack
  because there is no scheduler in this project, and a retention policy that
  lives only in a document is not a retention policy.

### Two corrections to my own Phase 37 plan

- **`updatedAt` on the three headers was specced and then dropped.** `status` is
  already the version for these documents, and Rule 1 means an open draft has no
  concurrent editor. It would have been a column nothing read.
- **Rule 3 was nearly a no-op.** The plan claimed catalog edits "cannot be
  queued, structurally, because the catalog schemas never carried syncFields".
  Half true: no idempotency key means no *replay* — but `locationItemUpdate` is
  not `.strict()`, so zod silently STRIPS an `occurredAt` and a queued price edit
  would have sailed through validation and applied last-write-wins. The guard has
  to read the RAW body to see the marker. Caught by writing the test.

### Two harness checks that passed for the wrong reason

Both found by reading the status codes rather than the green ticks.

- **Rule 3** returned **403, not 400** — the acting user was STAFF, so the
  `prices.edit` permission guard rejected it and the new guard never ran. Fixed
  by dropping the acting-user header (the owner has `prices.edit`), asserting
  exactly 400, and adding a **control**: the same edit *without* the offline
  markers must still succeed, or the guard is just breaking desktop price edits
  entirely.
- Earlier in the same session, the PIN recovery check returned 400 because a
  3-character test question failed zod before the answer was ever checked.

Same lesson twice: a negative test whose fields are not independently valid
asserts nothing, and an assertion loose enough to accept two status codes will
eventually accept the wrong one.

### Deliberately deferred

The browser-side UI for all of it. With no registered device, `originDeviceId`
is null everywhere, `anyStale` is always false and the duplicate report is always
empty — there is nothing to render. Server rules are enforced and verified now
because they are migrations and route logic; the screens come with the desktop,
when there is state to show.

### Verified

- `npm run verify:sync -w @fnb/server` — **65 checks** (up from 45): the desktop
  cannot touch a browser-owned count and vice versa, ownership is recorded, an
  owner can release a stranded draft and the browser can then work on it,
  replaying the same op is a success while a different op against stale state is
  a conflict, the op is recorded exactly once, commit still works with no body at
  all, a queued price edit is refused while a live one succeeds, and both review
  endpoints serve.
- `npm run verify:seed -w @fnb/server` — 47 checks, **both anchors unchanged**:
  −₱330.69 / −₱869.57 and −₱537 / −₱1,410.
- Typecheck clean in both workspaces.

---

## Phase 39 — Adversarial review of the desktop design (2026-07-30)

Before writing any Electron code, ran a multi-agent investigation and an
adversarial critique of the proposed sync design across four lenses
(correctness, audit integrity, security, 2am bar operations). Three of the four
returned **broken**. 18 blockers. Several were bugs in ALREADY-SHIPPED code, not
just in the plan — which is the entire argument for doing this before building
on top of it.

### Fixed this phase

**A live security hole in Phase 36's snapshot.** `GET /sync/snapshot` had NO
permission gate beyond ordinary location access. Phase 36 added device-PIN and
recovery-answer hashes to that payload, so any authenticated user of the
establishment — a STAFF member, or a third-party AUDIT_VIEWER whose entire role
is "read the reconciliation" — could pull every colleague's offline credentials,
including the owner's, and brute-force a 4-digit PIN at leisure with no network
and no trace. Now device-sessions-only, scoped to the device's own client. A
browser has no use for a snapshot; restricting to the one caller that needs it
closes the hole rather than narrowing it.

**The snapshot could not boot the app it serves.** It returned display subsets —
`location: {id,name,kind}`, `client: {id,name,costBasis,varianceThresholdPct}` —
but `requireLocationAccess` re-reads `Location.status`, `Client.status` and a
`UserClientAccess` row on every request. Offline, every API call would have
404'd for every non-ADMIN. Now ships full rows plus an `identity` block
(subscription, clientAccess, userModules).

**LocationModule was missing, and that one does not throw.** Every report route
filters on the location's module set, and an ABSENT set reads as *unrestricted*
rather than *none*. So a BAR-only location would have produced an offline Full
Audit including KITCHEN stock while the server's excluded it — two different
totals on the one report the client trusts absolutely, with nothing to signal
it. This is the failure mode §7.5 exists to forbid, and it would have survived
the obvious fix for the 404s above.

**Count-line valuation was minted at PUSH time, not count time.** `unitCost`/
`unitRetail` were stamped from whichever catalog the request landed on. A count
taken Monday 2am and pushed Wednesday would carry Wednesday's prices — so a
repricing in between silently restated a finished count, while
`report-assembly` reads those fields as "snapshot from count time". Same class
for `recipeVersionId`, which resolved to the LATEST recipe at push time, so an
offline menu sale would deplete the wrong version's ingredients. Both are now
accepted from the request and honoured for device sessions only.

**Code contradicted the doc on disabled users.** `resolveActingUser` filtered on
`status: "ACTIVE"`, so a user disabled while their machine was offline would
have had a week of real counts rejected at the middleware. §7.5 states the
opposite decision explicitly — accept and flag, because the work really happened
and discarding it falsifies the audit. The filter is gone; client scoping (the
actual trust boundary) stays. `logActivity` now folds `deviceId` and a
`disabledActor` flag into every entry, in one place rather than at nineteen call
sites, so "accept" comes with the "flag" the doc promised.

### Runtime findings that reshape the Electron build

- **better-sqlite3 12.11.1 is raw-V8, not N-API** (zero napi refs in its .cpp),
  so it is ABI-locked and must be rebuilt for Electron — and it is hoisted to
  the monorepo ROOT, where electron-builder's default app-dir rebuild will
  silently miss it.
- **Prisma 7.8 has no Rust query engine.** It compiles queries with a ~3.5 MB
  WASM module instantiated via a SYNCHRONOUS `new WebAssembly.Module()`.
  Chromium forbids sync compile above 4 KB on a document thread, so the DB layer
  physically cannot live in the renderer — it belongs in a `utilityProcess`.
  This is a hard constraint, not a preference.
- **The server has never been compiled** (`noEmit: true`, run via tsx) and the
  generated client is ~3.5 MB of TypeScript. An esbuild → ESM bundle step is
  mandatory before packaging.
- **`prisma migrate deploy` cannot ship** (41 MB CLI + 21 MB schema-engine.exe).
  The alternative is a small runner using better-sqlite3 directly — Prisma's
  `_prisma_migrations.checksum` is plain hex-sha256 of the raw migration.sql
  bytes, so hand-written rows stay byte-compatible with the server's database.

### Verified

- `verify:sync` — **70 checks** (up from 65), including the new gate: a browser
  session cannot download a snapshot (403), and the snapshot carries the full
  location/client rows, the client-access rows and the module set.
- `verify:seed` — 47 checks, **both anchors unchanged** after touching count-line
  price snapshotting: −₱330.69 / −₱869.57 and −₱537 / −₱1,410. That is the
  load-bearing check, since that code feeds reconciliation.
- Typecheck clean in both workspaces; production web build succeeds.

### Still open (from the critique, not yet fixed)

Outbox atomicity (HTTP-layer capture cannot write in the mutation's
transaction), no un-revoke/retire route so freeing a licence slot bricks a
machine's queue, `?from=` bounding by business date freezes stale copies of
periods that voids/corrections still mutate, DELETE/PUT not replay-safe,
device-clock skew baking unrecoverable `occurredAt` into the outbox, offline PIN
brute-force having no local lockout, and X-Acting-User needing to be part of the
captured tuple. These are design-level and belong with the sync engine itself.

---

## Phase 40 — Blocker fixes + the desktop foundation (2026-07-30)

Resolved the seven design blockers the Phase 39 critique left open, then wrote
the Electron app's core.

### The four that needed server support

- **`POST /sync/reconcile`** — the answer to a failure HTTP-layer capture
  structurally cannot prevent. Capture runs after the route's `$transaction`
  commits, so a force-quit or full disk in that window writes a record with no
  outbox entry, and nothing would ever notice. The device now asks "which of
  these did you never receive?" and re-queues the answer. It also catches every
  other cause of the same symptom, which a transaction-scoped outbox would not —
  that is why it beat restructuring the write path of nineteen routes.
- **`POST /admin/devices/:id/reactivate`** — revocation was a one-way door with a
  data-loss trap behind it. The licence cap counts only ACTIVE devices, so the
  registration error tells an admin to "revoke the old one" to free a slot; if
  that machine later boots holding a week of counts it could never authenticate
  again. The prescribed recovery action was the destructive one.
- **`since` cursor on the snapshot** — `from` bounds by BUSINESS date on the
  premise that committed periods are immutable, and they are not: voiding or
  correcting a committed count line leaves its countDate in the old period. A
  June line voided in July would never reach a mirror bounded to July. Also
  reaches into child lines, because voiding a line does not touch its session's
  `voidedAt`.
- **`/sync/ack` accepts local events** — a closed enum, not free-form log lines,
  so an offline PIN lockout reaches the audit trail without opening a channel a
  machine could write anything into.

### The three encoded in the engine

- **Attribution in the captured tuple.** Attribution travels in a header; without
  storing `actingUserId` on the outbox row, every replayed record would be
  credited to whoever registered the machine — the exact "confident lie" §5b
  exists to prevent, and invisible afterwards because the rows look well-formed.
- **`occurredAt` stamped at PUSH time** from a monotonic capture plus the
  measured server clock offset. A dead CMOS battery would otherwise bake a
  future timestamp into a frozen body that the server rejects with a 400 forever;
  the reverse case is worse for being silent.
- **DELETE-404 treated as convergent.** A delete whose target is already gone
  means the world is in the state the request wanted. Treating it as a conflict
  turns one lost response into a stalled causal chain — the commit queued behind
  it never pushes and a whole count session never lands. Plus outbox collapsing,
  so a create-then-delete of a never-pushed id cancels out.

Rule 3 also moved its enforcement point: the server guard only rejects edits
carrying offline markers, and a replayed catalog PUT carries none, so the outbox
now refuses to enqueue catalog/master paths at all. The server check stays as
defence in depth.

### apps/desktop

Written: `migrate.ts` (Prisma migrations without the 60 MB CLI — checksums are
plain hex-sha256 of the raw SQL, so the result is byte-compatible with the
server's), `host.ts` (the real Hono server in a **utilityProcess**), `main.ts`,
`preload.ts`, `sync/{outbox,engine,capture}.ts`, esbuild config.

The utility process is a hard constraint, not a preference: Prisma 7.8 compiles
queries with a ~3.5 MB WASM module via a synchronous `new WebAssembly.Module()`,
which Chromium forbids above 4 KB on a document thread — so the DB layer cannot
live in the renderer, and the main process would freeze the window.

**Not yet runnable.** `npm install` has not been run for this workspace, and
`better-sqlite3` must be rebuilt for Electron's ABI first (it is raw-V8, not
N-API, and npm hoists it to the repo root where `@electron/rebuild` will
silently find nothing without `--module-dir ../..`). Remaining: IPC handlers,
the PIN unlock screen with local lockout, first-run provisioning, electron-builder
config, and running the golden fixtures against a device mirror.

### Verified

- `verify:sync` — **79 checks** (up from 70), all passing.
- `verify:seed` — 47 checks, both anchors unchanged.
- Typecheck clean for @fnb/server and @fnb/web (@fnb/desktop cannot typecheck
  until its dependencies are installed).

---

## Phase 41 — The desktop launches (2026-07-30)

Installed Electron 33.4.11 and got `apps/desktop` running end to end. Five real
failures on the way, each a genuine bundling/runtime constraint rather than a
typo.

### What works

Window opens ("LIS — Inventory Solution"), the utility process migrates a fresh
mirror at `%APPDATA%/@fnb/desktop/mirror.db` (**22 migrations, 38 tables,
`_outbox` created — with no Prisma CLI**), the embedded Hono server listens on
127.0.0.1, and the SPA loads and renders against it: `/api/health` OK, `/` 200,
`/api/auth/me` correctly 401.

### The five failures

1. **`npm install` pruned the hand-copied native module.** npm owns workspace
   `node_modules` and removes anything it did not install. Replaced the manual
   copy with `native.mjs`, which recreates it, fetches the Electron prebuild, and
   **asserts the two binaries differ** — a silent no-op there would surface much
   later as an unhelpful `NODE_MODULE_VERSION` error.
2. **`Dynamic require of "crypto" is not supported`** — exceljs is CJS and calls
   `require` lazily at module scope, which esbuild's ESM output shims with a
   throwing stub. Fixed with a `createRequire(import.meta.url)` banner rather
   than abandoning ESM, which the generated Prisma client and the server's
   top-level `await` both need.
3. **ENOENT on `lis-logo.png`** — `exports.ts` and `pdf.ts` resolve assets from
   `import.meta.url` at MODULE scope, which points at the bundle once built. The
   build now copies the assets next to `dist/`; patching the server would have
   put desktop concerns into shared code, and those paths are correct there.
4. **ENOENT on `data.trie`** — fontkit reads its own data files off `__dirname`.
   Chasing each file was a losing game, so pdfmake/exceljs/@foliojs-fork are now
   **external**, which also cut the bundle 7.4 MB → 2.0 MB. pdfmake had to be
   declared a dependency of `@fnb/desktop` first: it is not hoisted, it lives in
   `apps/server/node_modules` where a desktop bundle could never resolve it.
5. **A window that never appeared.** `ready-to-show` was attached AFTER
   `await loadURL()`, by which point it had already fired — a running app with no
   UI, which looks exactly like a crash. Listener moved before the load, plus an
   `isVisible()` fallback.

Also worth recording: **Electron detaches stdout on Windows**, so the first
crash produced no output whatsoever — only the startup-timeout dialog. Running
`dist/host.mjs` under `ELECTRON_RUN_AS_NODE=1` is what surfaced every error
above; that recipe is now in the desktop README.

### Two-ABI note

The repo now holds two `better-sqlite3` builds on purpose: Node ABI 137 at the
root (server + both harnesses) and Electron ABI 130 under `apps/desktop`.
Verified distinct by hash, and verified the root one still loads under Node —
`verify:sync` (79) and `verify:seed` (47, both anchors) still pass after the
install.

---

## Phase 42 — Provisioning, chrome, and the manual (2026-07-30)

### The menu bar is gone

`Menu.setApplicationMenu(null)` on Windows/Linux. Those File/Edit/View entries
were Electron's stock menu, not ours, and every one of them is either irrelevant
to an inventory terminal or unwanted on one — "Toggle Developer Tools" a click
away from a staff member mid-count. macOS keeps its menu because the standard
edit accelerators stop working without one; Windows handles Ctrl+C/V natively in
text fields, so removing it there costs nothing.

### First-run provisioning

Setup window (before any server exists, because on first run there is nothing
worth serving) → owner signs in → device registers → pick a location → pull the
first snapshot → relaunch into the app.

Design points worth keeping:

- **The fingerprint is a persisted random id, not hardware-derived.** Serial
  numbers and MAC addresses look more "real" but change with a NIC swap or a
  dock, and the server treats a new fingerprint as a NEW device — consuming a
  licence slot and stranding the old machine's outbox.
- **The first pull is unbounded.** Bounding it would leave the mirror unable to
  reconcile any period older than the cutoff, and a device that cannot compute
  last month's Full Audit offline is not a mirror.
- **Config is written only AFTER the snapshot lands**, or a machine would
  believe it is provisioned while holding nothing, and boot into an empty mirror
  instead of back into setup.
- **The session is encrypted with `safeStorage`** (DPAPI), so copying
  config.json to another machine yields nothing. Plaintext fallback warns loudly
  rather than downgrading silently.

### Four failures found by rehearsing it headlessly

1. **`config.ts` could not be imported outside Electron** — a top-level
   `import { safeStorage } from "electron"` made the whole provisioning path
   untestable. Now resolved lazily, which is better design anyway.
2. **Insert order was wrong**: `Item` is a PARENT of `ItemVariant` but arrives
   nested inside one, so variants were written first and the FK failed.
3. **Foreign keys had to come off for the merge** — and this is not laziness. A
   mirror is a PARTIAL view: a transfer this location dispatched carries receipt
   lines pointing at the DESTINATION's catalog rows, and that location's catalog
   is rightly not in this snapshot. Enforcing FKs rejects real, correct data.
   Restored immediately after.
4. **`User.passwordHash` is NOT NULL and the snapshot deliberately omits it.**
   Local users now get a sentinel that `verifyPassword` can never accept — so
   the LOCAL server cannot authenticate anyone by password at all. That is not a
   workaround; it is the offline design enforced by construction, with the PIN
   as the only way in.

### The check that mattered

`npm run verify:mirror -w @fnb/desktop` — registers a device, pulls a real
snapshot into a throwaway mirror, applies it (515 rows, 26 tables), then
computes the Full Audit **off the mirror** and asserts both pinned anchors:

```
  ok   2026-06-01→2026-06-08  cost -330.6857142857142  retail -869.5714285714284
  ok   2026-07-14→2026-07-20  cost -537.0000000000001  retail -1410.0000000000002
MIRROR MATCHES THE SERVER
```

This is what docs §7.5 requires and the only thing that proves the copy is
faithful — counting rows proves nothing about whether the numbers agree.

Also written: **docs/desktop-manual.md** — install, first-run setup, who signs
in and how, PIN policy, where the data lives, device management, sync in plain
terms, troubleshooting (including how to get logs when Electron discards stdout
on Windows), and an honest list of what is not built.

### Verified

- `verify:mirror` — both anchors reproduce off a device mirror.
- `verify:sync` 79 · `verify:seed` 47, both anchors · typechecks clean.
- Dev database restored: rehearsal devices removed, `maxDevices` back to 1.

---

## Phase 43 — Desktop chrome: unlock, status bar, conflict inbox (2026-07-30)

### Shipped

- **PIN unlock screen** (`unlock.html`) — pick your name, numeric keypad, local
  5-attempt/1-hour lockout. Accounts with no PIN are listed but disabled and
  labelled, rather than failing at the keypad.
- **Local session minting.** The local server runs the SAME `sessionMiddleware`
  as the hosted one, so unlocking has to produce a real local `AuthSession`
  bound to a local `Device` row. The mirror gets neither from a snapshot — a
  device does not mirror itself — so the machine writes its own from config.
- **Sync status bar** — device name, queue depth, last push, Sync now.
- **Conflict inbox** — lists what the server refused, with dismissal. Never
  auto-resolves; that is the entire point of it.
- **Background sync** every 5 minutes, first run delayed 15s so it never
  competes with startup. Failures are swallowed: offline is this app's NORMAL
  state, and a toast every 5 minutes would train people to ignore the one that
  matters. The queue depth in the bar is the honest signal instead.
- **Offline PIN failures reach the audit trail** via the `/sync/ack` events
  channel added in Phase 40.

### Chrome is injected by the preload, not added to apps/web

It is desktop chrome, not application content — meaningless in a browser, where
there is no queue and no mirror. Putting it in the SPA would ship dead UI to
every web user and fork the renderer the desktop exists to reuse verbatim.

### Four failures worth recording

1. **ESM preload scripts are silently ignored when `sandbox: true`.** No error,
   no warning — the script just never runs, and the status bar never appeared.
   Electron only supports ESM preloads with sandboxing OFF. The preload is now
   the one bundle built as CJS (`dist/preload.cjs`); the others stay ESM.
2. **The unlock POST was being captured into the outbox**, so every sign-in
   queued a request the server has never heard of, which would 404 straight into
   the conflict inbox. Capture now skips `/_desktop/*` as well as `/sync/*`.
3. **`DevicePin.updatedAt` is NOT NULL** and the snapshot omitted it. Never hit
   during the earlier rehearsal because no PINs existed then — found only by
   testing with real data.
4. **Backticks inside a CSS comment** closed the JS template literal holding the
   stylesheet. Now guarded by an assertion in the patch step.

### The UI fixes

- **Double scrollbars.** The first version added `body { padding-bottom }` to
  make room for the status bar. Wrong: the shell is sized with `h-svh`, so extra
  body height made the DOCUMENT taller than the viewport — a second scrollbar
  beside the app's own, and a header scrolled half out of view. Replaced by
  reducing the height the shell measures against
  (`calc(100svh - top - bottom)`), which keeps exactly one scroll container.
  Verified in the real renderer: `scrollHeight 800 == clientHeight 800`, shell
  738px = 800 − 32 − 30.
- **Royal blue title bar** instead of OS black. Electron cannot recolour a
  native caption, so `titleBarStyle: "hidden"` + `titleBarOverlay` draws real
  window controls over our colour, and the preload adds a draggable strip. The
  colour is `--sidebar` converted from `oklch(0.28 0.09 264)` → `#112555` —
  computed, not eyeballed, because "close enough" is how a product ends up with
  five brand blues.

### Verified

- Unlock: wrong PIN counts down ("4 attempts left"), correct PIN signs in, and
  `/api/auth/me` returns `staff / STAFF` from the LOCAL mirror.
- Status bar mounts in the real renderer: "Front bar PC · all work synced".
- `verify:mirror` — both anchors still reproduce off a device mirror.
- `verify:sync` 79 · `verify:seed` 47 · typechecks clean.

Dev-only note: `verify:mirror` needs one free licence slot and a provisioned
desktop holds it, so the test client's `maxDevices` is now 2. The shipped
default stays 1, matching §18.

---

## 2026-07-31 — Windows installer, and a UX pass by the interaction laws

### Packaging (`npm run dist -w @fnb/desktop`)

`electron-builder.yml` → `LIS Setup <version>.exe`, ~90 MB, per-user install so
no admin password, desktop + Start Menu shortcuts. Unsigned, so SmartScreen
warns on first run until a certificate is bought.

Four defects that only appear once installed — each invisible from source:

- **better-sqlite3 was not packed at all.** It lives in
  `apps/desktop/node_modules` (placed by `native.mjs`, not npm), so the
  dependency walker never saw it. Now a declared dependency + `asarUnpack`.
- **electron-builder 25 silently omits `call-bind-apply-helpers`.** Its
  collector mishandles npm workspace hoisting when a package exists both at the
  root and nested under `call-bind`; it kept only the nested copy, so
  `dunder-proto` could not resolve it and the local server died at launch.
  **v26+ is required.**
- **`@electron/rebuild` recompiled the root better-sqlite3** — needs a C++
  toolchain, and on success would have broken `verify:seed` and the dev server
  with an ABI mismatch. `npmRebuild: false`.
- **Uploads resolved into the read-only install directory.** `FNB_UPLOADS_DIR`
  now points at the per-user data dir; `FNB_CWD` does the same for
  `serve-static`, whose relative root a shortcut's "Start in" could break.

Cut 57 MB: Prisma ships a WASM query compiler per database and we were packing
MySQL, Postgres, CockroachDB and SQL Server for an app that opens one SQLite
file. Asar 97 → 41 MB.

The host now pipes stdout/stderr to `%APPDATA%\@fnb\desktop\host.log`. Windows
gives a packaged GUI app no console, so `stdio: "inherit"` sent every crash
trace to nowhere — the `call-bind-apply-helpers` bug was undiagnosable until
this existed.

### UX pass

Audited against Jakob / Fitts / Miller / Hick / Proximity / Tesler. Most of the
app already satisfied them — the Full Audit's 8 columns are chunked into three
labelled header bands, the dashboard computes the next action rather than asking,
and "Not counted" is tappable to jump to the item. Two real defects:

- **`EntryActions`** (`components/entry-fact.tsx`). The row action cluster was
  hand-rolled in five screens and each ordered it differently — Sales
  Cancel→Edit, Transfers Correct→Void, Purchases editor Void→Edit. The same row
  teaching three muscle memories is Jakob's Law broken *inside* the product.
  Now one component taking **data, not markup**, so a caller cannot express a
  different order: safe actions first, destructive last, everywhere.

  The first pass also enlarged these to `sm` with 12px of separation, arguing
  Fitts's Law in reverse — distance guards a destructive button. **Reverted on
  sight of the rendered screen.** These rows are dense fact lists, and two
  chunky buttons held apart stopped reading as one row's controls and started
  competing with the entry itself. Every action here is already behind a confirm
  dialog, so a mis-tap costs a dismissed dialog, not a lost line, and the row
  does not need to carry the safeguard twice. Back to `xs` at a 4px gap; only
  the ordering changed. A law correctly applied to the wrong surface is still
  the wrong call.
- **Recent Activity folds runs** of the same action by the same person. Four
  failed PIN attempts from one terminal filled four of five slots and pushed a
  voided sale off the bottom. Only *consecutive* entries fold, so the feed stays
  chronological; the dashboard query now reads 25 and folds to 5, because
  folding at `take: 5` would have left a two-row panel instead of refilling it.
  Reads "4 similar events", never "4×" — some summaries carry their own tally
  ("3 failed PIN attempts") and a bare multiplier beside one reads as arithmetic.
  ActivityLog is untouched; Administration → Activity still lists every row.

### Deliberately NOT changed

- **"Local Database" / "Main Database" stay.** They look like jargon but they
  are Lourd's own words (2026-07-28: "Since Local Database lang naman ang
  nakikita ni user at hindi whole Main Database"). Renaming them would break
  Jakob's Law, not serve it.
- **Print / Excel / CSV / PDF stay as four buttons.** Hick's Law would suggest
  one "Export" menu, but those labels are *recognised*, not evaluated, so the
  choice cost is near zero — while burying them adds a click to a task an audit
  firm repeats daily.

### Verified

- Packaged app: SPA 200, `/_desktop/people` returns 5 users (native addon loads
  from outside the asar), `/api/auth/me` 401 (auth middleware ran, so Prisma
  reached SQLite).
- Golden anchors after touching `dashboard.ts`: −330.6857142857142 /
  −869.5714285714284 and −537 / −1410. Both exact.
- Collapse verified on live data: the PIN run folded and three previously
  hidden events surfaced.
- Typechecks clean across server, web, desktop. `@types/better-sqlite3` added —
  the desktop typecheck had been failing at HEAD too.

---

## 2026-07-31 (later) — second UX pass, web only

Desktop deliberately **not** rebuilt; see "Pending for the desktop" below.

### Changed

- **Row action density reverted.** See the corrected entry above. `xs`, 4px gap,
  ordering kept. The quick-entry primary buttons (Save Sale, Save line, and both
  editors' Add line) went default → `sm`: 41px → 36px with tighter padding, so
  they stop looking bulky beside a compact fact list.
- **Settings grouped into "Your preferences" and "Establishment settings."**
  Seven sections ran down one hairline-divided list as visual peers, and they
  are not peers: Inventory Cost Basis restates every valuation figure and
  Variance Highlight Threshold changes what the Full Audit flags in every
  download — for the whole client — while Text Size changes nothing but your own
  browser. Proximity now carries the distinction, and each group's subhead says
  the consequence in words. Section headings dropped h2 → h3 so the hierarchy is
  real for screen readers, not just visual.
- **"Save" → "Save Threshold."** The one unscoped save on a page where every
  other one names its target ("Save Company Info", "Save Product Types").
- **Dismiss buttons say "Go Back", not "Cancel" — 11 dialogs.** `ConfirmDialog`
  already documented this rule ("so it can't be confused with the Cancel action
  that voids a record") and every hand-rolled dialog ignored it. Worst case was
  `sales/index.tsx`, where a row button "Cancel" voids the sale and a dialog in
  the same file used "Cancel" to mean *don't*. Same drift pattern as the button
  ordering: a rule set in one place, unenforced everywhere else.
  `counts/session.tsx` gets "Stop editing" instead — it aborts an in-progress
  edit rather than dismissing a dialog, on the screen where rows also say
  "Cancel".

### Audited and deliberately left alone

- **Toolbar search widths** (459–909px across screens) are `grow`-to-fill by
  design, with a measured 9rem floor already reasoned about in
  `table-surface.tsx`. Pinning a max-width would leave dead space on screens
  with few filters. Not a defect.
- **Full Audit's Print / Excel / CSV / PDF** stay four buttons — recognised
  labels, near-zero Hick's cost, and a menu would add a click to a daily task.
- **Device Revoke** looked unguarded to a grep (no `ConfirmDialog`) but uses a
  plain `Dialog` that also warns when the machine has unsynced work. Correct
  as-is.
- **Void flow** already reads "Keep Record" / "Cancel Entry" — better than the
  "Go Back" convention and no collision. Untouched.
- **Command palette**: 49 items in 5 groups with type-ahead, focus lands in the
  input. Hick's already handled.
- **Responsive**: zero horizontal body overflow across nine screens at 820px.

### Verified

- Row geometry back to the original: Edit 44×27, Remove 69×27, 4px gap, order
  Edit → Remove. Save line/Save Sale 36px.
- Settings headings: H1 Settings → H2 group → H3 section. All four saves scoped.
- "Edit Entry" dialog reads "Go Back" / "Save Changes"; the five destructive row
  "Cancel" actions and `VoidDialog`'s "Cancel Entry" are untouched.
- Golden anchors unchanged: −330.6857142857142 / −869.5714285714284 and
  −537 / −1410. Typechecks clean; production build clean.

### Pending for the desktop

None of the above is in the packaged app yet — it ships the web bundle built at
package time. When the web work is settled, one rebuild picks all of it up:

```
npm run native -w @fnb/desktop   # if npm install ran since the last build
npm run dist   -w @fnb/desktop
```

Nothing desktop-specific needs changing for these; `setup.html` is the only
desktop-owned screen and it was already title-cased.

---

## 2026-07-31 (third pass) — failed loads stopped lying

Web only at the time; the desktop caught up in the pass below.

### The long-standing pause mystery, solved

`main.tsx` and `AppShell` both carried a note that a query with
`networkMode: "always"` and `navigator.onLine === true` still sat at
`fetchStatus: "paused"`, `status: "pending"`, `failureCount: 0` — "which by its
own `canFetch()` rule should never pause", cause unknown.

It was looking at the wrong function. From query-core's `retryer`:

```js
const canContinue = () =>
  focusManager.isFocused() &&
  (config.networkMode === "always" || onlineManager.isOnline()) &&
  config.canRun()
```

`focusManager.isFocused()` is required **regardless of networkMode**, and it
gates the first attempt — hence `failureCount: 0`, never tried. The window was
simply in the background (watching a terminal for the stopped API does exactly
that). Both notes are corrected in place.

This also corrects a claim made earlier in this session: the "skeleton forever"
reproduction was substantially an artifact of testing in a hidden browser pane
(`visibilityState: "hidden"`). A real user with a focused window gets a normal
error. Anything treating `paused` as failure must pair it with
`document.hasFocus()`, or it false-alarms at everyone who tabs away mid-load —
`queryFailed()`, the Dashboard, the two detail pages and `AppShell` all now do.

### The real bug

1. **`TableError` existed and no list page used it.** `stock/index.tsx` branched
   `isPending` then `length === 0`, so on a failed load the Local Database
   announced *"This location's catalog is empty"* and offered to copy another
   location's catalog — inviting someone to duplicate a catalog that already
   exists. `TableError`'s own doc comment had warned about exactly this ("a load
   failure must never render as an empty state"). Thirteen list pages had no
   error arm at all.
2. **An expired session read as a network fault.** Only `AppShell`'s `me` query
   reacted to a 401. Every other request surfaced its error in place, so an
   audit viewer — 20-minute session (`READONLY_SESSION_TTL_MS`) against `me`'s
   5-minute `staleTime` and `refetchOnWindowFocus: false` — sat on a report
   being told to "check your connection" beside a Try again that could never
   succeed. A `QueryCache`/`MutationCache` `onError` now sends any 401 to
   `/login?expired=1`, the same URL AppShell uses, so the calm "session ended"
   notice still shows. Invalidating `me` and letting AppShell redirect was tried
   first and does not work: React Query keeps `status: "success"` when a
   *background* refetch fails on a query that already holds data, so
   `me.isError` never becomes true.

### The fix

`queryFailed()` + `TableFailure` in `table-surface.tsx`, and **failure checked
before pending** at every site.

- `queryFailed(q)` = `isError || fetchStatus === "paused"`. The doc comment
  states the ordering requirement, because getting it wrong is silent.
- `TableFailure` picks the recovery that works: a paused query stays paused
  through `refetch()` (measured — AppShell hit this first), so paused offers a
  reload and an ordinary error retries in place. Accepts an array when a screen
  needs several queries.
- 34 pages with a loading state now all have a failure state; every title names
  what failed ("Couldn't load this location's catalog"), never the generic
  "Couldn't load this report" on a user list.
- Dashboard, Full Audit, Cost Snapshot, Sales by Item, Usage Cost, Non-Revenue's
  transfer tab, the transfer editor and the import review each needed their own
  shape — the last two said *"it may have been removed"* on any failure, blaming
  the record for a network problem.

### Also

- Settings: the one input without a label got an `aria-label` (a placeholder is
  not a label and vanishes on first keystroke).

### Audited, no change needed

- **Weigh screen asks for the unit the bottle was actually weighed in** (oz here)
  even when the user's preference is metric. Correct and deliberate —
  `tareWeightUnit` records a physical measurement, and only the fallback follows
  the preference. **Noted for the client:** if a bar's scale reads grams and the
  item's tare was recorded in ounces, staff must convert. Worth asking Lourd
  whether input-side conversion is wanted; it would touch weighing math, so it
  is a decision, not a tweak.
- Accessibility otherwise clean across six screens: no unnamed buttons, no
  missing alt, all other inputs labelled.
- Imports review shows the raw file value beside its match, so a human verifies
  rather than trusts. Command palette, responsive layout: already covered.

### Verified

- Failed catalog load renders "Couldn't load this location's catalog / Can't
  reach the inventory service…/ Try again" — 0 skeletons, no empty state. Same
  for the Dashboard.
- 401 → `/login?expired=1` showing "Your session ended — sign in again to
  continue."; a 500 does not navigate. (Two false negatives along the way: a
  synthetic `.click()` that Radix ignores, and `window.location.assign`, which
  is non-configurable and cannot be spied on — the redirect had been working
  both times.)
- **Not verifiable in this environment:** driving a query to a genuine `isError`
  state. The automation pane never composites, so `visibilityState` is `hidden`,
  retries pause, and no error handler runs. The `isError` paths are verified by
  reading the code and by exercising the handlers directly at their wiring
  points.
- 8 screens re-checked with the network restored: real rows, no stuck skeletons.
- Golden anchors unchanged: −330.6857142857142 / −869.5714285714284 and
  −537 / −1410. Typechecks and production build clean.

---

## 2026-07-31 (fourth pass) — printing, and the desktop catches up

### Printing dropped two thirds of the Full Audit

The print stylesheet was thoughtful — A4 landscape, sidebar hidden, `thead`
repeated across sheets, `break-inside: avoid` on rows, `print:hidden` on the
filter bar. It never reset a scroll container.

The app is a viewport-height shell (`h-svh`) whose page content and table
surface both scroll. Correct on screen; on paper `overflow: auto` clips to the
box. Measured on the Full Audit: **a 463px box around a 1337px table — 874px,
about two thirds of the rows, absent from the output** with nothing saying so.
On the one report the client trusts above all, whose value is that its numbers
are complete, that is the worst available failure.

Fixed by unbinding height on the shell chain and overflow on everything inside
`[data-slot="page-content"]`, in that order. `.sr-only` is excluded on purpose —
it relies on clipping to stay invisible, and unclipping it would print the
screen-reader text. Verified by applying the same rules at `media="all"`:
874px clipped → **0**, `.sr-only` still hidden.

### Session-expired notice reached only half the users

`?expired=1` renders "Your session ended — sign in again to continue." — inside
the password branch only. The desktop signs in with a PIN, so a device booted by
the new 401 redirect landed on the keypad with no word about why. Hoisted above
the branch; both credentials now explain it. Same drift as the button ordering
and the "Go Back" convention: a rule written once, into one of two paths.

### Desktop

Rebuilt and reinstalled — the app now carries all four passes (verified against
the running local server: print fix, scrollbar guard, sign-in animation,
`queryFailed`/`hasFocus`, the 401 redirect, activity folding, Settings grouping,
"Go Back").

Two desktop-only faults:

- **No way to undo an accidental zoom.** Removing the File/Edit menu took
  Ctrl+0/+/− with it — the same loss that had already been noticed and repaired
  for reload and devtools, but zoom was missed. Ctrl+scroll, and pinch on a
  touchscreen bar PC, still zoom the renderer, so someone who knocks the wheel
  mid-count is stuck at 150% with no menu and no shortcut for the rest of the
  session. It clears on restart only by accident: the local server takes a new
  port each launch, so the origin Electron remembers zoom against differs.
  Now re-registered beside the reload binding.
- **No minimum window size.** An Electron window has none unless given one, so
  it could be dragged to a sliver. `minWidth: 880` / `minHeight: 600` — the web
  app is clean to ~820px, and 880 keeps the icon rail plus a readable table.
  Verified: a `MoveWindow` to 400×300 clamps to 880×600.

### Verified

- Print: 874px clipped → 0 clipped, `.sr-only` still hidden.
- Expired notice on both the password and PIN paths.
- Desktop installs, launches, serves the SPA (200) and `/_desktop/people`
  (5 users, "Front bar PC"); `host.log` clean.
- Window minimum enforced at the OS level.
- Golden anchors unchanged. Typechecks clean across server, web and desktop.

**Not verified by keypress:** the zoom accelerators. Screen access to the
packaged app was declined, so they are confirmed present in the installed
`app.asar` and follow the identical, working `before-input-event` binding beside
them — but no one has pressed Ctrl+0.

---

## 2026-07-31 (fifth pass) — backend audit

Audited against this repo's own stated invariants, which are the ones worth
checking because a violation is a defect by definition rather than by opinion.

### Every validation failure said "[object Object]"

`@hono/zod-validator`'s default failure body is
`{ success: false, error: <serialized ZodError> }`. The web client reads
`{ error: string }` — the shape every other error on this server sends — so
`body.error` arrived as an OBJECT, `new ApiError(400, thatObject)` stringified
it, and the toast read **"[object Object]"**. On every form in the app, for as
long as validation has existed. `errorHandler` could not catch it either: the
validator returns its own Response rather than throwing.

`lib/validate.ts` now wraps the validator with a failure hook that speaks the
server's own error shape, and all 15 route files import from there instead.
Field names are included because a form with a dozen inputs needs to say which
one, and the missing-value case is reworded — "Invalid input: expected string,
received undefined" is a sentence for whoever wrote the schema.

Measured, before → after:

| request | before | after |
|---|---|---|
| `POST /counts {}` | `[object Object]` | `Count date: is required` |
| `POST /counts {countDate:"07/30/2026"}` | `[object Object]` | `Count date: Expected YYYY-MM-DD` |
| `POST /sales {qty:-5}` | `[object Object]` | `Sale date: is required` |

Schema-authored messages pass through untouched — the humaniser only rewrites
`invalid_type` with a missing value, so a deliberate message like
"Expected YYYY-MM-DD" survives.

### Two mutations logged outside their transaction

README: "every mutation writes ActivityLog **in the same `$transaction`**".
76 of 85 call sites did. The exceptions that mattered both destroy a session
its owner did not ask to end:

- `POST /admin/users/:id/sessions/:sessionId/revoke` — an administrator forcing
  someone off a machine, which takes a `reason` precisely because it is meant to
  be auditable. Delete and log were separate awaits, so "revoked with no record"
  was reachable.
- The STAFF single-session eviction in `POST /auth/login` — throws whoever holds
  the prior session out, potentially mid-count.

Both wrapped. `logActivity` already accepted a `tx` and its own doc comment asks
callers to pass one; these two just didn't. Plain self-service logout is left
alone: the actor is the person affected, and the record is not evidence about
anyone else.

### One rounding escape in the legacy-parity export

`exports-suite.ts` rounded every cell of the 24-column legacy row with `round2`
(phpRound) except the variance percent, which used `Math.round`. `rounding.ts`
states the stakes itself: "JS Math.round(-2.5) gives -2, PHP gives -3. Negative
variances are routine in audit reports, so this difference is load-bearing." A
−2.5% variance exported as −2% where the client's legacy sheet says −3% — in the
export whose entire purpose is matching that sheet. Now `phpRound`.

### Audited, no change needed

- **Route scoping.** Location-scoped routers get `requireAuth` +
  `requireLocationAccess` once at the mount point, so it cannot be forgotten
  per-route. The audit trail is tenancy-correct: empty client access
  short-circuits to `[]`, an out-of-scope `clientId` maps to `__none__`, and the
  unfiltered branch is reachable only for ADMIN.
- **Input validation coverage.** Zero routes read a body without a schema.
- **Login.** Same message for unknown user, wrong password and disabled account;
  lockout at 5 attempts per hour, matching legacy. The 423 lockout reply is
  technically a user-enumeration oracle, but telling a locked-out staffer why
  they cannot get in is the right trade for a ten-account internal tool.
- **CSRF**: `originCheck` runs before everything.

### Desktop

Rebuilt and reinstalled — it bundles this server, so all three fixes ship with
it (confirmed in `dist/host.mjs`). Launches clean, serves the SPA and
`/_desktop/people`.

### Verified

- New messages measured against the running server, four cases.
- `verify:seed` PASS — anchors unchanged after touching an export service.
- `verify:sync` PASS, including "admin can revoke the machine" / "the revoked
  machine is locked out immediately", which exercises the now-transactional
  revoke.
- Typechecks clean across server, web, desktop.

**Housekeeping:** probing the validator created a real count session in the dev
database. There is no hard delete for a count — correctly — so it was voided
with the reason "Created accidentally while testing validation messages", and
sits in the trail as a VOID row on 2026-07-30 at Main Bar.

---

## 2026-07-31 (sixth pass) — the desktop was not syncing inbound at all

Asked to harden sync edge cases. The edge cases were fine; the main path was
not. Three steps of the cycle existed only in comments — the code shipped, ran
without error, and reported `synced: true` while doing none of them.

### 1. Pulled snapshots were thrown away

`cycle()` called `pull()` and discarded the result. `applySnapshot` was reachable
only from first-run provisioning and the test harness. **After setup, the mirror
never received another byte from the server** — a void entered in the browser, a
corrected line, a new price, a new item: none of it reached the bar PC, while the
desktop's own Full Audit kept reporting the numbers it was provisioned with. The
inbound half of two-way sync, which is most of why the desktop exists, was never
wired up.

Proven end to end: supplier created in the browser → one `/_desktop/sync-now` →
present in `mirror.db`. Before the fix a cycle applied 0 rows; now 520.

### 2. Reconciliation detected missing records and did nothing

`reconcile()`'s own doc says "and re-queue them… This closes it". It returned
`{ missing }` and `cycle` counted the length. Nothing re-queued, and the entries
were already marked pushed so `pending()` would never look at them again — a
device that lost a request in flight stayed permanently un-synced with no route
back. `requeue()` clears `pushedAt`; replay is safe because every create route is
idempotent on the client-supplied id.

### 3. The pull cursor never advanced

`FNB_LAST_PULL_AT` was read from the environment once at process start.
`writeConfig({ lastPullAt })` only ever ran during first-run setup, and the
utility process cannot write config anyway — safeStorage lives in the main
process. So `since` was frozen at whatever provisioning saw, for the life of the
install. The cursor now lives in `_sync_state` inside the mirror, beside the
outbox, and advances only after a merge actually lands.

### 4. The merge could have destroyed unpushed work

`pull`'s doc promised "rows referenced by unpushed outbox entries are left
alone"; `applySnapshot` did a blanket `INSERT OR REPLACE`. Harmless while pull
was inert — and a data-loss bug the moment it wasn't, since the server's copy of
a locally-edited draft is older than the edit waiting in the queue.
`applySnapshot` now takes the protected id set and reports what it skipped.

### Verified

- End-to-end inbound sync, browser → mirror (above).
- Cursor persists and advances across cycles (08:12:26 → 08:12:54).
- Focused checks on the new primitives, run once against a throwaway DB: re-queue
  targets only the entry owning a missing id, preserves causal replay order, is a
  no-op for ids the server has; protected ids include unpushed and exclude
  pushed; cursor round-trips and overwrites in place. 10/10.
- `verify:seed` PASS · `verify:sync` PASS · `verify:mirror` MIRROR MATCHES THE
  SERVER. Typechecks clean across all three workspaces.

### Notes

- A SQL comment containing backticks closed the surrounding JS template literal
  again — **third time this session**. The comment in `outbox.ts` now says so.
- Housekeeping: verification created supplier `SYNCTEST-4421` on Main Bar. There
  is no delete route for suppliers, so it is renamed
  "SYNCTEST-4421 (test, safe to delete)" and deactivated.

## 2026-08-01 — security audit and edge hardening

Full-system security review. New docs: [security.md](security.md) (threat model, findings,
posture), [security-runbook.md](security-runbook.md) (pre-flight, backup/DR, incident response),
[security-mfa.md](security-mfa.md) (TOTP and other integrations, specified but not wired).

The headline: **application security was already strong — authorization, tenancy, and audit
integrity all scored 90+ — and the gaps were almost entirely at the request edge and in
operations.** Scored 78/100 overall, dragged down by DR (30) and pipeline (20), not by code.

### Fixed

1. **Session cookie `Secure` keyed off `NODE_ENV`** while the SPA-serving decision keyed off a
   `--dev` argv flag — two different signals for "is this production". A deploy that set one and
   not the other served the app perfectly while emitting session cookies without `Secure`. Now
   derived per-request from the actual transport, which is correct for HTTPS hosting *and* for the
   plain-HTTP Electron desktop (a hard-coded `true` would have broken the latter).
2. **No rate limiting anywhere.** The per-account lockout is blind to credential stuffing (one
   password, many usernames) and to the fact that `/login` runs scrypt before it knows who is
   calling. Added per-IP limiters counting **failures** rather than attempts, so fifteen staff
   signing in at shift change behind one NAT address never trip it.
3. **No response security headers.** Added CSP (`script-src 'self'`, no unsafe-inline/eval),
   HSTS-when-TLS, `X-Frame-Options: DENY`, nosniff, referrer policy. `style-src` keeps
   `'unsafe-inline'` — shadcn's chart primitive emits a `<style>` block and React writes inline
   `style=` props; removing it needs a nonce threaded through the SPA build.
4. **`x-forwarded-for` trusted verbatim** for the IP recorded against every login. Any client could
   set it, so the login-history screen an owner uses to answer "who did this?" was
   attacker-controlled. Now socket-derived unless `FNB_TRUST_PROXY=1`, and then it takes the *last*
   hop, not the conventional first — the first is the attacker-controlled end of the list.
5. **Username enumeration by timing.** The no-such-user branch returned before hashing: a miss
   answered in single-digit ms, a hit in ~100 ms, undoing the deliberately vague error message.
   Added `burnPasswordTime`. Measured 34.9 ms vs 33.0 ms after.
6. **A permission guard leaked onto a neighbouring router.** `settingsRoutes` used a pathless
   `.use(requirePermission("master.write"))`; `preferencesRoutes` mounts on the same
   `/api/settings` prefix, and Hono merges routers by path. Verified experimentally rather than
   assumed. STAFF and ACCOUNTANT were getting 403 from the two endpoints whose own comments say
   they sit outside that guard on purpose — and the cost-basis one falls back to `"PRICE"` on
   error, so an establishment valuing at `LAST_COST` read every valuation screen under the wrong
   basis label. Fail-closed, so not exploitable, but silently mislabelling the numbers is the
   serious kind of bug here. Guards moved per-route; path scoping alone wasn't enough because the
   two routers serve GET and PUT at the *same paths*. `admin.ts` documents this same trap.
7. **A password reset left existing sessions alive** — up to 7 more days, a year on a registered
   desktop — while the screen told the owner the account was secured. Now evicts in the same
   transaction, with the count in the audit summary. Role/module edits deliberately don't evict:
   `getSessionUser` re-reads both per request, so they already take effect on the next call.

### Verified clean

No SQL injection (no raw SQL on user input), no RCE surface (no eval/child_process/deserialization),
no path traversal (uploads are SHA-256-named with a server-chosen extension and never served back),
no XSS (the one `dangerouslySetInnerHTML` interpolates developer-authored chart config), no IDOR,
no mass assignment. Stocky's tool registry is read-only and scoped from the session, so prompt
injection through an imported document cannot reach a write.

### New harness

`npm run verify:security -w @fnb/server` — 38 checks, same throwaway-database shape as
`verify:seed`/`verify:sync`, driving the real Hono app in-process.

One harness bug caught during the run and worth recording: checks that deliberately fail sign-ins
left `manager` account-locked, which then made three *later* sections fail for an unrelated reason.
Added `clearLockout()` between sections — the control was working, the harness was contaminating
itself.

### Verified

- `verify:security` 38/38 · `verify:seed` PASS · `verify:sync` PASS.
- Typechecks clean on `@fnb/server` and `@fnb/web`.
- Reconciliation math untouched — no file under `packages/core` was modified.

### Still open, deliberately

MFA (specified in security-mfa.md, blocked on the client's enrolment-policy decision), encryption at
rest, and the two weakest domains: **automated backups with a tested restore**, and **any CI at
all**. Those two are now the highest-value remaining security work, and neither is a code change.

## 2026-08-01 (second pass) — two-factor authentication for ADMIN and OWNER

Client decision: **ADMIN + OWNER** must hold a second factor; optional for everyone else. Closes
[security.md](security.md) M-5, the one open item from the morning's audit. Full as-built notes in
[security-mfa.md §1](security-mfa.md).

TOTP (RFC 6238) on `node:crypto` — no dependency on the server. Every TOTP package is a wrapper
around ~60 lines of HMAC and truncation, and an auth primitive with a supply chain is a worse trade
than code you can read. `qrcode.react` on the web, for the scan.

### The decisions that carry weight

1. **The password buys one thing: the right to present the second factor.** An enrolled account
   gets a short-lived `MfaChallenge` — no cookie, no session, no device registration, no
   `auth.login` row until the code lands. Registering a device in step one would consume a licence
   slot for someone who has proved half a credential.
2. **`MfaChallenge` is its own table, not a flag on `AuthSession`.** A half-authenticated row in the
   session table needs every reader to check the flag, and forgetting once fails *open*.
3. **Enrolment stays unconfirmed until a code is proved**, so a mis-scan can't lock someone out of
   their own account.
4. **Login is never hard-blocked; the app is.** Refusing an unenrolled ADMIN's login would lock out
   the only administrator with no way back. They sign in, and `requireMfaEnrolment` refuses
   everything but `/api/auth/*`.
5. **`FNB_MFA_KEY` is the on-switch.** No key → the feature is entirely off. Fail-safe, and it means
   enforcing MFA can never outrun the ability to enrol.
6. **The desktop is exempt.** It authenticates a machine, checks its PIN locally with no network,
   and is sold on working through bad connectivity. `Device.status` revocation stands in.
7. **Self-disable refused for the required roles** — lost phones go through an administrator, same
   shape as `pinAdminRoutes`.

### One bug found in browser verification

`app.use(requireMfaEnrolment)` was pathless, so in production — where this same app serves the built
SPA — it also refused `GET /account/security`, **the very page the gate redirects people to**. The
user got raw 403 JSON instead of the enrolment screen, which is as locked out as having no screen.
Scoped to `/api/*` and pinned with a check.

That is the second ordering bug of the day (M-3 was the first). Both were middleware landing
somewhere its author didn't picture — worth noting as a pattern this codebase is prone to, since it
mounts several routers on shared prefixes.

### Verified

- `verify:security` **72/72** (up from 38; 32 new checks cover MFA), `verify:seed` PASS,
  `verify:sync` PASS. Typechecks clean on both workspaces.
- Driven end-to-end in a real browser against the production build: gate → enrolment → QR → code →
  recovery codes → sign out → two-step login via a recovery code → dashboard. No console errors, no
  CSP violations, no server errors.
- The verification enrolment was reset afterwards (`mfa.adminReset`) — its secret existed only in
  that browser session, so leaving it would have locked the dev admin out.

### Notes

- A dev `FNB_MFA_KEY` is in `apps/server/.env`. **Generate a fresh one for production**, and back it
  up separately from the database — losing it locks out every enrolled user.
- `security.md` now carries a **§5 "Reaching 100"** — what each scored domain needs, with effort
  estimates and an honest note on where 100 isn't worth buying. Short version: backups-with-a-tested-
  restore and a CI pipeline are ~4 hours of work for roughly +13 points overall; everything else is
  expensive polish, except hash-chained `ActivityLog`, which is a product feature more than a
  security one.

## 2026-08-01 (third pass) — DR, CI, and the KDF

Closing the two domains that scored lowest in the morning's audit: **Availability/DR 30→85** and
**Pipeline 20→88**. Overall 82 → **93**. Everything left is a deployment or a schedule, not a commit
— [security.md §5](security.md) now says exactly who has to do what.

### Backups that verify themselves

`npm run backup -w @fnb/server` — better-sqlite3's online backup API, **not** the `sqlite3` CLI
(which isn't installed here, so the command the runbook originally gave would have failed) and not a
file copy (which tears a WAL database into something that opens fine and is missing recent commits).

It verifies `integrity_check` before keeping the file, syncs new uploads (SHA-named, so absence is
the only test needed), and prunes on tiers — all recent for 48 h, then daily for 30 d, then weekly
for a year.

### A restore drill that checks the numbers, not the file

`npm run restore-drill -w @fnb/server` restores to scratch and checks integrity, foreign keys,
migration state, row counts, and — the part that matters — **re-runs the real Full Audit for every
location and compares it to what the backup recorded**. Proven to catch a *single tampered count
line*, a corruption `integrity_check` calls "ok". Measured RTO on the dev dataset: **4.4 s**.

Two design corrections found by running it rather than reasoning about it:

1. **Comparing against the live database was wrong.** It failed on eight activity rows a browser
   session had written since the backup — i.e. on ordinary business activity. A drill that cries
   wolf is a drill nobody runs. The backup now writes a **manifest** of its own counts and audit
   digests, and the drill checks restored-vs-manifest. Drift against live is still reported, and
   that number is the **measured RPO**.
2. **The first digest hashed field names that don't exist** (`beginQty`, `varianceQty` — the real
   ones are `beginFull`, `variance`). It would have hashed all-nulls and matched itself forever. The
   digest now reports how many fields it actually covered, and the drill asserts that count.

### CI

`.github/workflows/ci.yml` — typechecks, all three harnesses, the web build, an audit gate, and
gitleaks with `fetch-depth: 0`. The harnesses were always the hard part; they just never ran unless
someone remembered.

**The audit gate is not bare `npm audit`.** That has two end states in CI and both are useless: block
every build over an advisory nobody can reach, or get `|| true` appended. `scripts/audit-gate.mjs`
scopes to the workspaces that ship and carries exceptions that are justified by a traced call path
and **expire**, so an accepted risk gets re-examined instead of forgotten.

It found a genuine one: **react-router had a high-severity RSC-mode CSRF bypass** — patched 8.1.0 →
8.3.0. Not exploitable here (Vite SPA, no RSC) but it ships. Two remain accepted until 2026-11-01,
both transitive and unreachable. Notably `npm audit fix` was **reverted**: it resolves `fast-uri` by
bumping the Prisma CLI to 7.9.1 while `@prisma/client` stays 7.8.0, and a split Prisma toolchain
under a system whose value is numerical correctness is the worse trade.

### Every route, probed

The 76th security check enumerates **every route the app registers** (179 after dedupe) and probes
each unauthenticated. Result: 175 refused, 0 exposed, and **0 that validated a body before checking
auth** — auth runs first everywhere.

This is the check that scales. Both authorization bugs found today were middleware landing somewhere
its author hadn't pictured, which review catches only by luck.

### scrypt N 16384 → 32768, and two traps

Raised now that the rate limiter exists (raising it earlier would have made `/login` a better CPU
amplifier, not a safer endpoint). Both traps are worth knowing:

- **Node's scrypt defaults `maxmem` to 32 MB and requires the working set strictly under it.** scrypt
  needs `128·N·r` = *exactly* 33,554,432 bytes at N=32768, r=8. So the recommended parameters fail
  outright until `maxmem` moves — and it must be passed on **verify** too, or every existing hash
  stops checking. Caught by the seed failing, 30 seconds after the one-line "improvement".
- **Raising N re-opened the M-2 timing oracle backwards.** `burnPasswordTime` runs at the current N
  (~80 ms) while legacy hashes verified at the old one (~38 ms) — making a *known* username faster
  than an unknown one. Fixed by re-hashing on successful sign-in, which also stops the oldest
  accounts being the weakest forever.

### One more middleware-placement bug

`requireMfaEnrolment` blocked `/api/settings/preferences`, which `PreferencesProvider` fetches
globally — including on the enrolment screen itself. Effects: the enrolment page rendered at the
wrong font size for someone who chose "large" for poor eyesight, and the client's 403 handler rather
than the login redirect drove the navigation, showing as a dashboard flash and a full page reload
mid-sign-in. Now allowlisted; `/login` → `/account/security` goes straight through.

That is **three** middleware-placement bugs in one day (M-3, the SPA route, this). The pattern is
clear enough to state as a rule: in this codebase, mounting middleware without thinking about every
path it will match is the single most reliable way to introduce a bug.

### Verified

- `verify:security` **76/76** · `verify:seed` PASS · `verify:sync` PASS · typechecks clean.
- Backup + restore drill pass, and the drill **fails correctly** on a tampered backup (exit 1).
- Audit gate passes, and **fails correctly** when an exception expires (exit 1).
- react-router 8.3.0 verified in a real browser: sign-in, routing, and the MFA gate all work.

## 2026-08-01 (fourth pass) — adversarial review of the day's own security work

Ran an independent multi-agent review over everything the three previous passes added. It found
**twelve** confirmed defects. Seven were security-relevant, and **five of those were introduced by
the security work itself** — including one the new harness was actively scoring as a *pass*.

That is the finding worth keeping. The code that adds a control is exactly as capable of removing
one, and a check that asserts the wrong thing is worse than no check because it manufactures
confidence.

### CRITICAL — a device payload in the login body bypassed the second factor

The offline-desktop exemption was `if (!device && isMfaAvailable())`. `device` is **unauthenticated
request body**: nothing proves the caller is the Electron app — no client certificate, no shared
secret, no signature. `deviceLogin` validates the shape of a fingerprint, not its provenance.

So a phished password plus an invented fingerprint bought a full session with no code. It compounded
three ways: registering a machine needs `devices.manage` = `[ADMIN, OWNER]`, byte-identical to
`MFA_REQUIRED_ROLES`, so the exemption belonged to exactly the roles that must never have it; the
session was device-bound, so **365 days** instead of 7; and `mfaEnrolmentOutstanding` short-circuited
on `deviceId`, so the enrolment gate never fired either.

Reproduced end to end before fixing — `curl` with a made-up fingerprint returned an OWNER session
reaching every admin route. **The harness asserted the opposite** ("a registered desktop signs in
without a code") and scored it green.

Fixed: no exemption. The device payload rides the challenge via `MfaChallenge.deviceJson` — a column
defined for exactly this on the first pass and then left wired to `null`.

### HIGH — the rate limiter did not hold under concurrency

The three limiters with teeth incremented *after* the handler resolved, so parallel requests all read
zero and all passed. Measured: **60 concurrent bad sign-ins against a limit of 10 → 60 × 401,
0 × 429**, each burning a full scrypt derivation. Every brute-force bound claimed for passwords, PINs
and 6-digit codes rested on this. The comment on the *other* branch says exactly why reserving up
front is necessary.

Fixed with reserve-then-refund, and pinned by a concurrency check — sequential checks cannot see it.

### HIGH — three more, all in the new MFA code

- **`x-acting-user` adopted the claimed user's role** with no proof. Reachable by ordinary STAFF,
  because `resolveDevice` returns an already-registered machine to any user of the establishment.
  One header from staff to owner. Now capped at the session holder's role, and logged when tried.
- **An administrator could reset their own second factor** via the admin route, making the
  no-self-disable rule decorative — a stolen session could remove the factor and re-enrol.
- **Losing `FNB_MFA_KEY` silently downgraded** every enrolled ADMIN/OWNER to password-only. Now
  fails closed with 503 `MFA_UNAVAILABLE`, which is what the docs already promised.

### MEDIUM/LOW — the rest

Lockout counter reset on password success (making TOTP guessing unbounded per account); wrong TOTP
codes falling through to ten 32 MB scrypt derivations; non-atomic recovery-code consumption;
`process.exit` inside a `try` leaving an unencrypted database copy in the OS temp directory;
backups kept without a manifest blocking the drill with a false diagnosis; `syncUploads` unable to
heal a truncated file; unbounded rate-limit map; a silent whole-installation lockout when a proxy
sits in front without `FNB_TRUST_PROXY`.

### A lockout risk the fix created, and its escape hatch

Refusing self-reset means a **lone** ADMIN who loses phone and codes has no in-app path back — an
OWNER cannot manage an ADMIN. So: the runbook now asks for **two** ADMIN accounts, and
`npm run mfa:reset -w @fnb/server -- <username> "<reason>"` is the break-glass. It needs a shell on
the host (a stronger proof of authority than any network flow), ends every session for that account,
and writes `mfa.breakGlassReset` to the trail.

### Verified

- `verify:security` **91/91** (was 76; 15 new checks pin these findings) · `verify:seed` PASS ·
  `verify:sync` PASS · typechecks clean · audit gate PASS · build clean.
- The bypass reproduced and then re-tested dead in a real browser: the device payload now returns a
  challenge, and `/api/auth/me` is 401.
- Break-glass reset exercised on a throwaway database, including its audit row and session eviction.
- Verification enrolment cleared afterwards — its secret existed only in that session.

### Note

Two of the four review lenses lost their verifier agents to a session limit, so their findings
arrived unvetted. I verified those by hand, which is how the concurrency race was confirmed
(reproduced at 60/60 before the fix). Worth re-running that review later for the coverage that was
lost.

## 2026-08-02 — adversarial review, round two

Re-ran the review with the coverage that a session limit cost round one (the DR and middleware
lenses lost their verifiers). This time 20/20 agents completed. **Fourteen** confirmed findings,
**six of them introduced by round one's own fixes** — two in code written specifically to close a
security hole.

### CRITICAL — the restore drill passed on a completely empty database

Every content check compares the restore against a manifest from **the same backup**, so zeros match
zeros: 15 count assertions of `0 === 0`, a digest loop that never iterates, and the one anti-vacuity
guard unreachable because there were no digests to guard. Reproduced by emptying all 37 tables:
`backup` printed OK, `restore-drill` printed **RESTORE DRILL PASSED**.

Worse, `prune` awards each daily slot to the newest file claiming it — so after 48 hours the empty
backups would have started **evicting the real ones**.

Fixed with an absolute floor: `backup` refuses a database with zero users or locations, and the
drill asserts users, locations, an audit trail, counted stock, and at least one auditable period
before any relative comparison counts as evidence. My own comment on the guard I did write said "a
check that always passes is worse than no check" — and it only protected a location that already had
a digest.

### HIGH — `verifyPassword` accepted ANY password against a malformed hash

`Buffer.from(x, "hex")` is silently lenient: an empty or non-hex segment gives a zero-length buffer,
which became a zero-length derivation, and `key.length === expected.length && timingSafeEqual(empty,
empty)` was `0 === 0 && true`. Verified: `scrypt:32768:8:1:<salt>:` returned true for
`"literally-anything"`.

Directly relevant to this system's stated adversary — an insider with database access could blank one
segment of a `passwordHash` and sign in as that person with any string, leaving a row that still
looks like a scrypt hash rather than an obvious reset. Every field is now validated before use.

### HIGH — the audit gate announced success when it had not run

npm exits non-zero both when it finds advisories and when it cannot reach the registry, and both
write JSON to stdout. The error payload has no `vulnerabilities` key, so `?? {}` read it as clean.
Reproduced with an unreachable registry: **"PASS — 0 blocking", exit 0** — in CI, where nobody looks.
Also: exceptions matched by package NAME only, so one CVE's exception silently absorbed every future
advisory in that package. Both fixed; both pinned with negative tests.

### HIGH — an AUDIT_VIEWER could get withheld data out of Stocky

The audit-viewer narrowing keys off a `/reports/` path segment. `/stocky/chat` needs only
`reports.view` (held by every role) and its tools read salesReport/purchaseReport/nonRevenueReport —
exactly the reports withheld from third-party viewers as commercially sensitive. They could ask for
them in prose. Now refused outright, with a positive control so the check cannot pass because the
endpoint is merely broken.

### HIGH — both round-one fixes to the same two problems were themselves wrong

- **The `x-acting-user` cap.** Round one capped by position in `ROLES`. That is not a privilege
  lattice: STAFF and ACCOUNTANT are incomparable, so "narrowing" STAFF to ACCOUNTANT handed out
  `reports.export`. Now compares permission SETS via `roleSubsumes`, derived from `PERMISSIONS`.
- **`isSecureRequest`.** Deriving Secure from the socket meant that behind the TLS-terminating proxy
  the runbook recommends, the cookie shipped WITHOUT Secure unless `FNB_TRUST_PROXY` was also set —
  H-1 reintroduced by H-1's fix. `x-forwarded-proto` is now believed without requiring trust, because
  forging it can only ADD Secure (costing the forger their own session) whereas forging
  `X-Forwarded-For` writes false evidence into the audit trail. Opposite failure modes, opposite
  defaults.

### MEDIUM — three more

Self-reset ban sidesteppable via `x-acting-user` (now checks both identities); manifest failure
aborting before uploads and pruning; and the **fifth** middleware-placement bug — `reportRoutes` had
pathless `.use()` calls leaking onto dashboard, Stocky and sync, with `dashboardRoutes` carrying no
guard of its own and silently relying on the leak.

### Verified

- `verify:security` **105/105** (was 91) · `verify:seed` PASS · `verify:sync` PASS · typechecks
  clean · audit gate PASS · backup + drill PASS · build clean.
- Each fix pinned by a check that FAILS without it, several with positive controls.

### The lesson, stated plainly

Across two rounds, **eleven of sixteen security defects were introduced by the security work
itself**, and twice a harness written alongside a control asserted the wrong thing and scored the bug
green. Security fixes need adversarial review at least as much as the code they fix. Assume the next
pass will be no different.

## 2026-08-02 (second pass) — remaining phases of the security brief

Worked the leftovers from the original 13-phase brief. **Built four, declined five.** The declines are
written up in [security.md](security.md) beside the builds, because "we chose not to" is a different
thing from "we forgot", and only one of them is defensible six months from now.

### Built

- **Readiness health check.** `/api/health` returned `{ok:true}` without touching the database — so it
  reported healthy while SQLite was locked, corrupt, or the disk was full, which is exactly when a
  supervisor needs the truth. Now queries the DB, returns 503 on failure.
- **Request timeout** (Phase 4). 120 s on `/api/*`. Generous deliberately: this is a resource guard,
  not a latency budget, and AI import extraction legitimately runs tens of seconds. **Stocky is
  excluded** — it is an SSE stream meant to stay open for minutes, and timing it out would sever the
  answer mid-sentence.
- **TOTP single-use** (RFC 6238 §5.2). `window = 1` left a code valid ~90 s. `UserMfa.lastTotpStep`
  records the spent step; refused with `<=` so an older step in the window cannot be replayed either;
  conditional `updateMany` so it holds under concurrency.
- **Breached-password check.** HIBP k-anonymity — only the first 5 characters of the SHA-1 leave the
  process. Verified live: `Password123` → 1,505,362 breaches, `Fnb!2026` → 0. Fails OPEN if the API
  is unreachable, so a third-party outage can never block an urgent password rotation.

The breach check earns its place for a reason specific to this app: **there is no self-service
password change.** An ADMIN types every password on someone else's behalf, so one person's habits set
the floor for the whole establishment.

### Declined

Composition rules (NIST recommends against them — they produce `Password1!`), raising the minimum
length to 12 (ADMIN/OWNER are backstopped by MFA; admin-assigned 12-char passwords get written on a
sticky note), refresh-token rotation (JWT pattern; server-side revocable sessions already give what
it buys), suspicious-session detection (no delivery channel until email exists), and encryption at
rest (OS-level full-disk is the right layer and is already in the runbook).

### Also declined: Phase 7 entirely

Load balancing is **blocked by architecture, not effort** — SQLite WAL supports one writing process,
so it needs a Postgres migration first, and the thing it usually buys (failover) the desktop mirror
already provides better. Caching is worse than unnecessary here: the invalidation surface is the
void/correction path, so getting it slightly wrong serves stale numbers on the Full Audit. Neither
was skipped quietly — both are written up with the triggers that would justify revisiting.

### The drill caught a real one

`verify:security` passed at 110 checks, but `restore-drill` **failed**:

```
FAIL  schema is current with prisma/migrations — missing: 20260801175239_totp_single_use
```

That is check #2 doing precisely its job — the newest backup predated the migration I had just run, so
restoring it would have produced a database whose schema the code does not expect, failing later in a
much more confusing way. Fresh backup, re-drill, PASS in 4.0 s.

**Operational note worth remembering: take a backup after every migration**, or the newest restore
point is one the drill will (correctly) refuse.

### Verified

`verify:security` **110/110** · `verify:seed` PASS · `verify:sync` PASS · typechecks clean · audit
gate PASS · backup + drill PASS · build clean.

## 2026-08-02 (third pass) — the last three code items

Built all three remaining items from the security roadmap. **95 → 97.** What is left is entirely
operational and belongs to the operator, not the codebase.

### Hash-chained ActivityLog — the one that is a product feature

Every entry now carries `hash = SHA-256(prevHash ‖ its own material fields)` plus a monotonic `seq`.
Written in `logActivity`, the single choke point all ~90 log sites go through — a chain maintained at
ninety call sites would be a chain with holes. `GET /api/activity/verify` (ADMIN) walks it and names
the first position that stops reproducing.

The distinction worth stating: every competitor can say their system *logs* changes. This says the
log **has not been edited**, including by whoever holds the database — which is exactly this
product's stated adversary. A trail an insider can quietly rewrite is not evidence.

Nine harness checks perform **real tampering** and require detection: an edited summary (caught at
its exact seq), a deleted row (caught as a gap — hashes alone would chain across the hole if it were
the newest), a forged append. A chain never tested against an actual edit is an assumption wearing a
hash.

Honest limit, documented in the code: someone with write access can recompute the chain forward and
it verifies. Nothing stored beside the data it protects can stop that. `chainAnchor()` returns the
value worth publishing **outside** the database, which is what makes forward-recomputation visible.

Two implementation notes:
- The tip is read with the **same client** the insert uses, so a caller's `$transaction` covers both.
  SQLite serialises write transactions (one writer, WAL), which is what keeps `seq` contiguous rather
  than merely usually-contiguous.
- `ts` is written explicitly rather than left to `@default(now())`, because the hash covers it and the
  two must be the same instant.

### Uploads routed by magic bytes

`detectSource` picked the parser from the filename and browser MIME type — both caller-controlled, so
the caller picked the parser. Now sniffed from bytes, with the extension only breaking ties bytes
cannot (XLSX vs any other Zip) and covering CSV, which has no magic number.

### Inline `<style>` elements refused — and the regression it exposed

CSP3 splits `style-src-elem` from `style-src-attr`. The app emitted exactly one `<style>` element
(shadcn's chart); rewriting it to emit colour variables as an inline style object made
`style-src-elem 'self'` possible.

**Then the browser caught what no harness would have.** Sonner injects ~15 KB of CSS as an inline
`<style>` at runtime — the tightened policy blocked it, and every toast in the app would have shipped
unstyled. Fixed by importing `sonner/dist/styles.css` through the bundler. **That import is
load-bearing.**

Worth recording as a pattern: this is the second time in two days that a CSP change passed every
in-process check and broke something only visible in a real browser. Header changes need a browser
pass, full stop.

### The migration needed hand-writing

`prisma migrate dev` refuses to add a UNIQUE constraint non-interactively. Generated the SQL with
`prisma migrate diff --from-config-datasource --to-schema` and wrote the migration folder by hand,
then `migrate deploy`. (SQLite permits many NULLs under a UNIQUE index, so `seq` being nullable does
not conflict with the pre-chain backfill.)

### Verified

`verify:security` **119/119** (was 110) · `verify:seed` PASS · `verify:sync` PASS · typechecks clean ·
audit gate PASS · backup + drill PASS · build clean. Charts, report (92 rows) and toasts all verified
in a real browser against the production build, with **zero CSP violations**. Live chain verifies
clean after the break-glass writes.

## 2026-08-02 (fourth pass) — sealing pre-chain history

`npm run seal-history -w @fnb/server` backfills `seq`/`prevHash`/`hash` onto entries written before
chaining shipped. Dry-run by default; `--confirm` writes.

**It does not prove old history is authentic** — it hashes the rows as they stand, so anything
already altered is frozen in as correct. What it buys is that from that point they cannot be edited
or deleted without detection. The run therefore records itself as `activity.sealHistory`, so nobody
later mistakes *trusted-on-seal* for *verified-from-origin*.

Design notes:
- **Appended after the current tip**, not spliced into chronological position. Splicing would mean
  recomputing hashes an operator may already have published as an anchor — precisely the operation
  the chain exists to make visible. Better to append and say so.
- Ordered by `ts` then `id`. Rows sharing a millisecond otherwise have no defined order, and a
  verifier walking them differently would report a false break.
- One transaction — a half-sealed chain reads as a break at the point the run stopped.
- Idempotent: rows already carrying a `seq` are skipped.

Run on the dev database: **420 entries sealed**, chain verifies (425 linked, 0 unchained), re-run is
a no-op, and editing a sealed historic row is caught at its exact seq. `verify:security` 119/119,
`verify:seed` PASS, `verify:sync` PASS, restore drill PASS.

---

## 2026-08-04 — merged lily-phillips; storage areas on counts

### Merge

`origin/lily-phillips` (5 commits) merged into main. Two conflicts, both
*both-sides-added*, resolved as unions rather than by picking a side:
`schema.prisma` (main's MFA relations + their `itemUnitPreferences`) and
`constants.ts` (MFA constants + weigh-outlier thresholds). Then `db:generate`
and `migrate deploy` for their two pending migrations.

The branch is good work. It touches `weighing.ts` — sacred — and does it
correctly: every new warning is `blocking: false`, the arithmetic is untouched,
and purity holds (`trailingAverage` is fetched by the caller). Both golden
anchors reproduce unchanged. It closes client notes 1 (weight outlier warning,
size floor + history ratio) and 2 (per-item display unit, admin default + staff
override), and shipped a handoff doc whose findings match an independent read of
the same code.

### `verify:mirror` was broken — by MFA, not by the merge

MFA is mandatory for OWNER. The harness signs in as `owner`, so **every**
location-scoped route 403s, surfacing as the badly misleading "This computer
isn't allowed to download data yet". Enrolling the demo owner does not help: an
enrolled account then needs a *code* to open a device session, which a harness
cannot supply. Run it against a server started with `FNB_REQUIRE_MFA=0`; the
harness now says so on failure instead of pointing at revocation.

**Same constraint applies to real onboarding:** an owner must finish MFA
enrolment in the browser *before* provisioning a bar PC.

### Storage areas (from the client's photos, not from his list)

His paper count sheet has a column per area — MAIN BAR / COCKTAIL LOUNGE /
BEER HALL / STOCK ROOM — tallied separately with the sum in the margin
(J.W. Black Label, 21 June: 7 + 2 + 7 = 16). `CountLine` had no such concept,
so four numbers collapsed into one: a generated sheet could not be imported back
in their own working format, and a variance could not say *which shelf* to
recount. Nobody had raised it; it was only visible in the photos.

- `LocationArea` (name, sortOrder, archive-not-delete) + optional
  `CountLine.areaId`. Additive migration; existing lines keep NULL, which is
  identical to a location that keeps stock in one place.
- **Safe for the reconciliation by construction:** `report-assembly` already
  sums count lines per item (`agg.beginFullQty += line.qtyFull`), so four area
  rows total exactly as one combined row did. Checked before writing any code,
  and both anchors re-verified after.
- Areas CRUD mounted inside the location-scoped group, so auth and client
  scoping are inherited rather than re-implemented. Archiving, never deleting —
  committed periods point at these rows and "where was this counted?" must still
  answer for a period closed months ago.
- Count sheet prints one column per area plus a Total (solid rule, not dashed —
  the total is the number transcribed into the system).
- Count screen gets an Area picker **above** the item and sticky across saves:
  a counter walks one area at a time, so re-picking per bottle would be the most
  repeated action on the screen. Hidden entirely when no areas exist.
- Corrections keep the original area unless explicitly changed — a correction
  means "this number was wrong", not "these bottles were elsewhere".
- Managed under Settings → Establishment settings (it changes the paper the
  whole building works from, not one person's screen).

### Verified

- Sheet headers render `Code · Item · Size · Main Bar · Cocktail Lounge ·
  Beer Hall · Stock Room · Total · Open/scale · Notes` — their layout.
- End-to-end: one item tallied 7 / 2 / 7 across three areas stored with the
  right area on each line and totalled 16. Throwaway session voided afterwards.
- `verify:seed` PASS · `verify:sync` PASS · anchors unchanged · typechecks clean
  across server, web, desktop · production build clean.

### Client answers received (2026-08-04)

1. Unused bottles — **all three cases happen**, so entry must distinguish
   customer-takes-home / house-keeps / stored-for-customer. The third must NOT
   become sellable stock.
2. Garnish — **both** bar and kitchen.
3. Report tiers — follow the recommendation: an explicit enabled-reports set per
   subscription, tier as a creation-time preset only.
4. Local vs Main Database — follow the recommendation: keep the computation
   visible, but where a weight comes from Main, show "standard — set your own"
   rather than the number.

### Next

Blank printable/importable forms for sales, purchases and non-revenue — not
started. The photos give the layouts.

### Blank entry forms (same day)

Client req 2026-08-02: "pwede mag generate ng form si system na printable or
soft copy … dun na lang mag input as options si user … then import nya yun
file". Reports → **Blank Entry Forms**: Sales, Purchases, Non-Revenue.

**The headings are a contract, not a design choice.** `services/import-parse.ts`
finds its columns by regex — `/item|product|name|.../`, `/qty|quantity|.../`,
`/price|srp|retail|amount|.../`, `/cost|unit ?cost|buy|.../`, `/date|day/` —
so every heading was checked against those before it was written. Rename one to
something prettier and the file still downloads, still prints, still looks
right, and silently imports as a column of nulls. That is noted at the top of
the file so the next person renaming a column knows what they are touching.

- **Non-Revenue started as a copy of their sheet and should not have.** Their
  paper is the source of what the columns must MEAN, not a layout to reproduce.
  Corrected in the pass below.
- **"Item names filled in"** is the option that makes the round trip actually
  work: free-typed names have to survive fuzzy matching, names printed from this
  location's own catalog match exactly.
- CSV is generated client-side from a Blob — a blank template has no data to
  fetch, and a server route to return empty rows would be a route that exists to
  return nothing. PDF is the print view, exactly as the count sheet already does.

**Verified end to end, not just rendered:** a generated Sales form filled with
two catalog item names, uploaded through the real `/imports` endpoint —
both rows parsed with date, quantity and price in the right columns, both
matched `EXACT`, both auto-`APPROVED`.

`verify:seed` PASS · `verify:sync` PASS · anchors unchanged · typechecks clean
across all three workspaces · production build clean.

**Housekeeping:** the round-trip test left import batch `sales-form.csv`
(`NEEDS_REVIEW`) at Main Bar. There is no delete for an uncommitted batch and
`reverse` only accepts a COMMITTED one, so it stays — it is inert, since an
uncommitted batch feeds no report.

### Correction: the client's sheets are input, not a spec

Flagged by Rasty, and right. The first pass at the blank forms reproduced the
Non-Revenue sheet "column for column" and argued *no retraining* for it. That is
backwards — those photos show how the establishment works **today**, including
what it currently loses. Copying the layout preserves the losses.

Three things their Non-Revenue sheet does badly, now fixed:

1. **Reason was free text in Remarks.** "Bleed", "R&D" and a sentence about a
   broken bottle shared one column, so nothing could total them. Reason is now
   its own column.
2. **The system did not understand their words anyway.** `nonRevenueGroupOf`
   matched exact-case codes (`SPILLAGE`, `TASTING`); **every** entry on their
   sheet — Bleed, R&D — fell through to `OTHER`. It now folds their own
   vocabulary, case- and spacing-insensitively, and
   `NON_REVENUE_REASON_WORDS` is printed on the sheet so nobody has to guess.
3. **The reason was discarded on import.** A NON_REVENUE batch created records
   with `reason: null`, so the Non-Revenue report's by-reason breakdown covered
   only hand-typed rows. `reasonFromRaw` reads it from the raw row already
   stored in `ImportRow.rawJson` — no new column, no migration, because the data
   was there and unused.

Also dropped the per-row **Signature** column: blank on every row of the sheet
they sent, while APPROVED BY at the foot was signed. A column nobody fills is
width taken from the ones they do, and the system records the encoder anyway.

**Raise with Lourd:** their sheet logs "Transfer to kitchen" as non-revenue.
It classifies as OTHER and should — a transfer to the kitchen is a real
inter-location **Transfer**, which the system already models on both sides.
Recording it as non-revenue writes off stock the kitchen then never receives,
so the kitchen's own count comes up short. Their paper cannot express that;
ours can.

### Verified

- Reason survives the round trip: an optimised Non-Revenue form uploaded through
  the real `/imports` endpoint parsed both rows `EXACT` + `APPROVED` with
  "Bleed" and "R&D" intact in the stored raw row.
- Classifier: Bleed / bleed / "BLEED " → SPOILAGE_SPILLAGE; R&D / r&d →
  MARKETING_OTH; Trimming → TRIMMING; "Transfer to kitchen" → OTHER (correct).
- Form renders `Date · Product · Quantity · Reason · Remarks` with the accepted
  words printed beneath and the APPROVED BY line kept.
- `verify:seed` PASS · `verify:sync` PASS · anchors unchanged · typechecks clean
  across all three workspaces · build clean.

### Desktop updated

Rebuilt, reinstalled, launched. It **auto-applied 6 pending migrations to its
own mirror** on boot — including `location_areas` — which is the migrate-on-boot
path doing exactly what it exists for. Confirmed carrying: Blank Entry Forms,
the reason legend, the storage-area picker, the Storage Areas settings section,
`reasonFromRaw`, the BLEED classifier and the areas route. SPA 200,
`/_desktop/people` 5 users, `host.log` clean.

---

## 2026-08-05 — Bottle Keep & Forfeited Inventory; purchase/sales form units

### Bottle Keep (client req 2026-08-04)

A bottle a guest paid for and left to finish next visit. **Its own record, not a
note on a sale**, because between being paid for and being drunk the bottle sits
on the shelf and **is not the bar's to sell**. Counted as stock it shows a
surplus now and a shortage the day the guest returns and drinks it with no sale
behind it — the variance noise that stops people trusting the Full Audit. This
is the third case from the earlier "unused bottles" question, which the client
confirmed does happen ("all of the above").

**One row per bottle, never a quantity.** His own question set the shape: "what
if may 10 bottles Jack Daniel's na different or same date ang entry for Bottle
Keeps but different name of client guest". A `qty: 10` row cannot say whose is
whose, when each expires, or which was claimed on Tuesday.

- `expiresOn` is stored as a **date**, not a day count. A count would be
  re-evaluated against today's house policy, so changing 30 days to 60 would
  silently move the expiry of every bottle already on the shelf.
- "Saan nakalagay" reuses **LocationArea** — his "Main Bar or Satellite bar 1"
  is the shelf list counts already use, so there is no second vocabulary.
- `dueForForfeit` / `daysLeft` are computed server-side against today, never
  stored: a stored flag is wrong every morning until something rewrites it.
- Forfeiting writes a **Forfeit** in the same transaction — quantity-only, no
  cost column at all, which is his "transferred to bar stock as purchased at
  zero cost". Deliberately not a zero-cost Purchase: under Weighted Average,
  units added at zero cost grow the denominator and not the numerator, dropping
  the average cost of every remaining bottle and restating valuations.
- The Forfeit button appears **only once a bottle is actually due**; the server
  refuses an early forfeit, and a button that exists to be rejected is worse
  than no button.

### Purchase / Sales forms — units stated at the point of entry

Their invoices read "Bench Mark No.8 Bourbon 750mL X12" against a quantity of
14, and nothing on the paper says whether that is 14 bottles or 14 cases. Off by
twelve is not a rounding error; it is a purchase that never reconciles. The
heading now names the unit, a **Pack Size** column gives the "X12" somewhere
honest to go, and the sheet prints the rule. Guessing at import time was the
alternative and it would have been a guess.

⚠️ **Column ORDER is load-bearing.** `NAME_RE` includes `bottle`, so
"Quantity (bottles)" also matches the item-name pattern; the parser takes the
first match and "Item" precedes it in every form. Verified — a purchase row
imports `itemText: "Absolut Vodka 700 ml"`, `qty: 24`. Move the quantity column
ahead of Item and the item name silently becomes the number. Noted in the file.

### Answering his other question

**No report spans multiple locations today.** Every report mounts under
`/api/locations/:locationId`, so a consolidated multi-location inventory report
is net-new work, not a setting.

### Verified

- His scenario end to end: four Jack Daniel's under three guests, different kept
  dates, sorted by expiry, 2 correctly flagged overdue; per-guest roll-up shows
  Lourd B. holding 2 bottles of which 1 is overdue.
- Forfeit → 200, creates a Forfeit with `qty 1`, a note naming the guest and
  both dates, and **no cost field at all**. Early forfeit → 409 "not due yet —
  it expires on 2026-08-24".
- Purchase form round trip: `qty 24` (not the pack size of 12), cost 825,
  `EXACT` + `APPROVED`.
- `verify:seed` PASS · `verify:sync` PASS · anchors unchanged · typechecks clean
  across all three workspaces · build clean.

### Desktop updated

Rebuilt, reinstalled, launched — auto-applied `20260805000000_bottle_keep` to
its own mirror on boot. Confirmed carrying the Bottle Keep report, the
bottles-by-guest roll-up, the Pack Size column and unit note, the bottle-keep
routes and the forfeit-on-expiry path. SPA 200, `host.log` clean.

### Not built

- **Automatic alerting.** The register shows a banner when bottles are overdue;
  nothing emails or notifies. Forfeiting stays a human decision on purpose — the
  bottle is a guest's property until the house says otherwise.
- **Recording a keep from the count screen.** He described entry "pag pinasok yan
  sa count"; today it is recorded on its own page. Worth confirming which he
  actually wants before wiring it into the counting rhythm.

### Bottle Keep on the count screen (same day)

Client req: "pag pinasok yan sa count". Wired in, with the edge cases worked out
BEFORE writing it — two of them were real bugs.

#### The one that protects the numbers

**A kept bottle must not be counted.** It sits on the shelf, but the sale that
paid for it already took it out of stock. Count it and `end` is one too high, so
usage falls by one, so the Full Audit reports an **over that never happened** —
followed by a matching short when the guest returns and drinks it with no sale
behind it. Nothing in the arithmetic can detect that; only the person holding
the shelf can.

Fixed with **no change to the reconciliation**: picking an item that has active
keeps shows, above the quantity field, how many bottles are on keep, whose they
are, and why they must be left out. The warning sits between the item and the
quantity because after the number is typed is the one place it would be useless.

#### Two real bugs found while listing edge cases

1. **Offline replay created duplicate bottles.** `/bottle-keeps` is not in the
   outbox's `NEVER_QUEUE`, so a desktop queues it — and the route took no
   client-supplied id. A lost response meant the retry created a SECOND bottle
   for the same guest. Since the whole design is one row per bottle, that is not
   cosmetic: it is a bottle the bar thinks it owes someone. Now takes an `id` and
   goes through `replay()` like every other create route — the invariant this
   codebase already had, which I had broken. Verified: same id twice → 201 then
   200, one row.
2. **Guest-name variants split the roll-up.** "Lourd B." / "lourd b." /
   "Lourd  B." counted as three guests, understating how many bottles one person
   holds — exactly the number the client wants to watch, and trivially gamed.
   Grouped on a normalised key, displayed as typed. Verified: four variants →
   one row of 4.

#### Also added

**A void route**, because there was no way to correct a mis-entered keep and a
bartender typing the wrong guest needs one. VOID with a reason, never a hard
delete — "there was never a bottle" and "cancelled by this person for this
reason" are different statements, and the fraud this register exists to catch
would be trivial if a row could just disappear. A FORFEITED keep cannot be
voided this way: it already moved stock, so undoing it means reversing the
Forfeit too — a different operation with a different audit story.

#### Decided against: forfeiting from the count screen

The warning belongs at count time; the forfeit does not.

- **Different act, different person.** Counting is fast and repetitive.
  Forfeiting takes a guest's property and converts it to house stock — a
  commercial decision, made deliberately, not mid-rhythm.
- **It writes stock.** A forfeit creates a Forfeit that moves the reconciliation.
  Doing that inside an uncommitted count session mixes two ledgers at the moment
  someone is least likely to be reading carefully.
- **It is a calendar event, not a count event.** A bottle expires whether or not
  anyone is counting.
- **It is the fraud path the client named.** He raised bartenders and bottle
  keeps unprompted. Forfeit-in-the-count-loop is the fastest possible route from
  a guest's bottle to pourable stock, for the person with physical access. It
  stays on the register, where it is visible and deliberate.

#### Edge cases identified and NOT yet handled

- **Guest returns after a forfeit.** No un-forfeit path; the bottle is already
  stock. Needs a decision from the client, not a guess.
- **Expiry near midnight in +08.** `dueForForfeit` compares UTC dates, so between
  00:00 and 08:00 Manila a bottle due "today" reads as due tomorrow. Same
  convention as the rest of the app's business dates; noted rather than changed
  in isolation.
- **A keep is not linked to the count session** it was entered from. Deliberate
  — voiding a count must not void a guest's bottle — but it means the only trail
  is the activity log.
- **Automatic alerting.** The register banners overdue bottles; nothing notifies.

### Verified

- Count screen: nothing before an item is picked; after picking Jack Daniel's,
  "3 bottles are on keep for a guest — do not count them. Lourd B. (2),
  Ramon D." plus the explanation and the Bottle keep button.
- Idempotency, name grouping and void all verified live; test rows voided with a
  reason rather than deleted, throwaway count session voided.
- `verify:seed` PASS · `verify:sync` PASS · anchors unchanged · typechecks clean
  across all three workspaces · build clean.
- Desktop rebuilt, reinstalled, carrying the warning, the dialog, the void route
  and the replay guard. SPA 200, `host.log` clean.

### Bottle Keep — status colour, action wording, and a simulation pass

Asked to colour-code the statuses and fix the action word, then simulate the
feature and hunt bugs. The simulation found three the eye would not have.

#### Bugs found

1. **Voided keeps still counted as bottles.** `agg.bottles += 1` ran for every
   row regardless of status, so a keep recorded in error and voided still added
   to "how many bottles this guest holds" — the exact number the client watches
   for fraud, and trivially inflated by entering and voiding. Now excluded from
   `bottles`, `active`, `dueForForfeit` and the totals; the row stays in the list
   so the mistake and its reason remain auditable. Measured: 10 rows, 6 void →
   totals 4.
2. **A guest whose every keep was voided still appeared** in the roll-up at zero,
   reading as somebody holding bottles rather than somebody holding none. Now
   filtered out.
3. **An unknown `?status=` silently returned an empty list.** A typo, or a caller
   sending the UI's own "ALL" sentinel, produced "no bottles on keep" instead of
   an error — on a register whose job is to say what the house is holding,
   silently answering "nothing" is the worst available failure. Now 400 with the
   valid values listed.

Also a grammar bug on the banner: "1 bottle has passed **their** keep date".

#### Status colour

Four outcomes meant four different things and shared one grey pill. A glance
down that column is how somebody finds the row that needs them:

| | | |
|---|---|---|
| Overdue | destructive | the only row wanting action today |
| On keep | outline | normal, quiet, the majority |
| Claimed | success | resolved the way everyone wanted |
| Forfeited | warning | resolved, but the guest lost the bottle and stock moved |
| Void | secondary + struck through | recorded in error, counts toward nothing |

Colour is never the only carrier — each state returns its own word, so the
printed sheet and anyone who cannot separate the hues still reads it correctly.
`VOID` was also missing from the status filter, so voided rows could be seen
under "All" but never isolated.

#### Action wording

"Claimed" → **"Mark claimed"**, and "Forfeit" → **"Forfeit now"**. A button says
what pressing it does; "Claimed" reads as the row's current state, so it looked
like a label that had somehow become clickable.

#### Edge cases exercised, all already correct

| probe | result |
|---|---|
| expiry before kept date | 400 "The expiry date is before the date kept" |
| neither expiry nor days | 400 "Set how long the bottle is kept, or an expiry date" |
| blank guest name | 400 "Customer name: Whose bottle is it?" |
| item from another location | 404 "Item not found at this location" |
| claim twice | 409 "This bottle is already claimed" |
| forfeit a claimed bottle | 409 "This bottle is already claimed" |
| guest search, any case | LOURD / lourd / Lourd all return the same 2 |

#### Also in this pass — Local vs Main Database (client answer #4)

His rule: "ang information lang makuha ni User ay kung ano lang nakalagay sa
Local Database account nila". The weigh screen showed the resolved tare and
liquid weight regardless of where they came from, so a client saw Main database
constants whenever they had not set their own.

The calculation stays on screen — hiding it was the alternative and it costs the
transparency that makes a weighed count checkable — but a borrowed constant is
now NAMED rather than printed: "(scale 900 − standard empty weight) × standard
liquid weight = …", with "set your own in the Local Database to see the figures".
An LIS ADMIN still sees the numbers (`admin.manage`, ADMIN-only), because
diagnosing a bad master weight is impossible without them and the rule is about
the client's own users.

### Verified

- Colours render: Overdue `bg-destructive`, On keep outline. Actions read
  "Mark claimed" / "Forfeit now". Banner singular/plural correct.
- `verify:seed` PASS · `verify:sync` PASS · typechecks clean across all three
  workspaces · build clean.
- Desktop rebuilt, installed and launched.

### Still open

- **Report tiers (answer #3)** — approach agreed (explicit enabled-reports set
  per subscription, tier as a creation preset); the per-tier lists still need
  Jj's checklist.
- Guest returns after a forfeit; UTC-vs-+08 expiry boundary; automatic alerting.

## 2026-08-04 — Garnish, and the attention list catching up

### Garnish (client answer #2, "parehas")

Two gates had to move together; changing either alone leaves it half-working.

1. `MODULE_PRODUCT_TYPES` — `"Garnish"` added to **both** `BAR` and `KITCHEN`.
   `allowedProductTypes` unions across a location's modules, so a BAR+KITCHEN
   location gets one Garnish list, not two (verified: `["Beverage","Garnish","Food"]`).
2. The `productTypes` Setting — the list an admin picks from when labelling a
   category. Added to the seed for fresh installs, and migration
   `20260806000000_garnish_product_type` appends it to databases that already
   exist. It uses `json_insert(value, '$[#]', 'Garnish')` rather than rewriting
   the array, so a product type someone added by hand survives; guarded on
   `NOT LIKE '%Garnish%'` so re-running is a no-op.

Verified end to end against the running API, not just by reading the map:
created a Garnish category, an item under it, attached it to Main Bar, and
confirmed it comes back in that bar's catalog — the route that applies the
module filter. Probe item deleted afterwards; the `Garnishes` category was kept
since the client wants it anyway.

### Notifications — forfeit, and what else was missing

The bell and the Dashboard's "Needs Attention" share one source
(`lib/attention.ts`), so both surfaces got these at once:

- **Overdue bottle keeps** (`bottleKeepsDue`) — ACTIVE keeps past `expiresOn`.
  Grouped under *Needs review*, not *Open work*: nobody started it and no amount
  of finishing clears it — it needs a judgement (forfeit, or let the guest have
  it). Gated on `entries.create`, the permission forfeiting actually requires.
- **Draft transfers** (`draftTransfers`) — missed when transfers were built,
  while its sibling `draftPurchases` had a bell entry from the start. Counted at
  `fromLocationId` only: while a transfer is DRAFT the source owns it (sync §7.2),
  so badging the destination would nag someone who cannot act.

Both are computed server-side against today, so a tab left open overnight cannot
show a stale "overdue".

### Two things that were already wrong, found while wiring it up

- **The header and the bell disagreed** — "Unresolved work 4 items" beside a bell
  reading 5. `dashboard.tsx` hand-summed six named fields; two more had been
  added since. Replaced with `unresolvedTotal()` in `lib/attention.ts`, which
  sums whatever numeric fields the payload actually has minus an explicit
  informational deny-list (`recentPriceChanges` — "unread", not "unresolved").
  A new server-side count now joins both numbers at once, or neither.
- **The all-clear message enumerated** — "No pricing, import, delivery, or count
  work needs review right now" had already gone stale. Now "Nothing needs your
  attention right now": a message that lists kinds is a message that will lie.

### Deep link

The badge promised a filtered view, so the page now honours one. `?status=OVERDUE`
is a pseudo-filter — not a stored status, but ACTIVE plus a date only the server
can judge — so it requests ACTIVE and narrows on the server's own `dueForForfeit`
rather than re-deriving "past today" against a possibly-wrong local clock. Empty
state reads "Nothing overdue", not "No bottles on keep". The by-guest roll-up
deliberately still counts everything, and now says so — filtered to Overdue, a
one-row table above "3 bottles on record" read as a contradiction.

### Verified

- Live: `attention` returns `bottleKeepsDue: 1`, bell and header both read 5,
  "1 kept bottle has passed the keep date" renders with correct singular grammar,
  deep link lands on exactly the overdue row, empty state correct.
- `verify:seed` PASS · `verify:sync` PASS · `verify:security` PASS ·
  `verify:mirror` MIRROR MATCHES THE SERVER, both golden anchors exact
  (−330.6857142857142 / −869.5714285714284 and −537 / −1410).
- Typechecks clean across all three workspaces. Desktop repackaged
  (`LIS Setup 0.1.0.exe`); the new migration ships in `resources/migrations`.

> `verify:security` fails wholesale under `FNB_REQUIRE_MFA=0` — that flag
> disables the gate seven of its assertions exist to test. Run it without.

## 2026-08-04 — Audit pass: impeccable + design-motion-principles

Ran the impeccable deterministic detector (0 findings) plus two isolated
assessments — a design review of the web app and a backend correctness/security
review — and applied the motion skill's audit lens weighted Emil-primary /
Jakub-secondary (SaaS dashboard; DESIGN.md's "state, not theater" already
encodes that philosophy).

### Cross-establishment leaks — the serious ones

Both are the same shape: a route that validates a foreign key on the *create*
path and trusts it on another path.

- **`routes/sales.ts` — `POST /sales/:id/correct`.** `saleCorrect` extends
  `saleCreate`, so it carries `locationItemId` and `menuItemId`, and the handler
  wrote both straight through. A correction could point a sale at another
  establishment's catalog row: `locationId` said this location, the FK said
  someone else's. The Sales report joins `locationItem`, so that establishment's
  item name, size and category would print on this one's report and export, and
  the Full Audit would value usage against a row this location doesn't own.
  Now checked exactly as `POST /sales` checks it.
- **`routes/imports.ts` — the match/commit path.** `PUT .../rows/:rowId` accepted
  any `matchedLocationItemId`, and commit re-read them with **no** location
  filter, then took the price from the foreign row. Both lookups are now scoped.
  Scoping alone wasn't enough: both price paths fall back to zero on a miss
  (`li?.retail ?? 0`), so filtering would have converted a cross-tenant read into
  a silent ₱0 commit — corrupt figures in the reconciliation instead of a leak.
  A miss now refuses the batch and names the row.

**Verified by attack, not by inspection.** A Main Bar sale corrected with a
Kitchen catalog row → **404 blocked**; the same correction with Main Bar's own
item → **201, still works**.

### Other backend fixes

- **`routes/settings.ts` — `PUT /item-unit-default/:itemId` had no `writeGuard`,**
  while both siblings had one and its own comment claimed "gated master.write".
  Any STAFF or read-only account with client access could rewrite the
  establishment-wide default display unit. Verified after: STAFF **403**,
  AUDIT_VIEWER **403**, MANAGER **200**.
- **`routes/location-items.ts` — the re-attach branch wrote cost and retail with
  no `$transaction` and no ActivityLog,** while the create branch directly below
  logs and `PUT /location-items/:id` logs a full before/after. "Archive the item,
  re-add it at a different cost" was the one way to move a valuation input with
  nothing recorded. Now logged as `locationItem.priceChange` in the same
  transaction, with the same before/after shape, so the dashboard counter and
  the Activity filter pick it up like any other price move.

### UI — load failures rendering as empty states

The pattern behind all three: the codebase already has the right answer
(`queryFailed` / `TableFailure`), and these screens predate it.

- **`pages/sales/index.tsx`** had no error branch at all — a failed fetch fell
  through to "Nothing recorded yet for this tab.", telling an encoder mid-shift
  that the sales they just entered are gone.
- **`pages/purchases/index.tsx`** — the Returned Bottles tab did the same while
  the Deliveries tab on the *same page* used `queryFailed`.
- **`pages/counts/session.tsx`** tested `isPending` before `isError`. A paused
  query stays `pending`, so a count opened on bad bar wifi sat on a skeleton
  indefinitely with no message and nothing to press — on the screen an encoder
  lives in all shift. The error copy also blamed the record ("it may have been
  removed") for what was usually a network fault; that wording is now reserved
  for an actual 404.

### Motion

- **One easing token.** DESIGN.md commits to `cubic-bezier(0.16, 1, 0.3, 1)`,
  but it existed only as a literal repeated across eight `@keyframes`. Every
  *utility-class* transition therefore ran on Tailwind's default ease-in-out —
  half the app honoured the contract, half didn't, and nothing could tell.
  Now `--ease-brand`, and also `--default-transition-timing-function`, so every
  `transition-*` inherits it. The six overlay primitives opt in explicitly
  (keyframe animations resolve `--tw-ease`, which only an `ease-*` utility sets).
- **The sheet was 500ms open / 300ms on ease-in-out** — stock shadcn, never
  brought in line with the committed 200ms. It drives the mobile sidebar and the
  Stocky panel, so half a second sat between tapping the hamburger and being able
  to tap a nav link. Now 200ms in / 150ms out on the brand curve (verified live
  on the real sheet).

### Hit targets — meeting the floor without undoing a client decision

`size="xs"` measures **27px** at this app's 18px root. That clears WCAG 2.2's
24px minimum but not DESIGN.md's stricter 32px floor — and shrinking these chips
was an explicit request ("too part apart and too bulky looking"), so making them
taller would have reversed it. Instead the *target* grew and the *button* did
not: a transparent `::after` on `xs`/`icon-xs`. Vertical only on `xs` — those sit
`gap-1` (4.5px) apart and a sideways expansion would fire the neighbour.

Measured by hit-testing every pixel row, not by reading the CSS: painted **27px**
(unchanged), effective target **35px**, **0** overlapping points with the adjacent
button. A first attempt at 3px measured only 31px effective and was still under
the floor — hence 5px.

### Verified

- `verify:seed` PASS · `verify:sync` PASS · `verify:security` PASS ·
  `verify:mirror` MIRROR MATCHES THE SERVER, both golden anchors exact.
- Typechecks clean across all three workspaces; web build clean.
- Detector: 0 findings before and after.

### Noted, not fixed

From the backend review, worth a decision rather than a silent patch:

- **Unvalidated `businessDate` on the import upload** (`imports.ts`): the only
  unvalidated business date on the server. `2026-13-45` commits sales that appear
  in no audit period, silently.
- **Cross-tenant access deletion** (`admin.ts`): `PUT /users/:id/access`
  `deleteMany({ userId })` is unscoped, so an OWNER can strip a shared user's
  access to an establishment they don't administer.
- Unvalidated `supplierId` on purchases; unlogged draft-line deletes and
  import-row approvals; one `toFixed` in a `menus.ts` log string; unbounded
  `findMany` in `verifyChain()`.

## 2026-08-04 — TOCTOU across the commit boundary (sync §7.2 Rule 2)

`assertExpectedStatus` answers "did this change while the device was offline?"
It cannot answer "is it changing *right now*", because the status it compares was
read outside any transaction. Every line route therefore had a real window: the
`status !== "OPEN"` check passed, a commit landed, then the insert wrote —
attaching a line to a **committed** count. Its ending quantity moves after the
audit period closed and the `count.commit` summary's "(N lines)" is already
wrong, and nothing downstream can detect it because the row looks ordinary.

Rule 1 (draft ownership) makes this rare but does not cover the case the desktop
actually creates: a device **replaying its outbox** is not the interactive editor
Rule 1 reasons about, so its queued line can arrive while a manager commits the
same count in the browser.

### Two mechanisms, in `lib/two-way.ts` beside the other Rule 2 helpers

- **`holdParentOpen`** — a *conditional self-write* on the parent before the line
  write: `UPDATE … SET status = 'OPEN' WHERE id = ? AND status = 'OPEN'`. It
  changes nothing, but it is a real write, so SQLite takes the row's write lock
  and holds it for the transaction. Both orderings become correct rather than
  merely unlikely: line-then-commit → the commit counts the line;
  commit-then-line → zero rows matched, `409 STATUS_CONFLICT`.
  (None of the three headers carries `@updatedAt`, so the self-write disturbs
  nothing — the sync doc had already reasoned that column away as "a column
  nothing read", which turns out to be why this technique is available at all.)
- **`transitionStatus`** — the commit/void flip becomes compare-and-set, which is
  what Rule 2 asked for in so many words. The flips were unconditional
  `update({ where: { id } })`, so two commits arriving together both passed the
  pre-check and both wrote — the second silently overwriting
  `committedAt`/`committedById`, crediting the wrong person at the wrong time.

Applied to line create, edit and delete, plus the header edit, on counts,
purchases and transfers; and to all five commit/void flips. 22 call sites.

### Verified — and the first two attempts did not verify it

- 20 concurrent add-line/commit pairs: the line won all 20. A correct outcome,
  but it never exercised the commit-first ordering, so it proved nothing.
- 30 more with the commit dispatched first: the line was refused 30/30 — but by
  the **outer pre-check**, not the guard. An HTTP race almost always ends there,
  so it cannot demonstrate the guard at all.
- What actually works: drive the two transactions directly and pin the
  interleaving. New harness **`verify:races`** (throwaway db, same runner as the
  other three) holds the parent lock across a 400 ms window with a commit firing
  into it, and asserts the commit is serialised behind the insert rather than
  slipping in. Also asserts the guard refuses on a COMMITTED parent *and* that
  the line rolls back.

> A check I wrote and then had to throw away: "no CountLine anywhere has
> `createdAt` after its session's `committedAt`" reported **486 offenders**. They
> are all seed data — the seeder stamps `committedAt` and writes the lines
> milliseconds later (480 of 486 were sub-second gaps; the rest are deliberately
> backdated sessions), and none were from the probe. `createdAt` is insertion
> wall-clock, not evidence of route ordering, so the scan was unsound as a global
> invariant. Scoped to rows that actually went through the routes, it passes.

Happy paths re-checked end to end after the change (create → add line → edit →
delete → commit, on all three documents, plus the 409 once committed): pass.
`verify:seed` · `verify:sync` · `verify:security` · `verify:mirror` ·
`verify:races` all pass, both golden anchors exact. Three workspaces typecheck.

All six remaining audit findings are closed — see the next entry.

## 2026-08-04 — The remaining six audit findings

### 1. Business dates were never validated as dates — wider than reported

The finding named the import upload. The real problem was one level down:
`dateString` in `packages/core` was **regex-only**, and `^\d{4}-\d{2}-\d{2}$`
happily matches `2026-13-45`, `2026-02-30`, `2026-00-10` and `9999-99-99`. Every
business date field in the app accepted all of them.

That is not cosmetic. Report windows compare these lexicographically
(`saleDate: { gte: from, lte: to }`) — the whole reason the format is TEXT — so a
sale dated `2026-13-45` sorts past `2026-12-31` and lands in **no** audit period.
The revenue stops appearing in the reconciliation with nothing raised anywhere.

Fixed at the root: `dateString` now round-trips through `Date.UTC` and compares
the parts back, which is what catches an impossible day (`Date.UTC` normalises
Feb 30 → Mar 2). Used only to validate — no derived value escapes — so the
file's own "never build a JS Date from a business date" rule still holds.
Leap years included: `2024-02-29` accepted, `2026-02-29` rejected.

The import upload needed its own fix regardless: it is multipart, so zod never
sees the body and it was the one date on the server with no validation at all.

### 2. Cross-tenant access deletion (`admin.ts`)

`PUT /users/:id/access` ran `deleteMany({ where: { userId } })` — unscoped.
Neither guard covered it: `assertActorMayTouchUser` proves the target shares
*one* client with the actor, `assertActorMayAssign` validates only the ids being
*supplied*. So a user with access to establishments A and B lost B the moment
the owner of A saved `{clientIds:["A"]}` — silently, from a screen that never
showed B. The delete is now scoped to the actor's own establishments; ADMIN
keeps the full replace, since their list genuinely is the whole intended set.

**Verified as the attack**: seeded `owner` (scoped to Prime Hospitality) saved
shared user `staff` as [Prime]. Aurora Asset Holdings access **survived**.

### 3. Cross-tenant `supplierId` (`purchases.ts`)

Create and the header PUT both took `supplierId` from the body unchecked, and
`GET /purchases/:id` returns `include: { supplier: true }` — the whole row:
contact person, phone, email, address, payment terms. One helper, called by both
paths so they cannot drift apart again. Verified: another client's supplier →
404 on create and on PUT; own supplier still works on both.

### 4. Mutations that left no record

- **Draft-line deletes** (counts, purchases, transfers). A hard delete before
  commit is legitimate — nothing has entered the ledger, so there is no void
  chain to keep — but these were the only mutation class in those files leaving
  no trace at all, so "the count was three bottles short when we opened it" had
  no answer. The row still goes; what it was is now recorded.
- **Import-row review** (`imports.ts`). This is the human-review step CLAUDE.md
  singles out — "imports/AI never mutate inventory without human review" — and it
  was the part of that promise with no evidence behind it. Only the batch-level
  `import.commit` was logged, so "who approved this row, and did they change the
  quantity on the way through?" was unanswerable. Now logged in the same
  transaction as the write, recording only fields that actually moved.

### 5. `toFixed` in domain code

One occurrence, in a `menus.ts` log string → `phpRound`. README rule 2 has no
display exemption, and a half-cent rounds differently.

### 6. `verifyChain()` loaded the whole table

ActivityLog is the one table with no retention policy (§7.6 prunes SyncOp and
nothing else), so it grows for the life of the install — and this loaded every
row including every `detailsJson` inside the request timeout. Now paged at 2000.
Paging is free because the walk is already strictly sequential: `prev`,
`expectedSeq` and `gaps` carry across a page boundary exactly as across rows.

**Verified by differential run**, since 497 rows would never have crossed a
2000-row boundary: the verdict at page size 2000 (one page) and page size 37
(~14 pages) is byte-identical.

### ⚠️ I broke the dev database's audit chain

That differential run surfaced something I caused. `verifyChain` now reports
`ok: false`, a break at seq 486, and **71 missing rows** (seq runs 1–568, 497
present).

Those are my probe cleanups. Deleting the probes' *business* records was fine;
deleting their **ActivityLog** rows was not — that is precisely what the hash
chain exists to detect, and it detected it. `seal-history` will not repair this:
it only seals rows with a null `seq` and deliberately leaves chained rows alone.

Nothing functional depends on it (reports never read the chain; the harnesses all
use throwaway databases, which is what I should have used). It affects
`GET /api/activity/verify` on the dev database only. **Left for a human to
decide** — re-seeding gives a clean chain, and rewriting it to agree would be
forging audit history, which is not a thing to do unasked.

Later cleanups in this session touched business rows only.

### Verified

- Live: impossible dates refused on both the JSON routes and the multipart
  import (valid ones still accepted); foreign supplier refused on create and
  PUT; shared user's second establishment survived a scoped owner;
  `countLine.remove` appears in the activity trail.
- `verify:seed` · `verify:sync` · `verify:security` · `verify:races` ·
  `verify:mirror` all pass, both golden anchors exact. Three workspaces
  typecheck. Desktop repackaged.

## 2026-08-04 — Dev database re-seeded (audit chain repaired)

Requested after the previous entry's disclosure. Two things were worth knowing
first, and neither was obvious:

- **The seed never wipes.** It is entirely upsert-based, so running it against
  the existing file would have changed nothing and repaired nothing. A real
  re-seed means rebuilding the file.
- **The seed does not recreate everything.** `UserMfa`, `Device`, `DevicePin`,
  `BottleKeep` and `LocationArea` have no seed path, so a rebuild loses them for
  good.

Sequence: `npm run backup` (verified: integrity ok, 507 activity rows, 1.4 MB) →
old file moved aside rather than deleted (`data/pre-reseed-20260804-195357-*`) →
`prisma migrate deploy` → `prisma/seed.ts` → `seal-history --confirm`.

`prisma migrate reset` stays off-limits, so the rebuild is the file-plus-migrate
route.

**The seal step is not optional and is easy to miss.** Straight after seeding,
`verifyChain` reported `ok: true` — but with `checked: 0` and `unchained: 14`.
The seed writes ActivityLog rows without a `seq`, so a "clean" verdict there
means *nothing was checked*, not *everything verified*. After sealing:
`ok: true, checked: 15, unchained: 0, gaps: 0`, seq 1–15 contiguous.

Anchor worth keeping outside the database, per the tool's own advice:
`seq 15  41428f5f793e0b36dbe893e01a7412c36b2349b51a65e71008ee753508a8d138`

### Verified on the rebuilt database

- Golden fixtures reproduce **on the dev database itself**, not only in the
  throwaway harnesses: −330.6857142857142 / −869.5714285714284 and −537 / −1410.
- All five harnesses pass. Garnish is present in the seeded `productTypes`.
- Web app signs in and renders (as `manager`).

### Two consequences to expect

- **ADMIN and OWNER hit the 2FA enrolment screen on first sign-in.** `UserMfa`
  was wiped and `MFA_REQUIRED_ROLES = ["ADMIN", "OWNER"]`. `FNB_REQUIRE_MFA=0`
  relaxes the *server* gate only — the web app still renders the setup screen for
  those two roles. `manager` and below sign in normally.
- **The desktop needs re-registering.** Both `Device` rows ("Front bar PC",
  "Provisioning rehearsal PC") and all four `DevicePin` rows are gone.

Old data recoverable from `data/pre-reseed-20260804-195357-fnb.db` or
`data/backups/fnb-20260804-195339.db`.

## 2026-08-04 — Desktop: caption strip, sign-in scroll, and two crashes

### The caption strip — three wrong diagnoses before the measurement

`titleBarStyle: "hidden"` + `titleBarOverlay` were already correct, which is why
the window BUTTONS were brand navy while the rest of the strip showed wallpaper
with the OS title across it. Two attempts missed:

1. `backgroundMaterial: "none"` — on the theory that Windows 11's Mica backdrop
   was beating `backgroundColor`. It is still correct to set, but changed nothing
   here.
2. Re-applying `setTitleBarOverlay` after `show()` — on the theory that creating
   the window with `show: false` meant the constructor options missed. Also no.

What settled it was measuring instead of theorising:
`getContentBounds().y === getBounds().y`, **inset = 0**. The web contents already
reach the very top of the window, so there is no reserved strip for any
background colour to fill. Windows keeps a caption for the Window Controls
Overlay, `titleBarOverlay.color` reaches only the button strip, and the OS paints
its own backdrop and title across whatever the page leaves unclaimed.

So the page claims it: a fixed 32px band in `#112555` marked
`-webkit-app-region: drag`, injected with `insertCSS` on `did-finish-load`.
Injected from the main process rather than added to the SPA because the same
build serves the browser, where there is no caption to cover.

### Sign-in scrolled with almost nothing in it

Two rounds here too. First fix reduced padding — `pb-16` is **72px** at this
app's 18px root, not 64, and with `lg:py-10` the panel measured 627px against a
600px viewport. That fixed the password form and missed the point: the PIN
variant lists every member of staff, so its height is DATA. No padding value
survives a list of twenty.

Now `lg:h-dvh lg:overflow-hidden` on the grid and `lg:min-h-0 lg:overflow-y-auto`
on the panel — the window never scrolls, and the panel scrolls inside itself when
it genuinely needs to. Below `lg` the columns stack and ordinary page scroll is
correct.

### Two crashes found on the way

- **`{"error":"Internal server error"}` replacing the entire desktop app.**
  `getSessionUser` did `session.user.status` where `session.user` was null. The
  mirror was holding 14 `AuthSession` rows issued by the PRE-RESEED database —
  user ids that no longer exist. Foreign keys are deliberately OFF in the mirror
  (a partial view legitimately dangles), so the join returned null instead of
  erroring, and every request 500'd. Two fixes: `getSessionUser` now treats a
  dangling user as "not signed in" and deletes the row, and `applySnapshot`
  purges `AuthSession WHERE userId NOT IN (SELECT id FROM User)` — scoped to
  provably-dead rows, so it is safe on every pull, not just the first.
- **"This computer: This computer".** `setup:finish` derived the device name from
  the OLD config with a `?? "This computer"` fallback, so a fresh setup — which
  by definition has no old config — discarded the name typed on the form. Now
  carried across the two IPC calls.

### Also

- **Setup errors showed Electron's plumbing.** Every rejected IPC call arrives as
  `Error invoking remote method 'setup:register': Error: <the real one>`, so a
  licence message written to say what to do next opened with an internal channel
  name. Unwrapped in `setup.html`.
- **"FNB/LIS" → "Liquor Inventory Solution"** on four client-facing screens AND in
  the **TOTP issuer**, which is what an authenticator app displays above the code.
  The issuer is baked into each enrolment at signup, so it can never rename an
  entry already on a phone — the reseed having cleared every enrolment made this
  the one safe moment to change it.

### Desktop re-registered

Completed against the rebuilt database: `Front bar PC` ACTIVE under the preserved
`front-bar-pc-fixed-0001` fingerprint, Main Bar, snapshot pulled, session
encrypted at rest. The orphan row from the interrupted attempt was revoked
through the admin route.

`Subscription.maxDevices` raised to 2 — `verify-mirror.mjs` registers a
"Provisioning rehearsal PC" against the REAL server under a fixed fingerprint, so
a dev machine running both it and the app needs two slots, exactly as that file's
header says. Noted: **no admin route can set `maxDevices`** —
`subscriptionUpdateBody` accepts `maxEntities` and `maxUsers` but not this one, so
a `PUT` returns 200 and silently changes nothing. Written directly; worth adding
to the schema.

## 2026-08-04 — `maxDevices` is editable

Closing the gap from the previous entry: the device cap was enforced but no
route could set it. `subscriptionUpdateBody` omitted the field, so a `PUT`
carrying it returned **200 and changed nothing** — zod stripped it before the
handler's `{ ...rest }` passthrough ever saw it. That passthrough is also why the
schema was the only blocker: adding the field is enough for the update to land.

Added to **both** bodies, not just update — a create that cannot set what an
update can is the same trap one step earlier. `subscriptionCreateBody` gets
`.default(1)`, matching the Prisma column and the shipped "one client computer"
assumption; the create route needed an explicit `maxDevices: body.maxDevices`
because it lists fields rather than spreading.

Two decisions worth recording:

- **Not an input to `derivePackageType`.** The tier is billingCycle + maxEntities
  + maxUsers. A fourth axis would let the badge move for a reason the pricing
  table does not mention. Verified: editing the cap left FULL as FULL.
- **No narrowing guard.** `modules` has one because narrowing there cascades a
  delete. The device cap is read only when a NEW machine registers, so lowering
  it leaves registered computers working and blocks the next one — exactly how
  `maxEntities` and `maxUsers` already behave. Inventing a stricter rule for this
  one field would be the inconsistency, not the safety.

UI: a **Max Computers** field beside Max Users in the client dialog, wired
through all three call sites (create client, create subscription, edit). The
helper says what the number does and that lowering it never disconnects a
machine already registered — the question an administrator would otherwise have
to guess at.

### Verified

- API: `PUT maxDevices=3` → persisted, survived a fresh read, tier unchanged.
- UI: typed 4 in the Manage dialog, saved, confirmed in the database (Aurora
  1 → 4), then restored. This exercised the hand-wired dirty check and payload.
- All five harnesses pass; three workspaces typecheck.

> `.claude/launch.json` — `autoPort: true` on the `web` entry. Another project on
> this machine holds Vite's default 5173. Note that Vite ignores the assigned
> port and picks its own next free one (it does not read `PORT`), so the
> preview URL and the real one can differ — it landed on 5174.

## 2026-08-04 — Walking the app as a first-timer

Drove the real app end to end pretending to know nothing: landing → sign-in →
dashboard → start a count → pick an item → weigh it → save; plus the Sales entry
pane. Findings and fixes below. **Not a complete sweep** — purchases, transfers,
imports, the reports hub and the admin screens were not walked.

### The one that would have produced wrong numbers

**The scale unit could not be changed, and getting it wrong blamed the wrong
thing.** The weigh field takes whatever unit the ITEM's tare is stored in, with
no way to switch. Every seeded tare is in **ounces** — for a Philippine bar,
where the scale on the counter reads grams.

Typing `812` (grams, what the scale shows) into the ounce field gave:

> `(scale 812 − empty 16.9 oz) × Liquid Weight 30.12 = 23,948 ml` ·
> `fills ≈ 3,421% of the 700 ml bottle` ·
> *"That's more than a full container holds — check the Liquid Weight or empty weight."*

The warning sends the counter to go check master data they cannot edit, for a
problem that is not in the master data. And with no unit toggle, a gram scale
simply could not be used.

Two fixes:

- **A g/oz toggle on the scale field.** Deliberately an INPUT convenience: the
  typed value is converted into the item's own unit before anything else sees
  it, so the value sent to the server, and `remainingContent` on both sides,
  keep working in one unit. That matters because `buildLineData` subtracts tare
  from scale with no conversion of its own — a toggle that changed the wire
  format would have made the server quietly disagree with the preview.
- **Name the likely cause.** When the reading overflows the bottle but fits in
  the other unit, say so: *"That reading is far more than this bottle holds, but
  it fits if it is in grams. Switch the unit above rather than changing the
  bottle's weights."*

Verified end to end: 812 g → hint appears → switch to g →
`(scale 28.64 − empty 16.9 oz) × 30.12 = 354 ml`, `51% of 700 ml` → saved → the
SERVER stored `354 ml`, matching the preview exactly.

> **Two bugs in my own first attempt, both caught by testing rather than
> reading.** The hint was keyed on `blocking`, but CONTENT_EXCEEDS_SIZE is an
> amber warning by design and never sets it — so it never fired. And the formula
> strip labelled the tare with the TYPED unit, printing "empty 16.9 g" when the
> empty weight is 16.9 oz: the arithmetic was right and the caption was a lie,
> which is worse than the original problem. Both fixed; `nativeUnit` is now
> carried on every preview branch.

### The rest

- **Sales rapid-entry was not autofocused** (`document.activeElement` was
  `BODY`). DESIGN.md's signature pattern specifies an autofocused picker and
  Counts does it; Sales is the other rapid-entry screen and the STAFF persona is
  keyboard-first, so every session and every tab switch started on the mouse.
- **Three counting modes, no guidance.** Full Units / Weigh Partial / Open
  Amount carried no tooltip and no hint. Obvious once shown, guesswork on a
  first shift — and guessing wrong is what puts a wrong number in the audit.
  One line under the tabs, changing with the mode.
- **"Counted Quantity" had no unit.** For a 700 ml bottle, an unlabelled box
  invites someone to type 700. Now says what it counts.
- **A second count started silently** while one was already unfinished. Allowed
  — two dates can legitimately be mid-count — but doing it by accident is the
  common case, and neither count reaches a report until committed, so the
  mistake is invisible. The dialog now names the open one and offers to continue
  it.
- **Converted readings displayed as `28.642457103059293 oz`.** Stored value
  stays exact; only the display is shortened, via `phpRound`.

### Verified

`verify:seed` · `verify:races` · `verify:mirror` pass, golden anchors exact.
Three workspaces typecheck.

### Found, not fixed

- **Every seeded tare weight is in ounces** for a Philippine client. Demo data
  the client replaces, but it shapes the out-of-box experience and is why the
  unit bug was invisible until someone tried to use a real scale. Worth reseeding
  in grams.
- The location switcher has no `aria-label` — a screen reader hears the client
  and location names with no indication it is a control.

## 2026-08-04 — First-timer walkthrough, part 2

Purchases, transfers, imports, reports and admin, walked the same way.

### Fixed

- **Purchase line `Qty` carried no unit.** A delivery is precisely where cases
  and bottles get conflated — "12" of a 1 L Cola could be a dozen bottles or a
  dozen cases, and the Unit Cost beside it only means something once that is
  settled. Now names the variant.
- **Two selects had labels bound to nothing.** Transfers' **Destination** and
  Imports' **Import Type** rendered `<Label>` with no `htmlFor` over a trigger
  with no `id`: a screen reader announces an unlabelled combobox and clicking the
  word does nothing. Every other select on those pages was already wired
  correctly, so these were oversights, not a convention.
- **The Full Audit never explained its own notation.** Begin and End read
  `1 + 0.97` with nothing anywhere saying what the two halves are — on the report
  the client trusts above all others. A number nobody can read is a number nobody
  can check. Now stated under the period explainer.
- **Sentence-case buttons, 12 of them.** DESIGN.md specifies Title Case for
  buttons and the identical string was shipping both ways ("Save Changes" on
  Sales and Transfers, "Save changes" on Counts and Items). Swept.

### Walked and found sound — not re-auditing these

- **Import review** is the best screen in the app: bulk actions, per-row
  Approve/Decline, EXACT/ALIAS badges, "No confident match. Choose an item or
  reject.", and an explicit "Duplicate POS line" flag.
- **Reports hub** — every report carries a plain-language line saying what
  question it answers, with the Full Audit leading at its own weight.
- **Purchases** — draft-first ordering, item picker autofocused, "Receive a
  Delivery" dialog correctly marks Supplier and Invoice optional.
- **Users** — destructive actions live behind Edit rather than on the list.
- The earlier `xs` hit-target fix carries into the import review's per-row
  buttons: 27px painted, **34px** effective target.

### Still open

- Every seeded tare weight is in ounces for a Philippine client (from part 1).
- The location switcher has no `aria-label`.
- The desktop app was not walked.

## 2026-08-04 — Desktop walkthrough

### The blocker

A freshly provisioned bar PC is **unusable and never says why**. Every staff name
renders greyed with "no PIN", clicking one does nothing at all, and no text
anywhere mentions that a PIN exists, what it is for, or how to get one. Staff
arrive for a shift and the computer is a dead end.

The fix is a two-minute job nobody could discover: `POST /auth/pin` is
self-service, so each person sets their own from Settings in the web app. The
PIN screen now says exactly that when nobody has one.

Not a regression from the reseed — the reseed only made it visible. Any genuinely
new installation starts in this state, which is every real deployment's first day.

### Verified good

Title bar solid navy edge to edge, device name reads "Front bar PC", no
scrollbar — the part-1 and caption fixes all hold in the packaged app.

### Also found: the Prisma client was stale

`@fnb/desktop` typecheck failed on `apps/server/src/routes/admin.ts` — the schema
declares `reports SubscriptionReport[]` (the report-tiers work, commit 81b9adb)
but the generated client had never been regenerated. Exactly the documented
Windows gotcha: `prisma migrate` does not regenerate the client. `db:generate`
fixed it; all three workspaces typecheck.

Worth noting it surfaced only because the desktop typechecks the server sources —
`@fnb/server`'s own typecheck had been passing against the stale client all along.

## 2026-08-04 — Demo catalog seeded in grams; switcher labelled

### Grams

The demo catalog is still AUTHORED in ounces — that is how the reference sheets
were written — but it is now SEEDED in grams, because the client is a Philippine
bar and the scale on their counter reads grams. Left in ounces, a counter had to
convert every reading in their head before typing it.

Tare scales up and the density factor scales down by the same constant, so the
millilitres are identical either way:

    (s·k − t·k) × (d/k)  ≡  (s − t) × d

The golden-fixture count lines are deliberately NOT converted. Each carries its
own explicit scale/tare/density — a snapshot of how that bottle was actually
weighed — so they stay internally consistent in ounces and the anchors cannot
move. Mixed units across catalog and history is not a smell here; per-line
snapshots are the design.

Verified: `479.1 g` tare, Vodka density `1.0625`, and a bartender typing `812`
now gets **354 ml / 51%** with no unit switching — the same physical answer the
ounce path produced. Both anchors unmoved (−330.6857142857142 / −537).

The g/oz toggle stays: it is what rescues a bottle weighed on the other kind of
scale, and it is now the exception rather than the price of entry.

### Switcher

`aria-label` on the establishment/location control. It had none, so a screen
reader heard two names and the logo's alt text with nothing saying it switches
anything — and collapsed to the icon rail there is no visible text at all.

All five harnesses pass; three workspaces typecheck.

## 2026-08-04 — Demo client seeded with maxDevices 2

Prime Hospitality now seeds `maxDevices: 2`; Aurora and Casa Verde keep the
shipped default of 1. Prime is the client a dev box points at, and
`verify:mirror` registers its own "Provisioning rehearsal PC" against the REAL
server under a fixed fingerprint — with one slot, the rehearsal and an actual
desktop install fight over it, and every re-seed stranded whichever lost. This
removes one of the three manual steps a database rebuild used to require.

### It broke a harness, and that was the useful part

`verify:sync` asserted *"a second machine is refused by the licence cap"* — the
cap being 1 was baked in as a constant, so raising it turned a real assertion
into a failing one. Bumping the number would have been the wrong fix: the test
would then assert nothing about the cap it claims to check the moment the seed
changed again.

It now reads `maxDevices` off the subscription, fills exactly that many slots
(each of which must be ACCEPTED), and asserts the machine *past* the cap is
refused. Output: `the licence covers 2 machine(s), and all 2 register — 2 of 2`
and `the machine past the cap is refused — status 403`. The invariant is the
same; it is no longer pinned to one number.

All five harnesses pass; three workspaces typecheck.

## 2026-08-04 — Dev desktop's device row seeded

The seed now pre-registers `front-bar-pc-fixed-0001` as "Front bar PC" at Main
Bar — the fingerprint the installed desktop persists in its config and reuses
across reinstalls (`apps/desktop/src/config.ts`: a random id generated once,
deliberately not derived from hardware). `resolveDevice` recognises the machine
on first login instead of registering it afresh, so repeated database rebuilds
stop leaving a trail of orphan rows eating licence slots.

**It does not remove the setup wizard, and it was never going to.** The desktop's
stored `locationId` and session belong to the previous database, and locations
are created with generated ids, so the config is stale after any rebuild whatever
the Device table says. Going further would mean pinning stable ids across client,
location and device *and* seeding a known `DevicePin` — a chain of demo fiction
ending in a published PIN hash. Not worth it.

Seeded deliberately WITHOUT a session or a PIN: the row asserts "this machine is
known", never "this machine is signed in". Verified on a fresh database —
`AuthSession` 0, `DevicePin` 0.

The `verify:sync` cap test absorbed this without edits, because it had just been
rewritten to read `maxDevices` and count existing ACTIVE devices rather than
assume a starting state: `the licence covers 2 machine(s), and all 2 register —
2 of 2`, `the machine past the cap is refused — status 403`. Had it still been
the hard-coded "a second machine is refused", this change would have broken it a
second time.

All five harnesses pass; three workspaces typecheck.

## 2026-08-05 — Group 1 of 5: arrival & shell

### The public landing page was unreachable

A visitor with no cookies going to `/` was redirected to `/login?expired=1` and
told **"Your session ended — sign in again to continue."** They had never had a
session, and they never saw the landing page at all — the exact opposite of
DESIGN.md, where `/` is the public front door and only SIGNED-IN visitors are
bounced away.

Cause: the global 401 handler in `main.tsx` exempted `/login` (a failed sign-in
is a 401 too) but not `/`. The landing page's own session probe 401s for every
signed-out visitor, so the front door redirected past itself. Now exempt —
matched exactly, since every real app route lives under `/l/:id` and a prefix
test would exempt the whole application.

Verified: `/` renders "Your partner in inventory management" with the Full Audit
verdict card, no false notice.

### No skip-to-content link

A keyboard user crossed seventeen sidebar links before reaching the page on every
navigation — on an app whose STAFF persona is "keyboard-first speed". Added as
the first element in the tree; `#page-content` gained `tabIndex={-1}` so focus
actually lands.

> Three attempts, and the first two were wrong in a way worth recording.
> `sr-only` + `focus:not-sr-only` left `clip-path: inset(50%)` applied while
> focused — a keyboard stop nobody could see, worse than none. A Tailwind
> `focus:` transform variant behaved the same. I then built a React-state
> version before realising the browser pane reports a **0×0 viewport** and
> fires no focus events: every geometric measurement I had taken was an
> artifact, and I was debugging the harness. Reverted to the plain CSS
> `:focus` rule and verified in the BUILT stylesheet instead —
> `.skip-link{transform:translateY(-250%)}` / `.skip-link:focus{transform:translateY(0)}`,
> same layer, `:focus` winning on specificity.

### Walked and sound

Command palette (Ctrl+K): 46 entries across Navigate / Reports / Items / Menus /
Suppliers. Dashboard: audit stage, next action, attention list and bell all
agree. Location switcher carries its `aria-label` from the previous pass.

### Caveat

Visual/geometric verification is not currently possible in this browser pane
(0×0 viewport, no compositing, no focus events). Copy, structure, DOM state and
built CSS were checked instead; anything genuinely visual in the remaining
groups needs a human eye or a working pane.

## 2026-08-05 — Group 2 of 5: catalog & master data

### My own grams change left stale copy behind

The New/Edit Category dialog explained Liquid Weight as *"e.g. Vodka is 30.12 ml
per oz"* while the field beside it now reads **1.0625**. Anyone reading the help
text against the data would conclude one of them was broken.

Rewritten without a fixed example, because the number is millilitres per ONE unit
of whatever the bottle's empty weight is recorded in — any hard-coded example is
wrong for half the installations. Now: *"millilitres per unit of whatever the
bottle's empty weight is recorded in — per gram if the empty weight is in
grams"*, with a magnitude hint (spirits ≈ 1.06 ml/g, syrups lower).

The same staleness sat in `packages/core/src/weighing.ts`'s doc comment for
`densityFactor`. Corrected — comment only, no arithmetic touched, golden anchors
re-verified (−330.6857142857142 / −537).

> Worth noting: this is the second-order cost of the unit change, and only a
> walkthrough finds it. Nothing typechecks a sentence.

### Local Database column read as an unexplained number

`Tare / Liquid Wt` rendered `479.1 g / 1.0625`, the second value bare. Renamed to
**Empty Weight / ml per unit** with a title attribute spelling out the
relationship — the header is the only place with room to say it.

### Walked and sound

- **Item form** — "Changes apply everywhere this item appears", "Sizes are fixed
  once created", per-variant "Open content · empty 479.1 g". Grams flow through.
- **Suppliers** — every field labelled and associated, name autofocused, payment
  terms humanised ("C.O.D.", "7 Days" rather than `NET_7`).
- **Recipes** — cost, SRP, margin and sales per menu, with History and New
  version; versioning is legible without explanation.
- No unassociated labels anywhere in this group.

`verify:seed` · `verify:races` pass; three workspaces typecheck.

## 2026-08-05 — Groups 4 & 5 of 5: review/reports, admin/settings

Thin pickings, which is the useful result: both areas are in better shape than
Groups 1 and 2 were.

### Fixed

- **Import drop zone was unnamed to a screen reader.** The visible control is a
  `role="button"` div; the real `<input type="file">` is hidden and clicked
  programmatically. Sighted users read "Drop a file here, or click to choose" —
  assistive tech got an unnamed button and a second unnamed file input. The
  wrapper now carries an `aria-label` naming the accepted formats, and the
  hidden input is removed from the a11y tree so it stops being a phantom
  duplicate.
- **Settings: two "Add an item" labels bound to nothing**, in the per-item
  display-unit sections. Given distinct ids (`unit-add-item`,
  `client-unit-add-item`) — the two blocks are identical markup on one page, so
  a shared id would have pointed both labels at the same control.

### Checked and sound

- **Report tiering is coherent.** `/reports/variance` refuses with "This report
  isn't part of your access", and the hub genuinely does not offer it — the
  Variance Report is `full-audit?variance=only`, a filtered Full Audit. I had
  reached a slug the hub never advertises. 21 reports enabled for Prime; every
  one of the hub's 19 cards resolves.
- **Sales report** renders chart, stat tiles and Excel/CSV/PDF.
- **Activity** — When / Who / Action / Summary with human summaries beside the
  action codes, which DESIGN.md sanctions specifically in the trail.
- **Settings** carries an "Offline desktop PIN" section, so the desktop
  dead-end guidance added in Group 1 ("open Settings, choose a 6-digit PIN")
  points at something real. Preferred unit reads "Metric (g / kg)", consistent
  with the seeded grams.

> A probe of mine produced ten false failures: I called every report endpoint
> with `begin`/`end`, but several take `from`/`to` and three
> (bottle-keep, blank-forms, count-sheet) are client-rendered pages with no API
> endpoint at all. Checked through the UI instead. Worth recording because the
> failure mode — a malformed probe reading as a broken app — is the same one
> that produced the 486 "corrupted" rows earlier in this session.

Three workspaces typecheck; `verify:seed` and `verify:races` pass.

## Group 3 — Daily entry (2026-08-06)

The last of the five simulation groups, and the one people touch every shift.

- **The three record kinds now say what they are for.** Sales / Non-Revenue /
  Production named themselves and nothing else. Picking the wrong one puts the
  stock in the wrong half of the reconciliation, so each tab carries a line:
  paid for · left with no money against it · used up making something in-house.
  Same treatment the count screen's three modes already had.
- **Receive-transfer grid: the per-row inputs had no accessible name.** A column
  header does not label a control, so the whole dialog read as anonymous text
  boxes. Each now names its item.
- **Its Note column claimed "required when short"; the rule is "when it
  differs"** — an over-receipt was refused by a validator the header denied
  existed.
- **The purchase editor sat on a skeleton forever when the server went away.**
  A paused query stays `isPending`, and this editor checked only that. The
  Transfer editor already made the split; the check it hand-rolled is now
  `queryPaused()` in `table-surface`, used by both.
- **The Users dialog's client picker had both bugs at once** — a skeleton that
  never resolved while unreachable, and "No clients exist yet" if the fetch
  errored. `TableError`/`TableFailure` take a `className` now so the same fill
  can sit in a dialog field instead of a table body.
- **Four form controls with a dangling `<Label>`** — the transfer editor's item
  picker, and Password / Role (both dialogs) in Users. `ItemCombobox` already
  forwarded an `id` for exactly this; `RoleSelect` now does too.

`verify:seed` passes; web typechecks.

