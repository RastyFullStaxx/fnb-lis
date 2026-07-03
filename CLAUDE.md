# CLAUDE.md — FNB/LIS

Ground-up rebuild of a legacy bar/kitchen inventory-audit system. Web first, Electron later. The client trusts one thing above all: the **Full Audit reconciliation report** — its math is sacred.

## Read before building

- [PRODUCT.md](PRODUCT.md) — what this is, personas, workflows
- [DESIGN.md](DESIGN.md) — royal-blue/white design system; follow it on every screen
- [docs/architecture.md](docs/architecture.md) — stack, domain model, **formula appendix (§6)**, deviation log
- [docs/phases/](docs/phases/) — build order + "done when" gates; work the current phase
- AGENTS.md is the original project brief (kept as-is for reference)

## Hard rules

- Never commit. I will do the commiting when you're done between each sessions
- **Never alter reconciliation math** (`packages/core/src/reconciliation.ts`, `weighing.ts`, `pricing.ts`, `rounding.ts`) without re-verifying the golden fixture in docs/phases/phase-3-audit-cycle.md
- SQLite portability: no Prisma enums, no `Json` scalar, `Float` not Decimal, business dates as TEXT `YYYY-MM-DD` (never `new Date()` on them in core)
- Committed records are immutable — corrections are void + `correctionOfId` chains; every mutation writes ActivityLog **in the same `$transaction`**
- All rounding through `phpRound` (half away from zero) — no `Math.round`/`toFixed` in domain code
- No automated tests during the initial build (explicit instruction); verify via golden fixture + live checks
- Imports/AI never mutate inventory without human review; Stocky gets read-only tools only

## Commands

```bash
npm run dev          # web (5173) + server (3001), from repo root
npm run db:migrate   # prisma migrate dev (STOP the dev server first — Windows file lock)
npm run db:seed      # idempotent seed
```

Install from repo root only (npm workspaces). XAMPP owns ports 80/3306 — don't touch.

## Layout

`apps/web` (Vite React SPA, routes under `/l/:locationId/*`) · `apps/server` (Hono + Prisma, routes in `src/routes/`) · `packages/core` (`@fnb/core`, pure TS source — no build step, no I/O, no Prisma imports)

Seed logins: `admin` / `manager` / `staff` / `accountant` / `readonly`, password `Fnb!2026`.
