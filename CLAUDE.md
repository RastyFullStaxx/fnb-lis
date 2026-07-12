# CLAUDE.md — FNB/LIS

Ground-up rebuild of a legacy bar/kitchen inventory-audit system. Web first, Electron later. The client trusts one thing above all: the **Full Audit reconciliation report** — its math is sacred.

## Read before building

- [PRODUCT.md](PRODUCT.md) — what this is, personas, workflows
- [DESIGN.md](DESIGN.md) — royal-blue/white design system; follow it on every screen
- [docs/architecture.md](docs/architecture.md) — stack, domain model, **formula appendix (§6)**, deviation log
- [docs/phases/](docs/phases/) — build order + "done when" gates; work the current phase
- AGENTS.md is the original project brief (kept as-is for reference)

## Skills & tooling — reach for these on every task

Prefer a skill over improvising. Check for a matching skill before starting work, not after.

- **ponytail (minimalism — apply first, always).** Installed at `.agents/skills/ponytail*`. Before writing code, walk the ladder and stop at the first hit: (1) does it need to exist? [YAGNI] (2) already in the codebase? (3) stdlib? (4) native platform feature? (5) an installed dep? (6) a one-liner? (7) only then write the minimum. Never trade away validation, error handling, or security to be shorter. Mark deliberate corner-cuts with a `// ponytail:` comment naming the ceiling + upgrade path (see `apps/server/src/routes/auth.ts`). Sub-skills: `ponytail-review` (audit a diff), `ponytail-audit` (whole tree), `ponytail-debt` (collect the `ponytail:` markers into a ledger), `ponytail-gain`, `ponytail-help`.
- **Installed agent skills** (`.agents/skills/`): `impeccable` for building/polishing product UI, `design-motion-principles` for motion/transition work, `agent-browser` for driving the app in a real browser (QA, dogfooding). The **taste-skill collection** (`taste-skill`, plus `minimalist-skill` / `soft-skill` / `brutalist-skill` style variants, `redesign-skill`, `brandkit`, `stitch-skill`, `image-to-code-skill`, `imagegen-frontend-web|mobile`, `output-skill`, `gpt-tasteskill`) — for landing/marketing pages, **not** dashboards or data tables.
- **shadcn:** component library is set up in `apps/web` (`components.json`, `src/components/ui/`); the Shadcn UI MCP (`mcp__Shadcn_UI__*`) provides component/block/theme lookups. Reuse a shadcn primitive before hand-rolling one (ponytail rung 2/5).
- **Claude's built-in skills:** `verify` before calling a change done, `code-review` / `simplify` on a finished diff, `security-review` on auth/session/import paths, `run` to launch the app, `dataviz` before writing any chart.

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
