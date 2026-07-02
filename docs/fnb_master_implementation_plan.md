# FNB/LIS — Master Implementation Plan

**Status:** Approved and in execution (started 2026-07-02)
**What this is:** The index and contract for the ground-up rebuild of the legacy FNB/LIS system. The detail lives in the linked documents; this file ties them together and records the plan of record.

---

## 1. The mission

Rebuild the legacy PHP/CodeIgniter bar & kitchen inventory-audit system (`C:\xampp\htdocs\fnb-main`) as a modern, universal, audit-grade inventory platform — dramatically faster, cleaner, and easier than the legacy, while reproducing the **audit-period reconciliation math the client trusts, exactly**.

```
Beginning Count + Purchases + Returned Bottles − Ending Count = Usage
(Sales + Recipe Consumption + Non-Revenue + Production) − Usage = Variance
```

Web application first; Electron desktop (offline SQLite + sync) as a later phase that reuses the same core, schemas, and UI.

## 2. The documents

| Document | What it locks down |
|---|---|
| [PRODUCT.md](../PRODUCT.md) | Product identity, personas/roles, user-facing workflows, universality, promises, non-goals |
| [DESIGN.md](../DESIGN.md) | Royal-blue/white design system: tokens, type, motion, signature patterns, voice, a11y |
| [architecture.md](architecture.md) | Stack, data layer + portability rules, 25-model domain, immutability pattern, API, **formula appendix**, imports/AI, **deviation log**, security |
| [phases/phase-0-docs.md](phases/phase-0-docs.md) | This blueprint ✅ |
| [phases/phase-1-foundation.md](phases/phase-1-foundation.md) | Workspaces, schema, core, auth, app shell |
| [phases/phase-2-master-data.md](phases/phase-2-master-data.md) | Items/variants/units/categories + location catalog |
| [phases/phase-3-audit-cycle.md](phases/phase-3-audit-cycle.md) | Counts, purchases, sales, forfeits, **Full Audit v1**, golden fixture |
| [phases/phase-4-recipes-menus.md](phases/phase-4-recipes-menus.md) | Versioned recipes, menu sales, report parity |
| [phases/phase-5-reports-exports.md](phases/phase-5-reports-exports.md) | Report suite, Excel/CSV/print |
| [phases/phase-6-imports-ai.md](phases/phase-6-imports-ai.md) | File ingestion: deterministic + AI, review-before-commit, reversal |
| [phases/phase-7-dashboard-polish.md](phases/phase-7-dashboard-polish.md) | Dashboard, admin, design pass, observability wiring |
| [phases/phase-8-stocky.md](phases/phase-8-stocky.md) | Stocky read-only assistant (**last**, per AGENTS.md) |

Legacy references (read-only): `fnb_legacy_system_documentation.md`, `fnb-workflow.md`, `fnb-database-keys.md`, the project proposal PDF, and the prior rough plan `fnb_modernization_implementation_plan.md` (superseded by this plan).

## 3. Stack of record

| Layer | Choice |
|---|---|
| Monorepo | npm workspaces: `apps/web`, `apps/server`, `packages/core` |
| Frontend | Vite · React 19 · TypeScript · Tailwind v4 · shadcn/ui · React Router 7 (library) · TanStack Query 5 · react-hook-form + zod · Recharts · Geist |
| Backend | Hono (`@hono/node-server`, port 3001) · Prisma 6 · SQLite (WAL) — Postgres-portable schema |
| Domain | `@fnb/core` pure TS (schemas, units, weighing, reconciliation, pricing, phpRound) — shared web/server/future-Electron |
| AI | `@anthropic-ai/sdk` · `claude-sonnet-5` · structured outputs · env-gated |
| Exports | exceljs (xlsx) · core CSV · print stylesheets |
| Later | Electron + local SQLite + sync outbox · PostHog/Sentry (Phase 7, env-gated) · Playwright tests (post-build, per AGENTS.md) |

Key deliberate deviations (full log with reasons in [architecture.md §8](architecture.md)): SQLite now instead of Postgres · Float for legacy parity · ledgered records instead of a parallel event store · PRODUCTION as an explicit kind · **prices and recipe versions snapshotted** (fixes legacy history-drift bugs) · uniform half-open date windows.

## 4. What must never regress

1. The reconciliation formulas in [architecture.md §6](architecture.md) — verified against the legacy PHP line-by-line, including the three nuances (content-override exclusion, per-unit content path, total-serving revenue share) and the forfeit **add-back** semantics.
2. Committed records are immutable; corrections are visible void/correction chains; every mutation logs to ActivityLog in the same transaction.
3. Imports never touch inventory without human review; batches reverse precisely.
4. Role + client scoping enforced server-side on every route.
5. The golden seeded cycle (phase-3 doc) keeps reproducing its hand-computed numbers.

## 5. Verification approach (no automated tests during the build, per AGENTS.md)

- **Golden cycle fixture**: a seeded audit period with every expected report cell hand-computed and documented; re-checked whenever engine code changes
- **Live checks** at each phase's "done when" gates (login per role, weigh math on screen, commit immutability, void→report change, import round-trip + reversal, export totals in Excel)
- A second hand-checked scenario against the legacy formulas before any client demo
- Playwright suites arrive after the build stabilizes (deferred by explicit instruction)

## 6. Delivery order & session cadence

Phases execute in order 0→8; each ends with a git commit. The earliest end-to-end value lands at **Phase 3** (complete audit cycle + Full Audit report). Cross-session continuity is maintained via the project memory (stack decisions, formulas, status) and the task list mirroring the phases.
