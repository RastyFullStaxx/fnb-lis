# Project overview — FNB/LIS

**Start here.** What this is, where it stands, and which document answers which question.

## The mission

Rebuild the legacy PHP/CodeIgniter bar & kitchen inventory-audit system
(`C:\xampp\htdocs\fnb-main`) as a modern, universal, audit-grade inventory platform — dramatically
faster and cleaner than the legacy, while reproducing **the audit-period reconciliation math the
client trusts, exactly**.

```
Beginning Count + Purchases + Returned Bottles + Transfers In − Transfers Out − Ending Count = Usage
(Sales + Recipe Consumption + Non-Revenue + Production) − Usage = Variance
```

Web application first; Electron desktop (offline SQLite + sync) later, reusing the same core,
schemas, and UI.

**The client (LIS) runs audits for multiple establishments.** Everything is scoped to the active
client location. The one thing the client trusts above all is the **Full Audit reconciliation
report** — its math is sacred.

## Status — 2026-07-23

Phases 0–9 complete. The full audit cycle, reports, exports, imports, dashboard, admin, Stocky,
and inter-location transfers are all shipped and verified against hand-computed fixtures.

**Asset module shipped** (build-log Phase 17): Brand/Model on the catalog, six per-location detail
fields (Serial No., Condition, Status, Initial Cost, Remarks, Asset Code) editable via a Local
Database dialog, Beginning/Ending counts reusing the existing count-entry screen unchanged, and two
new reports (Asset Register, Asset Inventory) alongside the Asset Breakage report Phase 16 already
shipped. Both implementation calls the proposal left open (`assetCode`'s home; the edit-surface
shape) landed on the plan's own recommended defaults — `LocationItem.assetCode` and a sibling
`Dialog` component — with no open question left behind.

**Verification stance:** no automated test framework (explicit instruction). Correctness rests on
[golden-fixtures.md](golden-fixtures.md) plus live checks. Re-verify the relevant fixture after any
change to `packages/core` or the report services.

## Where things live

| Question | Document |
|---|---|
| Rules I must follow while coding | `CLAUDE.md` (repo root, always loaded) |
| What is this product, who uses it, what are the workflows | [PRODUCT.md](PRODUCT.md) |
| How should a screen look and behave | [DESIGN.md](DESIGN.md) |
| Stack, data model, **formula appendix (§6)**, deviation log | [architecture.md](architecture.md) |
| The numbers that must never change | [golden-fixtures.md](golden-fixtures.md) |
| What shipped when, and what the audit found | [build-log.md](build-log.md) |
| How the legacy system behaved (answer key) | [reference/](reference/) — read-only |
| Original project brief | `AGENTS.md` (repo root, historical) |

## Stack of record

| Layer | Choice |
|---|---|
| Monorepo | npm workspaces: `apps/web`, `apps/server`, `packages/core` |
| Frontend | Vite · React 19 · TypeScript · Tailwind v4 · shadcn/ui · React Router 7 · TanStack Query 5 · react-hook-form + zod · Recharts · Geist |
| Backend | Hono (`@hono/node-server`, :3001) · Prisma 6 · SQLite (WAL) — Postgres-portable schema |
| Domain | `@fnb/core` pure TS (schemas, units, weighing, reconciliation, pricing, billing, cost-analysis, phpRound) |
| AI | `@anthropic-ai/sdk` · `claude-sonnet-5` · structured outputs · env-gated |
| Exports | exceljs (xlsx) · core CSV · print stylesheets |
| Later | Electron + local SQLite + sync outbox · PostHog/Sentry (wired, env-gated) · Playwright (post-build) |

## What must never regress

1. The reconciliation formulas in [architecture.md §6](architecture.md) — verified against the
   legacy PHP line-by-line, including the three nuances (content-override exclusion, per-unit
   content path, total-serving revenue share) and forfeit **add-back** semantics.
2. Committed records are immutable; corrections are visible void/correction chains; every mutation
   logs to ActivityLog in the same transaction.
3. Imports never touch inventory without human review; batches reverse precisely.
4. Role + client scoping enforced server-side on every route.
5. The fixtures in [golden-fixtures.md](golden-fixtures.md) keep reproducing.

## Client request tracker — 2026-07 round

From the client's 16-item list after the July check-up.

| # | Request | Status |
|---|---|---|
| 1 | Larger, readable fonts | ✅ Default text size is Large (18 px); per-user override kept |
| 2 | Kitchen "Variance" → "Variance vs sold" | ✅ Renamed across screen, Excel, CSV |
| 3 | Combined bar+kitchen report with beverage/food cost | ✅ Cost Analysis report |
| 4 | View-only 3rd-party access, 15–20 min sessions | ✅ READONLY: 20-min absolute session, view + export only |
| 5 | Can the AI be asked to hack the system? | ℹ️ Answered to client — Stocky has 6 read-only tools, no auth/security surface |
| 6/7 | Per-module login flyers (bar / kitchen) | ⏳ Slots built (`/login?m=bar\|kitchen`); **awaiting client's flyer files** |
| 8 | Promo: tagline, Facebook link, voice/video | ⏳ Landing page live with tagline; **awaiting FB URL + video asset** |
| 9 | Per-user module restrictions (the 5 packages) | ✅ `UserModule` — restricted locations vanish from the switcher and 403 on direct URL |
| 10 | Trans In / Trans Out with cost & retail reports | ✅ Linked transfers + Transfer In/Out reports |
| 11 | Reports: Full **and detailed** | ⚠️ **Open** — Full Audit has row drill-down and rollups, but no explicit Full-vs-Detailed mode. Needs the client to say what "detailed" should contain |
| 12 | Audit clients: view + download only, no manipulation | ✅ Same as #4; screenshot blocking is impossible in a browser — watermark makes captures attributable instead |
| 13 | Main bar → satellite bars + stockroom, one account | ✅ Multi-location + `Location.kind` labels + transfers between them |
| 14 | Quantity inputs numeric-only, with notice | ✅ Shared `QuantityInput` everywhere |
| 15 | Can a user reach another client by editing the URL? | ℹ️ Answered to client — every request passes access-control middleware; verified 403 |
| 16 | Kitchen weighing: total − tare; bottles use the bar formula | ✅ NET weigh mode; density path unchanged for bottles |

## Client request tracker — 2026-07-20 additions (Lourd GC message)

| # | Request | Status |
|---|---|---|
| 17 | Non-revenue encoding options: **Spoilage & Spillages / Trimming / Marketing & OTH (On the House)** — each generates its own report; the Full/Detailed report keeps them under Non-Revenue | ✅ Entry select offers exactly these three; Non-Revenue report + exports gained bucket tabs (`?group=`); legacy reasons fold into the nearest bucket for reporting, Full Audit rollup untouched |
| 18 | Production report **under Sales** ("Input Production") | ✅ Sales report gained a Production view tab (+ export) listing PRODUCTION records at zero revenue |
| 19 | Discounted report under Sales — every input with a discount | ✅ Sales report gained a Discounted view tab (+ export) — SALE rows with `discountPct > 0` |
| 20 | Purchase report: supplier info, contact details, payment terms (C.O.D / 7 / 15 days) | ✅ `Supplier` gained contactPerson / phone / email / address / paymentTerms (migration `20260720181110_supplier_contact_terms`); editable on the Suppliers page; the Purchase report's By-Supplier rollup and all three export formats carry contact + terms. Terms vocabulary: C.O.D., 7/15/30 Days, Prepaid (`@fnb/core PAYMENT_TERMS`) |
| 11 (cont.) | "Full and detailed reports" — formats RECEIVED 2026-07-20: two XLSX examples + an 11-report list | 📋 Answer key captured in [client-report-formats.md](client-report-formats.md) (examples copied to `docs/reference/`). Quick wins shipped (Variance Report entry, NR buckets, Production/Discounted views); the full report suite is the next build phase — four decisions need the client first (averaged cost basis, Cost-of-Sold formula, PDF route, shot/bottle mapping) |

## Client request tracker — 2026-07-21 additions (Lourd GC message)

Five asks. Three built this round; two parked with specs (below).

| # | Request | Status |
|---|---|---|
| A | **Variance highlight** — auto-highlight over/short beyond ~11% of usage, on screen AND in downloads; 1:1 whole-bottle items highlight when over/short by a single unit | ✅ Built. `@fnb/core varianceSeverity(row, thresholdPct)` — the % rule (`\|variance/usage\| ≥ threshold`) applies to any item with usage, PLUS a `\|variance\| ≥ 1` rule for whole-unit (non-content) items — additive, so a −26% kitchen short and a 1-bottle beer short both light up. Material **short = red, over = amber** (richer than the legacy's negative-only red). Drives the Full Audit row tint on screen and a row fill **+ a "Flag" column** in every download (modern + legacy Excel/CSV/PDF). Pure predicate — no reconciliation number moved; golden fixtures re-verified. The threshold is a **per-establishment setting** (`Client.varianceThresholdPct`, default 11) — Settings → *Variance Highlight Threshold*, editable by ADMIN/MANAGER, read-only for viewers; screen + exports all honour it (verified: raising Casa Verde to 30% drops all but the 1-bottle Salmon row). **NOTE:** the client believed this existed in the legacy code; it did not — legacy only reddened *any* negative row by sign. Net-new, built to the client's stated 11% |
| B | **Non-revenue plain input** — allow an untagged/"Other" input alongside the 3 buckets; report breakdown by bucket | ✅ Built. Encode gained an **"Other / Unspecified"** option (still attributable — never a null reason, so nothing vanishes from the audit). The Non-Revenue report's breakdown now rolls up by the **canonical bucket** (Spoilage / Trimming / Marketing-OTH / Other) instead of raw label, so mixed legacy data collapses correctly. Full Audit rollup untouched |
| C | **Sales regular-vs-discounted** breakdown in the Sales report | ✅ Built. A **"By Price Type"** summary (Regular vs Discounted: count / qty / net) plus **Total Discount Given** on screen, and a matching block in the Sales Excel/CSV. Derived from `discountPct > 0` — no schema change, no toggle (the split is automatic). Full Audit revenue stays a single figure |
| D | **3rd-party barcode scanner** — can the system integrate one? | 📋 **Parked — spec below.** Answer for the client: **yes, and there is nothing to "install"** — standard USB/Bluetooth retail scanners are keyboard-wedge HID (they type the code + Enter). All the work is in-app |
| E | **Offline standalone count → upload into office** | 📋 **Parked.** Two parts: (a) offline standalone = the deferred **Electron + local-SQLite** phase (not started); (b) a portable **count export/import** — needs the parked `COUNTS` import kind un-parked (writes `CountSession`/`CountLine` under human review) plus a count-session export. What IS shipped is the adjacent half: full report **view + download** (xlsx/csv/pdf). ⚠️ Do not conflate with the `STANDALONE` **billing** plan — different concept |

### Parked build — 3rd-party barcode scanning (request D)

Build after the current round settles. No legacy precedent (greenfield), and it touches **none** of the sacred reconciliation path.

**Current state (scaffolding only).** A per-variant `barcode` column already exists end-to-end — `@fnb/core` `variantCreate` schema, `ItemVariant.barcode` (Prisma), the master API write path, and the web `ItemVariant` type — but it is surfaced in **no UI** and there is **no barcode lookup** anywhere.

**Scope to build:**
1. **Capture** — add a barcode `<Input>` to the item form (create + edit) so codes can be entered. Keep it **per-variant/per-size** (a 750 ml and a 1 L are different GTINs — a scan must resolve to the exact size).
2. **Uniqueness** — add a `@@unique` on `barcode` (per client scope); block assigning a code already taken.
3. **Resolve** — a barcode→`LocationItem` lookup for the active location (client-side map over the loaded catalog, or `GET …?barcode=`).
4. **Scan-to-add** — a capture input on the count and sales entry screens: on Enter, resolve; if found, reuse the existing combobox `onSelect` to append the line; if not found, **"Unknown barcode — assign to an item?"** → bind the code to an existing item. **Never auto-create items from a scan** (keeps the catalog clean for audit).
5. Works in the current web build (browsers receive keyboard-wedge input natively); Electron-later can add native/serial scanners on top.

Rough size: 1–2 days, front-end-weighted. Open question for the client: unknown-code behaviour (reject vs. assign — recommend assign) is decided above; confirm per-size codes (recommended) is acceptable.

## Open decisions — raise at the next client check-in

1. **Transfers design sign-off.** Transfers have **no legacy precedent** — unlike everything else,
   there is no known-correct answer key. The hand-computed 10-sent/8-received fixture is the only
   correctness check this feature will ever have.
2. ~~**Cost Analysis VAT treatment.**~~ ✅ **RESOLVED 2026-07-20** — client: "Keep the new
   approach. That is most pricely correct." Uniform 12% stays; the VAT cell shows the real VAT
   amount (architecture.md deviation #13 is now confirmed, not provisional).
3. **Request #11** — waiting on the client's sample of the legacy "full detailed" report before
   building a dedicated mode (the new analytics layer may already cover part of it).
4. **Pending assets** — bar/kitchen flyers, Facebook page URL, promo video.
5. **Legacy non-revenue reasons** (Staff use / Internal use / Other on historical rows) ✅ **RESOLVED
   2026-07-21** — the report breakdown now folds every unmapped reason into an **"Other / Unspecified"**
   bucket (which is also a first-class encode option now, per request B), so nothing sits outside the
   breakdown. Filtering the Non-Revenue report *to* the Other bucket is not yet wired (the breakdown
   surfaces it, the unfiltered list shows the entries) — add if the client asks.
6. **Inventory cost basis** ✅ **RESOLVED 2026-07-20** — client asked for both options; shipped as a
   per-client saved policy (Settings → Inventory Cost Basis), default *Purchase Price*. Tell each
   client's accountant to nominate one: PAS 2 expects a single formula applied consistently, and
   switching restates every valuation figure (logged with old → new). Valuation only — variance is
   basis-independent by construction (architecture.md deviations #21–23).
