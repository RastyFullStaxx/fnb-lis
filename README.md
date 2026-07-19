# FNB/LIS

Audit-grade inventory platform for bars, kitchens, and any counted stock — a ground-up rebuild of
Liquor Inventory Solution's legacy PHP inventory-audit system.

Its core value is **audit-period reconciliation**: count stock, record activity, count again, and
expose the variance between what *should* have been used and what *was* used, priced at cost and
retail. The client trusts one thing above all — the **Full Audit report**. Its math is sacred.

```
Beginning Count + Purchases + Returned Bottles + Transfers In − Transfers Out − Ending Count = Usage
(Sales + Recipe Consumption + Non-Revenue + Production) − Usage = Variance
```

## Quickstart

```bash
npm install          # from the repo root only (npm workspaces)
npm run db:migrate   # prisma migrate dev — STOP the dev server first (Windows file lock)
npm run db:generate  # regenerate the Prisma client (migrate does NOT do this)
npm run db:seed      # idempotent seed, includes the golden audit fixture
npm run dev          # web on :5173 + server on :3001
```

Seed logins: `admin` · `manager` · `staff` · `accountant` · `readonly` — password `Fnb!2026`.

XAMPP owns ports 80/3306 on the dev machine; don't touch them.

## Layout

| Path | What |
|---|---|
| `apps/web` | Vite · React 19 · Tailwind v4 · shadcn/ui. Routes under `/l/:locationId/*` |
| `apps/server` | Hono + Prisma + SQLite. Routes in `src/routes/`, business logic in `src/services/` |
| `packages/core` | `@fnb/core` — pure TS domain. No I/O, no Prisma imports, no build step |

## Engineering rules

These are not style preferences — breaking one produces wrong numbers or a broken audit trail.

1. **Never change reconciliation math** (`packages/core/reconciliation.ts`, `weighing.ts`,
   `pricing.ts`, `rounding.ts`) without re-verifying [docs/golden-fixtures.md](docs/golden-fixtures.md).
2. **All rounding goes through `phpRound`** (half away from zero). No `Math.round` / `toFixed` in
   domain code — negative variances make this load-bearing.
3. **Committed records are immutable.** Corrections are void + `correctionOfId` chains; every
   mutation writes an ActivityLog row **inside the same `$transaction`**.
4. **SQLite portability:** no Prisma enums, no `Json` scalar, `Float` not `Decimal`, business dates
   as TEXT `YYYY-MM-DD` (never `new Date()` on them in core).
5. **Role + client scoping is enforced server-side on every route**, never in the UI alone.
6. **Imports and AI never mutate inventory without human review.** Stocky gets read-only tools only.
7. **No automated test framework during the initial build** (explicit client instruction) —
   correctness rests on the golden fixtures plus live checks.

## Documentation

Start with **[docs/project-overview.md](docs/project-overview.md)** — status, where everything
lives, and the open client decisions.

| Document | Answers |
|---|---|
| [docs/project-overview.md](docs/project-overview.md) | What is this, what's the status, what's still open |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Personas and user-facing workflows |
| [docs/DESIGN.md](docs/DESIGN.md) | The royal-blue/white design system |
| [docs/architecture.md](docs/architecture.md) | Stack, data model, **formula appendix (§6)**, deviation log |
| [docs/golden-fixtures.md](docs/golden-fixtures.md) | The hand-computed numbers that must never change |
| [docs/build-log.md](docs/build-log.md) | What shipped when, and what the audits found |
| [docs/reference/](docs/reference/) | Legacy-system behaviour (read-only answer key) |
