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
- **Desktop later**: Electron shell embeds the same Hono app + SQLite locally, reuses `@fnb/core` and the SPA verbatim; a sync outbox is added then (see deviation log).

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
- **Master**: `Unit` (kind VOLUME|MASS|COUNT, factorToBase → ml|g|1) · `Category` (productType string, defaultDensityFactor) · `Item` · `ItemVariant` (size+unit, **contentTracked**, **weighMode DENSITY|NET**, tareWeight, densityFactor override; @@unique(itemId,size,unitId))
- **Per-location**: `LocationItem` (cost, retail, parLevel; @@unique(location,variant)) · `Supplier` · `ItemAlias` (normalized, @@unique(client,alias)) — import mapping memory
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

## 9. Security posture

Scrypt password hashing (no plaintext-recoverable encryption like legacy) · hashed session tokens · role + client scoping enforced server-side on every route · Origin-check CSRF guard · zod validation on every mutating body · file-type/size limits on upload (≤ 20 MB pre-base64 for AI; Anthropic hard cap 32 MB) · API keys only in `apps/server/.env` (gitignored) · no PII/inventory values sent to analytics (when later enabled) · ActivityLog captures actor, entity, old/new values for sensitive changes.
