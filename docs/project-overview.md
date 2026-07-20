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

## Status — 2026-07-19

Phases 0–9 complete. The full audit cycle, reports, exports, imports, dashboard, admin, Stocky,
and inter-location transfers are all shipped and verified against hand-computed fixtures.

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
| 11 (cont.) | "Full and detailed reports" — formats RECEIVED 2026-07-20: two XLSX examples + an 11-report list | 📋 Answer key captured in [client-report-formats.md](client-report-formats.md) (examples copied to `docs/reference/`). Quick wins shipped (Variance Report entry, NR buckets, Production/Discounted views); the full report suite is the next build phase — four decisions need the client first (averaged cost basis, Cost-of-Sold formula, PDF route, shot/bottle mapping) |

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
5. **Legacy non-revenue reasons** (Staff use / Internal use / Other on historical rows) sit outside
   the three new buckets by design — confirm with the client whether they should fold somewhere.
6. **Inventory cost basis** ✅ **RESOLVED 2026-07-20** — client asked for both options; shipped as a
   per-client saved policy (Settings → Inventory Cost Basis), default *Purchase Price*. Tell each
   client's accountant to nominate one: PAS 2 expects a single formula applied consistently, and
   switching restates every valuation figure (logged with old → new). Valuation only — variance is
   basis-independent by construction (architecture.md deviations #21–23).
