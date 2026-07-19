# CLAUDE.md — personal working instructions

Local only, never committed. **Project truth lives in versioned docs** — this file just tells you
how I want you to work, and points at them.

Ground-up rebuild of a legacy bar/kitchen inventory-audit system. Web first, Electron later. The
client trusts one thing above all: the **Full Audit reconciliation report** — its math is sacred.

## Orient yourself first

- **[README.md](README.md)** — quickstart, layout, and the canonical engineering rules
- **[docs/project-overview.md](docs/project-overview.md)** — status, doc map, open client decisions
- **[docs/golden-fixtures.md](docs/golden-fixtures.md)** — the numbers that must never change
- **[docs/architecture.md](docs/architecture.md)** — data model, **formula appendix §6**, deviation log
- [docs/PRODUCT.md](docs/PRODUCT.md) · [docs/DESIGN.md](docs/DESIGN.md) — personas/workflows · design system
- [docs/build-log.md](docs/build-log.md) — what shipped when · [docs/reference/](docs/reference/) — legacy answer key

## Non-negotiables (canonical copy in README.md)

- **Never commit or push.** I do the committing between sessions.
- **Never alter reconciliation math** (`packages/core/reconciliation.ts`, `weighing.ts`,
  `pricing.ts`, `rounding.ts`) without re-verifying the golden fixtures.
- All rounding via `phpRound` — no `Math.round`/`toFixed` in domain code.
- Committed records are immutable: void + `correctionOfId`, and every mutation writes ActivityLog
  **in the same `$transaction`**.
- SQLite portability: no enums, no `Json`, `Float` not Decimal, business dates TEXT `YYYY-MM-DD`.
- Role + client scoping server-side on every route.
- No automated tests during the build — verify via golden fixtures + live checks.
- Imports/AI never mutate inventory without human review; Stocky stays read-only.

## Skills & tooling — reach for these on every task

Prefer a skill over improvising. Check for a matching skill before starting work, not after.

- **ponytail (minimalism — apply first, always).** `.agents/skills/ponytail*`. Before writing code,
  walk the ladder and stop at the first hit: (1) does it need to exist? [YAGNI] (2) already in the
  codebase? (3) stdlib? (4) native platform feature? (5) an installed dep? (6) a one-liner?
  (7) only then write the minimum. Never trade away validation, error handling, or security to be
  shorter. Mark deliberate corner-cuts with a `// ponytail:` comment naming the ceiling + upgrade
  path. Sub-skills: `ponytail-review`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`.
- **Installed agent skills** (`.agents/skills/`): `impeccable` for building/polishing product UI,
  `design-motion-principles` for motion work, `agent-browser` for driving the app in a real browser.
  The **taste-skill collection** is for landing/marketing pages, **not** dashboards or data tables.
- **shadcn:** set up in `apps/web` (`components.json`, `src/components/ui/`); the Shadcn UI MCP
  (`mcp__Shadcn_UI__*`) provides component/block/theme lookups. Reuse a primitive before
  hand-rolling one (ponytail rung 2/5).
- **Built-in skills:** `verify` before calling a change done, `code-review` / `simplify` on a
  finished diff, `security-review` on auth/session/import paths, `run` to launch the app,
  `dataviz` before writing any chart.

## Working habits I expect

- Re-run the relevant golden fixture after touching core math or the report services, and say so.
- Typecheck both workspaces (`npm run typecheck -w @fnb/server` / `-w @fnb/web`) before declaring done.
- Windows dev loop: `prisma migrate dev` does **not** regenerate the client — run `db:generate`
  after. Stop the dev server before migrating, and kill orphan `node` processes if the SQLite file
  stays locked.
- Prefer editing an existing doc over adding a new one; keep docs short enough to stay read.
