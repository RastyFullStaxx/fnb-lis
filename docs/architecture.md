# FNB/LIS — Architecture

Companion docs: [project-overview.md](project-overview.md) (start here) · [PRODUCT.md](PRODUCT.md) (what/why) · [DESIGN.md](DESIGN.md) (look/feel) · [golden-fixtures.md](golden-fixtures.md) (the sacred numbers) · [build-log.md](build-log.md) (what shipped when).

## 1. Shape of the system

npm-workspaces monorepo, three packages, TypeScript everywhere, ESM everywhere:

```
fnb-lis/
├─ apps/web        Vite + React 19 + Tailwind v4 + shadcn/ui + React Router v7 (library mode)
│                  TanStack Query v5 · react-hook-form + zod · Recharts · Geist
├─ apps/server     Hono + @hono/node-server (port 3001) · Prisma 6 · SQLite (data/fnb.db)
└─ packages/core   @fnb/core — pure TS domain logic, exported as SOURCE (no build step):
                   zod schemas/DTOs · units · weighing · reconciliation · pricing · rounding · csv · constants
```

- **Dev**: `npm run dev` at root (concurrently) → Vite on 5173 proxying `/api` → Hono on 3001 (same-origin cookies, no CORS). XAMPP's Apache/MySQL (80/3306) are untouched.
- **Prod (initial single-machine)**: Hono serves `apps/web/dist` statically; one Node process; SQLite in WAL mode.
- **Desktop later**: Electron shell embeds the same Hono app + SQLite locally, reuses `@fnb/core` and the SPA verbatim. It is a **local mirror**, not a write buffer, and the server-side half is already built — see **[sync-and-data-lifecycle.md](sync-and-data-lifecycle.md)** for the ownership table, the two flows, and the retention/backup policy.

Why not Next.js/NestJS: one rendering runtime and one tiny API framework keep the desktop path trivial (static SPA + embeddable Node server) and the codebase learnable; NestJS ceremony buys nothing at this team size.

## 2. Data layer

Prisma 6 + SQLite. **Portability rules (load-bearing, do not violate):**

| Rule | Reason |
|---|---|
| No Prisma `enum` — `String` + zod unions in core | SQLite connector rejects enums; strings keep Postgres migration trivial |
| No `Json` scalar — `String` TEXT + zod parse at boundary | Unsupported on SQLite connector |
| `Float`, not `Decimal` | Legacy math is PHP IEEE doubles; parity target — all rounding is explicit via `phpRound` |
| Business dates are `String` `'YYYY-MM-DD'` | Machine is UTC+8; DateTime invites off-by-one-day; lexicographic compare gives half-open windows for free. Timestamps (`createdAt`…) stay `DateTime` |
| Boot pragmas: `journal_mode=WAL`, `busy_timeout=5000` | Concurrency sanity; single Node process only |

### Model inventory (33)

- **Identity**: `User` (role, scrypt hash, lockout counters) · `AuthSession` (tokenHash; per-role TTL — READONLY 20-min absolute) · `Client` · `Location` (kind MAIN|SATELLITE|STOCKROOM label) · `UserClientAccess` (@@id user+client; ADMIN bypasses) · `UserModule` (per-user BAR|KITCHEN|ASSET restriction; no rows = unrestricted)
- **Subscription**: `Subscription` (packageType derived from billingCycle+maxEntities; paid/lastPaidAt with compute-on-load access state in `@fnb/core/billing`) · `SubscriptionModule` (client ceiling) · `LocationModule` (per-location enforced subset, Fix Plan §2.3)
- **Master**: `Unit` (kind VOLUME|MASS|COUNT, factorToBase → ml|g|1) · `Category` (productType string, defaultDensityFactor) · `Item` · `ItemVariant` (size+unit, **contentTracked**, **weighMode DENSITY|NET**, tareWeight, densityFactor override, **brand/model** — Asset-only, nullable; @@unique(itemId,size,unitId))
- **Per-location**: `LocationItem` (cost, retail, parLevel; **assetCode** (unique, Asset-only) · **initialCost**, **serialNo**, **condition**, **status**, **remarks** — Asset-only, nullable; @@unique(location,variant)) · `Supplier` · `ItemAlias` (normalized, @@unique(client,alias)) — import mapping memory
- **Transactions** (immutability pattern below): `CountSession`+`CountLine` (FULL qty | WEIGH scale/tare/factor → remainingContent; **cost+retail snapshots**) · `Purchase`+`PurchaseLine` (DRAFT→COMMITTED) · `SaleRecord` (kind SALE|NON_REVENUE|PRODUCTION; item XOR menu; **recipeVersionId snapshot**; contentOverride only on NON_REVENUE) · `Forfeit` (weighed content re-entering stock) · `Transfer`+`TransferLine`+`TransferReceiptLine` (linked two-location movement: source dispatches on businessDate, destination confirms on receiptDate; same-client tenant guard; receipts void before lines)
- **Recipes**: `MenuItem` · `RecipeVersion` (immutable, versionNo, srp, costAtPublish) · `RecipeLine`
- **Imports**: `ImportBatch` (sha256, extractor DETERMINISTIC|AI, status …|COMMITTED|REVERSED) · `ImportRow` (rawJson, match method+confidence, resultType/resultId backlink → precise reversal)
- **System**: `ActivityLog` (append-only, detailsJson TEXT) · `Setting` (clientId?+key; holds `productTypes` list — product types are data, not schema)

### Immutability ("ledgered records")

Committed records are never mutated: server rejects edits; the UI offers **Void** (reason required) and **Correct** (creates a replacement linked via `correctionOfId`). Drafts (`OPEN` count sessions, `DRAFT` purchases) are freely editable. Every mutation writes its `ActivityLog` row **inside the same `prisma.$transaction`**. This satisfies the proposal's compensating-events guarantee without a parallel event store; a desktop-phase sync outbox can be layered on without re-architecture.

## 3. `@fnb/core` — the domain engine

Pure TS, no I/O, no Prisma imports. The server assembles inputs from the DB; the web app calls the **same functions** for live previews (weigh calculator, recipe cost), so screen math can never disagree with report math.

- `rounding.ts` — `phpRound(v, p)` half-away-from-zero (PHP `round(-2.5) = -3`, JS `Math.round(-2.5) = -2`; negative variances make this load-bearing). No `toFixed`/`Math.round` in domain code.
- `units.ts` — `toBase`, `convert` (throws on kind mismatch), `formatQty`.
- `weighing.ts` — `remainingContent({scale, tare, densityFactor})`; `validateWeigh` → `SCALE_BELOW_TARE` (blocking, legacy behavior) / `CONTENT_EXCEEDS_SIZE` (warning); `resolveDensityFactor(variant, categoryDefault)`; `openEquivalent(content, size, contentTracked)`; `netWeight({scale, tare})` + `validateNetWeigh` — kitchen NET mode (phase 9, deviation #15).
- `billing.ts` — subscription access-state derivation (`currentPeriod`, `deriveAccessState`, `daysUntilDue`); pure, `now` injected; single source shared by server routes and the web client (deviation #17).
- `cost-analysis.ts` — `VAT_RATE`, `netOfVat`, `costLine(B, P, E)`, `pctOf` — legacy `*_downloadCA` formulas (deviations #13/#14).
- `reconciliation.ts` — `reconcile(items: ReconItemInput[], period)` → rows + category groups + grand totals. The crown jewel; formulas in §6.
- `pricing.ts` — cost basis `end-count snapshot → begin-count snapshot → current LocationItem.cost`; `saleRevenue`, `menuRevenueShare`, `recipeCost`.
- `schemas/` — zod: entity shapes, API DTOs, and the AI-extraction output schema (shared with the Anthropic structured-output call).
- `constants.ts` — roles, statuses, kinds, the permission matrix.
- `csv.ts` — RFC-4180 emit/parse helpers.

## 4. API

REST + `@hono/zod-validator`; core schemas are the contract (reused by Electron later — deliberately **not** Hono RPC to avoid coupling web builds to the server type tree).

```
/api/auth                 login · logout · me (user + accessible clients/locations + {aiEnabled})
/api/admin                clients · locations · users · access        (ADMIN)
/api/master               units · categories · items · variants · product-types
/api/locations/:locationId/
   location-items         list/attach/price-edit · copy-from/:otherLocation
   suppliers · stock      on-hand = last committed count + committed activity since (computed, not cached)
   counts                 sessions · lines · commit · void · correct
   purchases · forfeits · sales · menus(+versions)
   imports                upload · rows review · commit · reverse
   reports                full-audit · sales · purchases · non-revenue · on-hand  (+ /export .xlsx|.csv)
/api/activity · /api/settings
```

Middleware chain: `session` → `requireAuth` → `requireLocationAccess` (location→client→`UserClientAccess`, ADMIN bypass) → `requireRole(...)`. Origin-check on non-GET (CSRF). Auth: cookie sessions (256-bit token, SHA-256 stored, SameSite=Lax, 7-day sliding), scrypt (N=16384,r=8,p=1) via `node:crypto`, legacy lockout ported (5 fails → 1 h).

Role matrix: ADMIN all · MANAGER ops+prices+menus+imports+void/correct (assigned clients) · STAFF create/commit entries, no void/prices/imports-commit · ACCOUNTANT read+reports+exports · READONLY read/print.

## 5. Frontend

URL carries tenancy: `/l/:locationId/...` (the modern `?bta-client=`). Shell = shadcn Sidebar (Dashboard, Stock, Counts, Purchases ▸ Forfeits tab, Sales ▸ Non-Revenue/Production tabs, Recipes, Imports, Reports, Items, Suppliers, Settings; ADMIN: Clients, Users, Activity) + topbar switcher + Ctrl+K palette + Sonner. TanStack Query owns server state (no Redux); react-hook-form+zod owns forms; signature screens and interaction rules live in [DESIGN.md](DESIGN.md).

## 6. Formula appendix (verified against legacy PHP — reproduce EXACTLY)

Sources: `fnb-main/application/modules/reports/views/beverage_fullaudit.php:117-195`, `client/models/clientmodel.php:97-166`, `auditbottles/views/openbottle.php:202-220`.

```
openEquiv(content, size, contentTracked) = contentTracked ? content / size : content

usage = (beginFull + openEquiv(beginOpenContent))
      + purchasedQty
      + openEquiv(forfeitContent) + forfeitCountQty          // forfeits ADD BACK (returned bottles)
      + transferInQty − transferOutQty                       // phase 9: received joins the pool, dispatched leaves it (0 when absent)
      − (endFull + openEquiv(endOpenContent))

weigh: remainingContent = phpRound((scaleWeight − tareWeight) × densityFactor)   // integer ml
       densityFactor = variant.densityFactor ?? category.defaultDensityFactor
       block when scaleWeight < tareWeight; warn when content > variant size

recipe consumption per ingredient = contentTracked ? (serving / size) × qtySold
                                                   : serving × qtySold

menu revenue per ingredient = ((serving / menuTotalServing) × menuSrp) × qtySold
       − ((menuSrp × discountPct/100) / ingredientCount) × qtySold
       where menuTotalServing = Σ servings of ALL lines in the SNAPSHOTTED recipe version

direct revenue = Σ unitPrice × qty                            // SALE, item lines
non-revenue direct qty: rows with contentOverride > 0 are EXCLUDED from qty sums
non-revenue content path per row = (contentPerUnit / size) × qty
       contentPerUnit = contentOverride > 0 ? contentOverride : recipeServing

variance      = (directSalesQty + Σ menuConsumption + nonRevenue + productionQty) − usage
variancePct   = usage > 0 ? variance / usage × 100 : null
varianceCost  = variance × costBasis        varianceRetail = variance × retail
usageCost     = usage × costBasis
beginCost/endCost = (full + openEquiv) × snapshot unit cost of that count

Date semantics: counts read ON beginDate and ON endDate (committed sessions only);
activity (purchases, sales, forfeits) in HALF-OPEN [beginDate, endDate).
Legacy quirk normalized: legacy used BETWEEN begin AND end−1day for purchases/sales
but BETWEEN begin AND end for forfeits — we use [begin, end) uniformly (documented in UI).
```

Category density defaults seeded from legacy `fnb.sql`: Vodka 30.12 · Rum 30.49 · Whisky 30.86 · Gin 30.49 · Brandy 30.30 · Tequila 30.67 · Single Malt 30.12 · Cognac 30.67 · Bourbon 30.86 · Aperitif 28.90 (ml per weight-unit on the oz scale).

## 7. Imports & AI

Pipeline: upload (sha256, stored under `apps/server/data/uploads/`) → parse: CSV via papaparse / XLSX via exceljs / **PDF+image via Anthropic `claude-sonnet-5` structured outputs** (`messages.parse` + `zodOutputFormat(importExtractionResult)`; document/image content blocks) → normalized `ImportRow`s → match exact → alias → fuzzy (normalized Levenshtein, confidence) → human review grid → commit (creates Sale/Purchase records with `resultId` backlinks) → optional one-click **reverse** (voids exactly those records). Manual matches write `ItemAlias` (per-client memory). Entirely env-gated: no `ANTHROPIC_API_KEY` → deterministic paths still work, PDF/image shows a setup notice. AI never mutates inventory — it only fills the staging grid.

## 8. Deviation log (deliberate departures, with reasons)

| # | Deviation | From | Reason |
|---|---|---|---|
| 1 | SQLite (Prisma) instead of PostgreSQL now | Proposal §III | Zero-setup dev/deploy on the single-machine initial scope; mirrors the desktop offline store; schema kept Postgres-portable for the multi-tenant web rollout |
| 2 | `Float` instead of `Decimal` | Typical fintech practice | Legacy parity: PHP doubles produced the numbers the client trusts; rounding centralized in `phpRound` |
| 3 | Ledgered records instead of full event sourcing | Proposal §3.1 wording | Same guarantees (immutability, compensating corrections, full trail) with one source of truth; event/sync outbox arrives with the desktop phase |
| 4 | `PRODUCTION` as an explicit sale kind | Legacy `discount=100` hack | Fragile magic value → typed kind; consumption counted, revenue 0 |
| 5 | Prices snapshotted on every line | Legacy used current `default_cost/retail` | Historical reports must not change when prices change (legacy bug) |
| 6 | Recipe version snapshotted per sale | Legacy re-read current recipe | Report correctness after menu edits |
| 7 | Uniform `[begin, end)` activity window | Legacy mixed `end−1day` / inclusive-end | One rule, explained in the report UI |
| 8 | Web first, Electron later | Proposal's desktop-primary | AGENTS.md directive; core/schemas/SPA architected for reuse |
| 9 | No automated tests during initial build | Proposal §5.4 | AGENTS.md explicit instruction; verification = golden seeded cycle with hand-computed numbers + live checks |
| 10 | PostHog/Sentry deferred to polish phase, env-gated | AGENTS.md tooling list | No keys exist yet; wiring is additive |
| 11 | Inter-location transfers are greenfield (no legacy precedent) | Legacy had no transfer/requisition feature at all | Client reqs #10/#13; correctness rests on the hand-computed 10-sent/8-received fixture in golden-fixtures.md §2 — flag for client sign-off before first live use |
| 12 | Transfer window semantics: out on `businessDate` (source), in on `receiptDate` (destination) | — | Sent-vs-received gaps stay visible as the difference between the two locations' Transfer reports; that visibility is the audit point |
| 13 | Cost Analysis uses 1.12 (12% VAT) uniformly; VAT row shows the amount | Legacy `food_downloadCA` divided some always-zero rows by 1.22 and put net-sales in the "VAT" cell | Dead cells and a mislabel, not formulas to preserve; under uniform 1.12, NET % ≡ GROSS % (legacy's differed only via the 1.22 quirk). Confirm with LIS before first client delivery |
| 14 | CA revenue allocated per recipe share across product types | Legacy dumped a menu's whole gross into its own module's report | The CA now cross-foots exactly with the Full Audit revenue column for the same window |
| 15 | Kitchen NET weigh mode (`weighMode=NET`: qty = scale − tare, converted to the counting unit) | Legacy weighed only density-tracked bottles | Client req #16; DENSITY path untouched; NET rows are not content-tracked so reconciliation is structurally unchanged |
| 16 | Per-role session TTL: READONLY 20-min absolute, others 7-day sliding | Single global TTL | Client reqs #4/#12 (3rd-party audit-service viewers); report screens watermark the viewer's name, exports carry an "Exported by" footer |
| 17 | Billing paid-state window = current period `[due, nextDue)` only | JjByteX's fix accepted `[prevDue, nextDue+EOD]` (~2 months) | One payment must never mark two months paid; logic hoisted to `@fnb/core/billing` (shared server+web), month-adds are calendar-true (no `+32 days`) |
| 18 | Trends rollups (`GET …/dashboard/trends`, `services/trends.ts`) re-run `buildFullAudit` per period instead of storing aggregates | — | No second source of truth for the sacred math: every charted number is the same one the Full Audit shows for that window. Serial, capped at 12 periods (~8 queries each); revisit with a cache only if a location's history makes it slow |
| 19 | Cross-tenant location probes return 404, not 403 | Middleware originally threw 403 "No access to this client" | Another client's location must be indistinguishable from a nonexistent one (existence oracle); matches the transfers tenant-guard convention |
| 20 | Listing reports default to the open period (last count → today) | First seed was first→last count date (whole history), then briefly the last closed period | The whole ledger on first paint is slow and overwhelming; the last *closed* period hides everything entered since the last count. The open period always shows the newest entries; count-anchored reports (Full Audit, CA) keep their closed-period defaults |
| 21 | Inventory cost basis is a per-CLIENT saved policy (`Client.costBasis`: PRICE \| AVERAGE), never a query param | Client asked for "an option na with averaging at no averaging" | PAS 2 / IAS 2 permit FIFO or weighted average but require ONE formula applied consistently to inventories of similar nature; a per-export button would let two people produce different totals for the same report. Default `PRICE` = the count-line snapshot cost. The Full Audit and the golden fixtures are unchanged. **The Beginning/Ending Cost reports DO restate** (they briefly shipped valuing stock at the average of purchase lines alone — see #22 — which disagreed with the Full Audit by ~₱110); that restatement is the intended correction, not a regression. Changes write an ActivityLog entry with old → new |
| 22 | The AVERAGE basis is periodic **weighted average cost** — `(opening stock value + purchases value) ÷ (opening + purchased qty)` — not the average purchase price | An earlier build averaged purchase lines only | Averaging purchases alone ignores opening stock: an item with 12.51 opening units and one 6-unit purchase was valued entirely at that purchase's price. Verified: Absolut ₱618.38 (correct) vs ₱615.00 (purchase-only). Opening = the item's earliest committed count at its snapshot cost; consumption never moves a weighted average, only stock-ins do |
| 23 | The cost basis drives VALUATION only — begin/end stock value, on-hand worth, Cost Analysis inputs — and never variance, usage or non-revenue cost | — | An audit finding must have one value. "We lost ₱330" cannot become "₱330 or ₱345 depending on a setting". Enforced in core: `ReconItemInput.begin/endValuationUnitCost` feed `beginCost`/`endCost` alone; `resolveCostBasis` (which drives variance) never reads them. Verified live: switching to AVERAGE moved endCost 16,699.70 → 16,663.61 while varianceCost/varianceRetail/usageCost stayed bit-identical |
| 24 | "Has a variance" is `hasVariance(v)` (`\|v\| > 1e-6`), never `v !== 0` | Exact zero comparison | A weighed quantity is `full + content / size`, and 700 ml is not representable in binary, so a period that reconciles *perfectly* lands on ~1e-16. The Variance Only filter, the Variance Report route and the variance-only export were listing exactly-balanced items as exceptions, displaying "0.00". The smallest human-caused variance is one millilitre (~0.0014 of a 700 ml bottle), three orders of magnitude above the threshold. A filter predicate only — no computed number changes, and the fixtures were re-verified after |
| 25 | Over/short **highlight** is `varianceSeverity(row, thresholdPct)`: material when `\|variancePct\| ≥ thresholdPct` (default 11%) — the **PERCENTAGE** rule for any item with usage — OR `\|variance\| ≥ 1` for **non-content (whole-unit) items** like a bottle of beer (and any item with zero usage). The two triggers are ADDITIVE. Material short → red, over → amber | Legacy reddened *any* negative-variance row by sign (`$short < 0 → "danger"`), no threshold, shorts only | Client req 2026-07-21 ("highlight based on 11% over/short; 1:1 bottle items highlight when off by a bottle"). The client believed a legacy rule existed to port — it did not; this is net-new. A **pure presentation predicate** (sibling of `hasVariance`) — it reads `variance`/`variancePct`/`contentTracked` and changes no reconciliation number, so the sacred math and the fixtures are untouched (re-verified live: Main Bar Jun 1–8 still −₱330.69). Drives the on-screen row tint and, in every download (modern + legacy Excel/CSV/PDF), a row fill plus a "Flag" column (CSV can't carry a colour). NOTE `contentTracked` is **not** a whole-unit discriminator — kitchen NET items are content-tracked=false yet measured continuously (kg/L), and the client's canonical 1:1 item (San Miguel beer) is modelled as `unit="ml"`, not a COUNT unit — hence the additive rule rather than an either/or branch. The threshold is a **per-establishment setting** (`Client.varianceThresholdPct`, migration `20260721072637`, default 11 = `MATERIAL_VARIANCE_PCT`): editable in Settings by ADMIN/MANAGER (`master.write` + client-access), read-only for report viewers; the screen and every export thread the client's value through `varianceSeverity(row, thresholdPct)` (via `ReportMeta.varianceThresholdPct` / `thresholdOf(c)`). Same policy pattern as the cost basis (deviation #21) |
| 26 | Asset fields as nullable additions to `ItemVariant`/`LocationItem`, not a parallel `Asset` model | Earlier draft of `asset-module-proposal.md` | `MODULE_PRODUCT_TYPES.ASSET` and the seeded `Equipment` category already committed Asset to the `Item`/`Category` catalog (Fix Plan Phase E); both client sheets grain at `LocationItem`'s own `[locationId, itemVariantId]` shape; same precedent as #4/#15 (typed field beats parallel structure) |
| 27 | Bottle **tare / liquid weights resolve per LOCATION**: `resolveBottleWeights(locationItem, variant, categoryDefault)` in `packages/core/src/constants.ts` returns the first of `LocationItem.tareWeight/tareWeightUnit/densityFactor` → `ItemVariant.*` → `Category.defaultDensityFactor`, plus a `fromLocal` flag | Weights read straight off `ItemVariant` | Client decision 2026-07-28 ("sila na mag timbang… dapat din makita nila. Since **Local Database** lang naman ang nakikita ni user at hindi whole **Main Database**"). `ItemVariant` is **global** — it has no `clientId`, so a client editing it would silently rewrite every other tenant's weights. The override lives on `LocationItem` (migration `20260727190101`), which is exactly the client's own Local-vs-Main framing. Deliberately placed in `constants.ts`, **not** in sacred `weighing.ts` — it is a *lookup*, not arithmetic, and changes no formula. One resolver feeds the counts route, the live weigh preview, the catalog column, and the CSV export, so no two surfaces can quote different weights. A committed count line snapshots the weights it used, so a later re-weighing can never move a closed period (re-verified: Main Bar Jun 1–8 still −₱330.69 with an override live). Editing is gated on `prices.edit` — the same permission the `PUT /location-items/:id` route enforces — and logs `locationItem.weightChange` with old and new values. This **supersedes** the 2026-07-25 `Client.showBottleWeights` release gate, now removed (column kept: migrations stay additive) |
| 28 | **Report visibility is per-role, and downloads have three independent gates.** Audit-service viewers (`AUDIT_VIEWER`, `AUDIT_VIEWER_LIMITED`) see only `AUDIT_VIEWER_REPORTS` — Full Audit, Full Audit by Category, Usage Cost, Beginning/Ending Cost, Cost Analysis; every other report 404s for them (404 not 403, same convention as the cross-tenant location guard — a report you may never open should look like one that does not exist). Enforced in `routes/reports.ts` middleware, mirrored by the hub filter and the client `RouteGuard`, all reading `canViewReport()` in core so they cannot drift. Downloads are refused by any of: the `reports.export` permission (role), `Client.allowReportDownloads` (LIS admin switch, migration `20260728120000`), or a `VIEW_ONLY` billing state (`middleware/auth.ts` — exports are GETs, so the write test alone missed them). ADMIN bypasses all of it. **The hub filters on a second axis too — module relevance**: a report declaring `requiresProductTypes` is hidden where the location's modules can't satisfy it (Sales by Item "Shot & Bottle", Top Sellers, Cost Analysis, Forfeited Bottles and the Sales *report* need Beverage/Food; the three Asset reports need Asset). The Sales *report* is gated even though the Sales *nav item* deliberately is not (asset-module-phases.md 3.3) — different objects: the page is where an asset write-off is recorded via its Non-revenue tab, the report is about revenue, and an Asset location has none (verified: sales report 0 rows / ₱0 there, while Non-Revenue carries the 7 write-offs / ₱16,280). Section headers render only above ~6 surviving reports; below that the grouping stops earning its space — it exists to make nineteen findable, and an audit viewer was seeing a "Sales & Revenue" heading over one card | Single `reports.view` gate: every role that could open Reports saw all 19 regardless of role, module, or payment, and any of them could download | Client req 2026-07-28: "pwede ko set access nila for viewing and download reports, pero pwede ko din enable na view reports lang sya at disable download reports (if hindi pa bayad)… kay Subscriptions pag hindi pa nag bayad pwede view report lang, no download reports and no manipulation" |
| 29 | **Unit prices display at 3 decimals; money totals stay at 2.** `formatUnitPrice()` (max 3dp) is used for cost/retail per gram·ml·piece — Local Database, On Hand, Purchases, Transfers, Non-Moving, Cost Snapshot — while `formatMoney()` (2dp) keeps every total, including the whole Full Audit, unchanged. Two server-side `round2()` calls on unit prices were removed; their adjacent extended values already multiplied the unrounded source, so no total moved | Every peso figure through `formatMoney` at 2dp | Client req 2026-07-28 ("pwede mag lagay na centavos value sa cost and retail price, lalo na sa grams yun UOM"). Storage was never the limit — `cost`/`retail` are doubles and `2.705` round-trips exactly; only the display truncated, so a per-gram price rendered ₱0.00 and read as unpriced. Legacy stores `decimal(11,3)` and the client's own screenshot shows `1.000`, so 3dp is parity, not invention |
| 30 | **Every route-level screen is permission-gated in ONE place**, `RouteGuard` in `app-shell.tsx`, reading the SAME `permissionForPath()` declarations that build the sidebar; report screens additionally go through `canViewReport()`. Undeclared paths (dashboard, stock) stay open to any signed-in role | The sidebar filtered itself and the router did not, so a READONLY user who typed `/counts/<id>` got the full count editor with Save and Commit enabled and only discovered the 403 on submit | The server was never at risk — 403s verified throughout — but walking an operator to a submit button that cannot work is its own defect. One source for nav and routing means a hidden screen can never still be reachable by URL |
| 31 | **Unique-constraint violations are a 409 with a readable message**, handled centrally in `lib/errors.ts` for any Prisma `P2002`. Reads the offending column from BOTH shapes — `meta.target` (classic engine) and `meta.driverAdapterError.cause.constraint.fields` (the SQLite driver adapter we actually run) | Raw `500 Internal server error` — editing an asset code to one already taken read as "the app is broken" rather than "pick another code" | A value the user typed being already in use is their problem to fix, not a server fault. Central so every current and future unique constraint is covered by one guard |
| 32 | **The seeder is verified against a throwaway database** — `npm run verify:seed -w @fnb/server` (temp file → `migrate deploy` → seed → assert → delete), enabled by `FNB_DB_FILE` in `src/db.ts` and `prisma.config.ts`. Asserts **two** period anchors and 43 coverage checks | Nothing could run the seeder from empty, because `prisma migrate reset` is off-limits — every run was incremental against the dev database | The golden numbers are *produced by* the seed data, so a seeder change can silently invalidate the answer key with nothing to catch it. It found a missing void/correction trail on its first run, then caught a void pair seeded inside a count-anchored period that left June byte-perfect while moving July by ₱1,080 — hence two anchors, not one (golden-fixtures.md §0) |
| 33 | **React Query runs with `networkMode: "always"`, and `AppShell` treats `fetchStatus === "paused"` as a reachability failure before its `isPending` check** — with a **reload** as the recovery action, not `refetch()` | Default `networkMode: "online"`; a paused boot query sits in `status: "pending"` forever, so the shell rendered its skeleton with no error and no way out while the API was down | Symptom fixed; the library behaviour is documented, not explained. Measured on @tanstack/react-query 5.101.2 the `["me"]` query still paused with `networkMode: "always"` applied, `onlineManager.isOnline()` true and `navigator.onLine` true — which its own `canFetch` rule says cannot happen — and stayed paused through an explicit `refetchQueries`. Hence reload: refetch provably does not escape it, so a Try Again wired to it is a dead button |
| 34 | **The offline desktop is a LOCAL MIRROR, and its server half is a whole-location snapshot down + idempotent appends up — no cursor, no tombstones, no push endpoint.** `GET /sync/snapshot` returns the entire location (`?from=` bounds it); the device pushes by replaying the ordinary create routes carrying ids it minted itself. Record identity **is** the idempotency key (`syncFields.id` in `@fnb/core`, enforced by `lib/idempotency.ts`), so there is no token table and no expiry policy for one. Device sessions live a year, are non-sliding, and are revocation-checked on every request | The obvious build is incremental sync: `updatedAt` columns, tombstones, a "changes since X" cursor, a batch push endpoint, and a separate idempotency-key table with its own TTL | Proposal §18 sells the desktop on **"one (1) client computer"** as the **"sole operational interface"** — one writer per establishment, so two-way merge never arises, and the whole cursor apparatus would exist to save a sub-second download of a 1–2 MB location. Reusing the create routes for push means the desktop cannot drift from the browser on validation, permissions or activity logging. Originally rested on "one establishment uses the desktop **or** the browser". **That assumption was retired 2026-07-30** when the client asked for both — see [sync-and-data-lifecycle.md §7](sync-and-data-lifecycle.md), which supersedes it. The design survives because the durable reason it works was never really the single writer: it is that **almost every write here is an append**, so two writers have nothing to merge. The non-append surface is exactly 19 routes (3 draft deletes, 3 draft edits, ~10 status transitions, 3 catalog edits) and §7 closes each. Verified by `npm run verify:sync -w @fnb/server` (45 checks) |
| 35 | **Offline login uses a DEVICE PIN — a second credential that the server never accepts as a login** — and the desktop asserts who is acting via `X-Acting-User`, resolved once in `sessionMiddleware` | Ship `User.passwordHash` in the snapshot and verify the ordinary password locally; let `createdById` come from the device's own session | Shipping the password hash makes theft of one bar PC into remote compromise of the web app — the cracked secret is the *same* secret. A PIN is device-only, so the same theft yields something that unlocks a machine the thief already holds. Guessable PINs are refused by `validatePin` in `@fnb/core`, so the Electron app enforces the identical rule. Recovery is ordered by what actually happens: online reset with your password, then a manager clearing it (`users.manage`), then a self-written recovery question as offline break-glass — rate-limited and logged as `pin.recover`, so it has an alarm on it. Attribution is separate but inseparable: one machine holds ONE session while a whole shift uses it, so without the header every count line would be credited to whoever registered the computer. Resolving it in middleware fixes all 19 `createdById` sites at once AND makes `requirePermission` see the real actor — STAFF still cannot void from an owner's device session. Full rationale in **[sync-and-data-lifecycle.md §5a/§5b](sync-and-data-lifecycle.md)** |
| 36 | **Per-item display unit gets two new server-owned tables, `ClientItemUnitDefault` and `UserItemUnitPreference`, resolved by one pure function `resolveDisplayUnit()` in `@fnb/core`.** Order, most specific first: staff's own override for this item → admin/manager default for this item → staff's general `preferredVolumeUnit`/`preferredMassUnit` → the item's own base unit. Both tables server-only, one-way (server → device, overwrite), same as `LocationItem` | The obvious build is one more field on the existing per-user preference row, or letting the staff override write straight onto the item | `preferredVolumeUnit`/`preferredMassUnit` is one value per user for ALL volume/mass items — there was no per-item axis to hang a second value on without a new table. A per-item admin default sits above the staff's general preference for the same reason `LocationItem` sits above `ItemVariant` (deviation #27): a manager's specific call beats a person's generic setting. Never touches `ItemVariant.unitId`, `convert()`, or `toBase()` — display only, same boundary as the existing unit preference. Client req 2026-07-31 (`docs/per-user-per-item-uom-plan.md`) |

## 9. Security posture

Scrypt password hashing (no plaintext-recoverable encryption like legacy) · hashed session tokens · role + client scoping enforced server-side on every route · Origin-check CSRF guard · zod validation on every mutating body · file-type/size limits on upload (≤ 20 MB pre-base64 for AI; Anthropic hard cap 32 MB) · API keys only in `apps/server/.env` (gitignored) · no PII/inventory values sent to analytics (when later enabled) · ActivityLog captures actor, entity, old/new values for sensitive changes.

**Registered desktops** (deviation #34) hold a **one-year, non-sliding** session — the only long-lived credential in the system. Three things keep that honest: it is issued only against a `Device` row, `Device.status` is re-checked on **every** request (so `POST /admin/devices/:id/revoke` cuts a stolen machine off at its next contact, deleting its sessions in the same transaction), and registration needs `devices.manage` (ADMIN/OWNER) and is capped by `Subscription.maxDevices`. Client-supplied record ids are a trust boundary and are treated as one: shape-checked to the cuid alphabet, and every lookup by one goes through `replay()`, which takes the tenant-ownership predicate as a **required** argument. **`GET /sync/snapshot` is device-sessions-only.** It carries every colleague's PIN and recovery-answer hash, so ordinary location access is not a sufficient gate — a STAFF member or a third-party AUDIT_VIEWER could otherwise pull the establishment's offline credentials and brute-force a 4-digit PIN with no network and no trace. A browser has no use for a snapshot, so the caller is restricted rather than the role narrowed. (Found by adversarial review, Phase 39; the gate was missing when PIN hashes were added in Phase 36.)

The snapshot ships **no password hashes** and must never start: offline login uses a separate device PIN (deviation #35), so the credential that travels to a bar PC is one the server refuses to accept. Recovery answers are normalised then scrypt-hashed, never stored readable, and the recovery path is rate-limited on the same lockout as login and logged as `pin.recover`. See [sync-and-data-lifecycle.md §5a](sync-and-data-lifecycle.md).
