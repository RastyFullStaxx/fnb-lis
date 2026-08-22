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

## Status — 2026-07-28

Phases 0–9 complete. The full audit cycle, reports, exports, imports, dashboard, admin, Stocky,
and inter-location transfers are all shipped and verified against hand-computed fixtures.

**Asset module shipped** (build-log Phase 17): Brand/Model on the catalog, six per-location detail
fields (Serial No., Condition, Status, Initial Cost, Remarks, Asset Code) editable via a Local
Database dialog, Beginning/Ending counts reusing the existing count-entry screen unchanged, and two
new reports (Asset Register, Asset Inventory) alongside the Asset Breakage report Phase 16 already
shipped. Both implementation calls the proposal left open (`assetCode`'s home; the edit-surface
shape) landed on the plan's own recommended defaults — `LocationItem.assetCode` and a sibling
`Dialog` component — with no open question left behind.

**Client round 4 shipped** (build-log Phases 31–32): report access is now tiered — audit-service
viewers see the reconciliation set only, and downloads are refused by any of three independent
gates (role, the admin's per-client switch, or a past-due subscription). Unit prices display at 3
decimals for per-gram items. Near-duplicate item names are caught at creation. The long-form
surfaces that hid their primary button (recipe builder, item form, and a Transfer receipt dialog
that could not be completed at all) are fixed at the primitives.

**Report access by subscription tier shipped** (client request #3, docs
2026-08-04-report-tier-gating-plan.md / -phases.md): which of the 22 reports a client can even
**see** is now gated by an explicit per-subscription enabled-report set (`SubscriptionReport`), not
by the derived `packageType` label directly — a `maxUsers` bump that silently changes a client's
badge from Medium to Full can no longer silently unlock reports as a side effect. Four tier presets
(Basic/Medium/Full/Standalone) seed the set at subscription creation from the client's approved
checklist; an admin can hand-edit a client's set afterward via a dedicated "Manage Reports" dialog,
and a later tier change never overwrites a hand-edited set. `canViewReportForSubscription()`
composes with the existing role gate (client round 4, above) rather than replacing it — a report
must clear both to be visible — and is enforced in the same three places the role gate already was
(server route middleware, the hub filter, the client route guard), so a tier-blocked report 404s by
direct URL exactly like a role-blocked one. Every subscription that existed before this shipped was
backfilled with its derived tier's preset (`backfill:subscription-reports`); the seeder produces the
rows directly so a from-scratch database never ships with every report gated dark.

**Offline-desktop groundwork shipped** (build-log Phase 35): the server half of the Electron mirror
is done — device registration and revocation, year-long device-bound sessions, idempotent pushes on
every create route, `occurredAt` for device time, and a whole-location snapshot endpoint. The
architecture (a **local mirror**, not a write buffer) and the long-term retention/backup policy are
in [sync-and-data-lifecycle.md](sync-and-data-lifecycle.md).

Offline authentication is settled (§5a): a **device PIN**, a separate credential the server never
accepts as a login — so a stolen bar PC cannot become remote access to the web app. Set from
Settings, recovered online with your password, by a manager, or as a last resort via a self-written
recovery question that is rate-limited and logged. Attribution came with it (§5b): the desktop names
the acting staff member, resolved once in middleware, so permissions and `createdById` both follow
the real person rather than whoever registered the machine. Physical Count Sheets (§3.11) shipped
too — deliberately blind. **Nothing now blocks starting the Electron app** beyond licence
enforcement at startup.

**Verification stance:** no automated test framework (explicit instruction). Correctness rests on
[golden-fixtures.md](golden-fixtures.md) plus live checks. Re-verify the relevant fixture after any
change to `packages/core` or the report services.

Since 2026-07-28 there is one automated guard, and it guards the fixtures rather than the code:
`npm run verify:seed -w @fnb/server` rebuilds the seed in a **throwaway database** and asserts both
pinned anchors plus 43 coverage checks. It exists because the golden numbers are *produced by* the
seed data, so a seeder change could silently invalidate the answer key. **Run it after any seeder
change.** See [golden-fixtures.md §0](golden-fixtures.md).

Since 2026-07-30 there is a second, on the same harness: `npm run verify:sync -w @fnb/server` drives
the real app in-process and asserts the 30 guarantees the offline mirror rests on (no duplicate on
retry, no cross-tenant id reuse, device sessions that outlive an offline stretch and die on
revocation, a complete snapshot carrying no password hashes). **Run it after any change to the
sync, idempotency or device paths.**

## Where things live

| Question | Document |
|---|---|
| Rules I must follow while coding | `CLAUDE.md` (repo root, always loaded) |
| What is this product, who uses it, what are the workflows | [PRODUCT.md](PRODUCT.md) |
| How should a screen look and behave | [DESIGN.md](DESIGN.md) |
| Stack, data model, **formula appendix (§6)**, deviation log | [architecture.md](architecture.md) |
| The numbers that must never change | [golden-fixtures.md](golden-fixtures.md) |
| How the offline desktop shares data, and how data is kept safe long-term | [sync-and-data-lifecycle.md](sync-and-data-lifecycle.md) |
| What shipped when, and what the audit found | [build-log.md](build-log.md) |
| Threat model, security findings, what's fixed vs deliberately open | [security.md](security.md) |
| Going live safely, backups/DR, monitoring, incident response | [security-runbook.md](security-runbook.md) |
| MFA and other integrations — specified, waiting to be connected | [security-mfa.md](security-mfa.md) |
| What the client asked for, and what we did about it | [2026-07-21-client-requests-review.md](2026-07-21-client-requests-review.md) (shipped) · [2026-08-02-client-requests-plan.md](2026-08-02-client-requests-plan.md) (in flight) |
| How the legacy system behaved (answer key) | [reference/](reference/) — read-only |
| Original project brief | Held by the developer, outside this repo. Historical scoping document, superseded by the docs listed above |

## Stack of record

| Layer | Choice |
|---|---|
| Monorepo | npm workspaces: `apps/web`, `apps/server`, `packages/core` |
| Frontend | Vite · React 19 · TypeScript · Tailwind v4 · shadcn/ui · React Router 7 · TanStack Query 5 · react-hook-form + zod · Recharts · Geist |
| Backend | Hono (`@hono/node-server`, :3001) · Prisma 6 · SQLite (WAL) — Postgres-portable schema |
| Domain | `@fnb/core` pure TS (schemas, units, weighing, reconciliation, pricing, billing, cost-analysis, phpRound) |
| AI | `@anthropic-ai/sdk` · `claude-sonnet-5` · structured outputs · env-gated |
| Exports | exceljs (xlsx) · core CSV · print stylesheets |
| Later | Electron + local SQLite **mirror** (server half shipped — see [sync-and-data-lifecycle.md](sync-and-data-lifecycle.md)) · PostHog/Sentry (wired, env-gated) · Playwright (post-build) |

## What must never regress

1. The reconciliation formulas in [architecture.md §6](architecture.md) — verified against the
   legacy PHP line-by-line, including the three nuances (content-override exclusion, per-unit
   content path, total-serving revenue share) and forfeit **add-back** semantics.
2. Committed records are immutable; corrections are visible void/correction chains; every mutation
   logs to ActivityLog in the same transaction.
3. Imports never touch inventory without human review; batches reverse precisely.
4. Role + client scoping enforced server-side on every route.
5. The fixtures in [golden-fixtures.md](golden-fixtures.md) keep reproducing — **both** pinned
   anchors, not just the golden window. New seed data belongs after the last committed count
   (2026-07-20); inside a count-anchored period it moves that period's variance while June stays
   byte-perfect, which is exactly how such a change hides.
6. A screen hidden from the sidebar stays unreachable by URL — nav and routing read the same
   permission declarations (architecture.md deviation **#30**).

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

## Client request tracker — 2026-07-31 additions

| # | Request | Status |
|---|---|---|
| F | **Per-item display unit** — a manager sets a default display unit per item; any staff member can override it for themselves, per item, without affecting anyone else; falls back to the staff member's general unit preference, then the item's own unit | ✅ Built. New server-only, one-way tables `ClientItemUnitDefault` (admin default, `master.write`) and `UserItemUnitPreference` (staff override, own choice) — see [sync-and-data-lifecycle.md §2](sync-and-data-lifecycle.md) and [architecture.md deviation #36](architecture.md). Resolution order implemented as one pure function, `resolveDisplayUnit()` in `@fnb/core`: staff override → admin default → staff's general `preferredVolumeUnit`/`preferredMassUnit` → item's own unit. Routes live in `settings.ts` (admin default gated `master.write`; staff override gated `requireAuth` only). Both pickers added to the Settings page: staff override under "Display" next to the existing volume/mass pickers, admin default under "Establishment settings" next to Inventory Cost Basis and Variance Highlight Threshold. Storage, calculation, reconciliation, weighing, pricing, and rounding are untouched — display only, per [per-user-per-item-uom-plan.md](per-user-per-item-uom-plan.md) |

## Client request tracker — 2026-08-06 additions

| # | Request | Status |
|---|---|---|
| G | **Back-track a revised Final Report** — see the ORIGINAL report beside the revised one to compare | 📋 **Parked — spec below.** Half of it already works: nothing is ever overwritten (void + `correctionOfId` keeps the original line on the document) and every change writes a hash-chained ActivityLog row carrying old→new values. What is missing is a stored copy of the *rendered report*: the Full Audit is recomputed live, so after a revision the earlier numbers exist only as an exported file |
| H | **Variance Report** — pouring short/over 10%, whole items short/over 1 bottle, same for Kitchen and Asset | ✅ **Already built** (request A, 2026-07-21). Both triggers are live and additive, and the % rule runs on every item with usage, so Kitchen and Asset are covered by the same predicate. **Threshold left at 11%** — the client said "10%" on 2026-08-06 but named 11% on 2026-07-21; it is a per-establishment setting (Settings → Variance Highlight Threshold), so changing it is a field edit, not a build. Confirm which number he wants |
| I | **"What-if" re-entry** — regenerate keeping only Beginning and Ending inventory, then enter fresh sales / purchases / non-revenue, for when the client doubts the first data entry | 📋 **Parked — spec below.** The data model already separates counts from transactions and the report recomputes live, so the *shape* works today; what is missing is the fast path (each entry must be voided one at a time) and a sandbox that leaves live data alone |

### Parked build — report snapshots + what-if (requests G & I)

**Build them together.** G needs a stored report and a way to diff two of them; I needs a second
report to diff against the live one. That is the same machinery, so building I after G is mostly
free, and building I *first* would mean building G's diff anyway.

Neither touches `reconciliation.ts`, `weighing.ts`, `pricing.ts` or `rounding.ts`. The golden
fixtures are the gate on every phase.

#### Phase 1 — Report snapshots (request G)

A snapshot is the Full Audit frozen: its parameters, its computed payload, and who froze it.

- **Model `ReportSnapshot`** — `clientId`, `locationId`, `slug`, `paramsJson`, `payloadJson`,
  `takenAt`, `takenById`, `label`, `note`, `supersedesId`. TEXT payloads, not `Json` (portability
  rule §2). Append-only: a snapshot is never edited, and a correction takes a NEW one.
- **Routes** — `POST /reports/full-audit/snapshot` (freeze, ActivityLog in the same
  `$transaction`), `GET …/snapshots` (list), `GET …/snapshots/:id`, `GET …/snapshots/compare?a=&b=`.
- **Diff service** — pure function over two payloads: per-item deltas on begin / end / purchases /
  usage / variance, plus header totals, plus rows that appeared or disappeared. Reuses
  `varianceSeverity` for flagging; adds no math.
- **UI** — a *Save as Final* action on the Full Audit; a **Versions** panel listing snapshots with
  who and when; a compare view (Original | Revised | Δ, changed rows tinted). The Δ view answers
  the client's actual question in one screen.
- **Tie the numbers to the people** — list the ActivityLog entries that fall between the two
  snapshots, so "what changed" shows both the moved figures and the human actions behind them.
  This is the part that makes it an audit answer rather than a spreadsheet diff.
- **Not included:** snapshotting the other 20 reports. Full Audit only — it is the one the client
  calls Final.

#### Phase 2 — Period lock (optional; makes "Final" actually final)

Today there is **no period lock**: anyone with the rights can revise a closed period at any time,
which is why "the Final Report was revised" is possible in the first place. If the client wants
Final to mean locked:

- `PeriodLock` (locationId, begin, end, lockedAt/By, reason) + `assertPeriodOpen(locationId, date)`
  called from every create / correct / void path — ~20 sites, the same shape as the `holdParentOpen`
  work already shipped.
- Unlocking is itself a logged event with a reason, so a reopened period is visible rather than
  silent.
- **Sync note:** the desktop writes too, so the lock has to be enforced server-side on push and
  mirrored to the device — read sync-and-data-lifecycle.md §7.1–7.2 before starting this phase.

#### Phase 3 — What-if scenarios (request I)

The key fact: `buildFullAudit` is **seven queries followed by pure in-memory aggregation**. Split
it and the sandbox falls out without duplicating a single formula.

1. **Refactor** `buildFullAudit` into `loadAuditInputs()` (the seven transactional queries) and
   `assembleFullAudit(inputs)` (everything after). `buildFullAudit` stays as the thin wrapper —
   `stockOnHand` calls it. Catalog metadata and weighted-average costs keep reading live data;
   only the transactional datasets become injectable. `verify:seed` proves the refactor moved
   nothing.
2. **Models** — `Scenario` (locationId, begin, end, name, basedOnSnapshotId, status, createdBy) and
   `ScenarioEntry` (scenarioId, kind SALE / PURCHASE / NON_REVENUE / FORFEIT / TRANSFER,
   locationItemId, businessDate, qty, unitCost, note). Scenario data lives in its own tables and the
   live loader never reads them — so there is no path by which a what-if leaks into a real report.
3. **Flow** — start a scenario from a period; it keeps the committed Beginning and Ending counts
   untouched and starts the middle either **empty** (the client's stated ask) or **seeded from the
   real entries** so he edits rather than retypes. Offer both; seeded will be the one he uses.
4. **Report it** — `assembleFullAudit(live counts + scenario entries)`. Same math, same fixtures,
   clearly badged as a scenario on screen and in every export so it can never be mistaken for the
   real report.
5. **Compare** — Phase 1's diff view, scenario vs live. Free.
6. **Deliberately NOT included: "apply scenario to live."** Promoting a scenario would have to
   void and re-write dozens of committed records in one action; that is the single most dangerous
   button in the product and it should be a separate decision, made after he has used the read-only
   version. Correcting counts already works today via the existing void-and-replace.
- **Sync note:** scenarios are **online-only**, like catalog master data — the desktop reads and
  writes real inventory, not hypotheticals. That keeps them out of the two-way conflict rules
  entirely.

#### Rough sizes

| Phase | Work | Estimate |
|---|---|---|
| 1 | Report snapshots + compare view | **~4 days** |
| 2 | Period lock (optional) | **~2 days** |
| 3 | What-if scenarios (read-only) | **~5 days** |
| — | "Apply scenario to live" (deferred) | +2 days, separate decision |

The client's two questions are answered by **Phases 1 + 3 ≈ 9 days**. That is material new scope
against the current engagement — price it before committing.

#### Decisions needed from the client

1. **Snapshot trigger** — automatic on some "finalise" action, or a manual *Save as Final* the
   auditor presses? (Recommend manual: automatic snapshots on every view produce noise nobody reads.)
2. **Does Final mean locked?** (Phase 2.) If yes, who may reopen a locked period.
3. **Scenario start state** — empty or seeded from the real entries.
4. **Does a scenario ever become real?** (The deferred apply step.) Recommend: not in v1.
5. Variance threshold — 10% or the 11% he specified on 2026-07-21.

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
7. **Report snapshots / what-if (requests G & I, 2026-08-06)** — material new scope (~9 days for the two he asked for). Five sub-decisions and the phase plan are in the parked build above; the pricing call is the client's before any of it starts.
