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

After ANY change to the seeder:

```bash
npm run verify:seed -w @fnb/server   # throwaway db: migrate -> seed -> assert -> delete
```

It proves the seed from an EMPTY database — `prisma migrate reset` is off-limits here, so this is
the only way — and asserts the two pinned fixture anchors plus 43 coverage checks. Never touches
`data/fnb.db`.

After ANY change to the sync/idempotency/device paths:

```bash
npm run verify:sync -w @fnb/server    # same throwaway-db harness, 30 checks
```

It drives the real Hono app in-process and proves the guarantees the offline desktop rests on: a
retried push doesn't duplicate, a supplied id can't reach another establishment's rows, a device
session survives a long offline stretch and dies on revocation, and the snapshot carries what a
mirror needs (and no password hashes). See
[docs/sync-and-data-lifecycle.md](docs/sync-and-data-lifecycle.md).

After ANY change to auth, sessions, permissions, or the request edge:

```bash
npm run verify:security -w @fnb/server   # same throwaway-db harness, 119 checks
```

Same in-process approach: hardening headers are really sent, the session cookie's `Secure` flag
follows the transport, login doesn't leak which usernames exist (by message, status, *or* timing),
failed sign-ins hit a per-IP ceiling while successful ones don't, permission guards land on their
own routes and not their neighbours', a password reset kills live sessions, and the tenant/role/
device boundaries hold. Half of it covers two-factor auth: a password alone issues no session, an
unconfirmed enrolment doesn't lift the gate, a challenge can't be replayed, and a recovery code
works once. The last check enumerates **every route the app registers** and probes each one
unauthenticated, so a new endpoint that ships without a guard fails the build. See
[docs/security.md](docs/security.md).

After ANY change to a commit/void status transition, or to a route that mutates the lines of an
OPEN/DRAFT document:

```bash
npm run verify:races -w @fnb/server   # same throwaway-db harness
```

The one guarantee that cannot be read off the code or caught by a golden fixture. Both parents of a
line — count session, purchase, transfer — are held with a conditional self-write
(`holdParentOpen`), and every commit/void is a compare-and-set (`transitionStatus`); see
`src/lib/two-way.ts`. The self-write exists purely to take SQLite's row lock, so it looks removable
to anyone who has not watched it fail. This harness drives the two transactions directly and pins
the interleaving, rather than firing HTTP requests and hoping to land in a sub-millisecond window.

Backups and their drill are scripted — and the drill re-runs the real reconciliation, so it catches
a single altered count line, not just a corrupt file:

```bash
npm run backup -w @fnb/server && npm run restore-drill -w @fnb/server
```

`npm run audit` gates dependencies with reviewed, **expiring** exceptions. CI
(`.github/workflows/ci.yml`) runs typechecks, all three harnesses, the audit gate and gitleaks over
full history on every push. See [docs/security-runbook.md](docs/security-runbook.md).

Seed logins are `ADMIN`/`OWNER`, so **two-factor is required for them** once `FNB_MFA_KEY` is set
(it is, in dev — see `.env`). First sign-in lands on `/account/security` to scan a QR code. Comment
the key out to switch the whole feature off. See [docs/security-mfa.md](docs/security-mfa.md).

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
   correctness rests on the golden fixtures plus live checks. The one exception is
   `npm run verify:seed -w @fnb/server`, which is not a unit-test suite but a guard on the
   fixtures themselves: the golden numbers are *produced by* the seed data, so a seeder change
   can silently invalidate the whole answer key. It asserts **two** period anchors — one is not
   enough, see [docs/golden-fixtures.md §0](docs/golden-fixtures.md).
8. **New seed data goes after the last committed count** (2026-07-20), never inside a
   count-anchored period. Landing inside one moves that period's variance while the golden
   window stays byte-perfect, which is exactly how it hides.
9. **Appends are safe; mutations need a sync decision.** The browser and the offline desktop both
   write. That works because nearly every write here is an INSERT with a globally-unique id, so two
   writers have nothing to merge. Adding an insert route needs no sync thought. Adding a `PUT`, a
   `DELETE`, or a new status transition to a shared table does — the non-append surface is
   deliberately small and enumerated in
   [docs/sync-and-data-lifecycle.md §7](docs/sync-and-data-lifecycle.md). Master data stays
   server-authoritative.

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
| [docs/sync-and-data-lifecycle.md](docs/sync-and-data-lifecycle.md) | Offline desktop mirror: ownership, the two flows, retention/backup |
| [docs/security.md](docs/security.md) | Threat model, audit findings, what's fixed and what's deliberately open |
| [docs/security-runbook.md](docs/security-runbook.md) | Production pre-flight, backup/DR, monitoring, incident response |
| [docs/security-mfa.md](docs/security-mfa.md) | TOTP and other integrations — specified, ready to connect |
| [docs/build-log.md](docs/build-log.md) | What shipped when, and what the audits found |
| [docs/2026-08-02-client-requests-plan.md](docs/2026-08-02-client-requests-plan.md) | Current client notes: what to build, the traps, what's blocked |
| [docs/reference/](docs/reference/) | Legacy-system behaviour (read-only answer key) |
