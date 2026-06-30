# FNB/LIS Master Implementation Tracker

Last updated: 2026-06-30

This is the living execution document. Update it whenever a task changes
status, evidence is produced, a blocker is found, or an architectural
assumption changes.

## Status and Completion Rules

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete with evidence
- `[!]` Blocked or at risk
- `[?]` Product or architecture decision required

Do not mark a page complete because it renders. Prototype completion requires
routing, permissions, responsive behavior, working primary actions, required
states, deterministic fixtures, accessibility, and tests. Production
completion additionally requires persistence, authorization, tenant
isolation, immutable audit evidence, monitoring, and documentation.

## Current Readiness

| Area | Status |
|---|---|
| Legacy documentation review | Complete |
| Project proposal review | Complete |
| StockLedger reference review | Complete |
| Master architecture | Complete |
| Master tracker | Complete |
| Web workspace | Complete |
| Clickable page catalog | Complete |
| Production API | Not started |
| PostgreSQL schema | Not started |
| Electron/SQLite/sync | Deferred until web stabilization |

## Phase 0 — Plan and Foundation

- [x] `PLAN-001` Review all Markdown files in `docs/`.
- [x] `PLAN-002` Review the complete 16-page project proposal PDF.
- [x] `PLAN-003` Review legacy FNB/LIS modules and calculations.
- [x] `PLAN-004` Review StockLedger navigation, UI, ledger, offline, and Stocky concepts.
- [x] `PLAN-005` Select hybrid journal architecture.
- [x] `PLAN-006` Select web-first delivery and desktop-later boundary.
- [x] `PLAN-007` Define Owner, Staff, and Auditor prototype roles.
- [x] `PLAN-008` Define risk-based approvals.
- [x] `PLAN-009` Create master implementation plan.
- [x] `PLAN-010` Create master implementation tracker.
- [x] `FOUND-001` Create pnpm workspace.
- [x] `FOUND-002` Configure strict TypeScript and path aliases.
- [x] `FOUND-003` Configure Tailwind and design tokens.
- [x] `FOUND-004` Configure Vitest and Testing Library.
- [x] `FOUND-005` Configure Playwright.
- [x] `FOUND-006` Add CI quality workflow.

### Phase 0 pre-mortem

- Failure: the scaffold hard-codes prototype data into page components.
- Warning: pages import fixture arrays directly or calculations occur in JSX.
- Prevention: fixture repositories and pure domain helpers.

## Phase 1 — Shared UX and Application Shell

- [x] `UX-001` Royal-blue design tokens and typography.
- [x] `UX-002` Buttons, badges, cards, inputs, selects, progress, dialogs, and tables.
- [x] `UX-003` Responsive sidebar and top bar.
- [x] `UX-004` Central route and navigation registry.
- [x] `UX-005` Owner, Staff, and Auditor permission matrix.
- [x] `UX-006` Site and role development switcher.
- [x] `UX-007` Command/search surface.
- [x] `UX-008` Notifications and approval indicators.
- [x] `UX-009` Loading, empty, error, forbidden, and not-found patterns.
- [x] `UX-010` Stocky global drawer.

### Phase 1 pre-mortem

- Failure: every module invents a different list and form layout.
- Warning: duplicated filter bars, cards, tables, and modal CSS.
- Prevention: finish shared page, table, form, drawer, and status patterns
  before module-specific polish.

## Phase 2 — Clickable Page Catalog

### Entry and overview

- [x] `PAGE-001` `/login`
- [x] `PAGE-002` `/forgot-password`
- [x] `PAGE-003` `/onboarding`
- [x] `PAGE-004` `/select-site`
- [x] `PAGE-005` `/overview`
- [x] `PAGE-006` `/approvals`
- [x] `PAGE-007` `/approvals/:id`

### Inventory and audit

- [x] `PAGE-010` `/inventory`
- [x] `PAGE-011` `/inventory/items/:id`
- [x] `PAGE-012` `/inventory/actions/new`
- [x] `PAGE-020` `/audits`
- [x] `PAGE-021` `/audits/new`
- [x] `PAGE-022` `/audits/:id`
- [x] `PAGE-023` `/audits/:id/count`
- [x] `PAGE-024` `/audits/:id/review`
- [x] `PAGE-025` `/audits/:id/reconcile`
- [x] `PAGE-026` `/audits/:id/report`

### Purchases, usage, and imports

- [x] `PAGE-030` `/purchases`
- [x] `PAGE-031` `/purchases/new`
- [x] `PAGE-032` `/purchases/:id`
- [x] `PAGE-040` `/usage`
- [x] `PAGE-041` `/usage/new`
- [x] `PAGE-042` `/usage/:id`
- [x] `PAGE-050` `/imports`
- [x] `PAGE-051` `/imports/new`
- [x] `PAGE-052` `/imports/:id/review`
- [x] `PAGE-053` `/imports/:id/mapping`
- [x] `PAGE-054` `/imports/:id/summary`

### Catalog and partners

- [x] `PAGE-060` `/catalog/items`
- [x] `PAGE-061` `/catalog/items/new`
- [x] `PAGE-062` `/catalog/items/:id`
- [x] `PAGE-063` `/catalog/units`
- [x] `PAGE-070` `/recipes`
- [x] `PAGE-071` `/recipes/new`
- [x] `PAGE-072` `/recipes/:id`
- [x] `PAGE-073` `/recipes/:id/versions`
- [x] `PAGE-080` `/suppliers`
- [x] `PAGE-081` `/suppliers/new`
- [x] `PAGE-082` `/suppliers/:id`

### Reports and administration

- [x] `PAGE-090` `/reports`
- [x] `PAGE-091` `/reports/:reportKey`
- [x] `PAGE-100` `/audit-log`
- [x] `PAGE-101` `/audit-log/:id`
- [x] `PAGE-110` `/team`
- [x] `PAGE-111` `/team/roles`
- [x] `PAGE-112` `/team/:id`
- [x] `PAGE-120` `/organization/sites`
- [x] `PAGE-121` `/organization/locations`
- [x] `PAGE-130` `/settings/general`
- [x] `PAGE-131` `/settings/inventory`
- [x] `PAGE-132` `/settings/imports`
- [x] `PAGE-133` `/settings/security`
- [x] `PAGE-134` `/settings/integrations`
- [x] `PAGE-135` `/settings/privacy`
- [x] `PAGE-140` `/stocky`
- [x] `PAGE-150` `/help`
- [x] `PAGE-151` `/help/:article`

### Phase 2 pre-mortem

- Failure: broad page coverage creates shallow placeholder screens.
- Warning: routes contain only headings, generic cards, or dead buttons.
- Prevention: each page needs role context, realistic data, a primary task,
  secondary detail, and required states.

## Phase 3 — Domain Prototype

- [ ] `DOM-001` Decimal-safe quantity representation.
- [ ] `DOM-002` Unit dimensions and compatible conversion.
- [ ] `DOM-003` Package-to-base conversion.
- [ ] `DOM-004` Open-container tare and factor calculation.
- [ ] `DOM-005` Measurement warning and override rules.
- [ ] `DOM-006` Immutable journal batch simulator.
- [ ] `DOM-007` Reversal and replacement simulator.
- [ ] `DOM-008` Balance projection.
- [ ] `DOM-009` Audit boundary calculation.
- [ ] `DOM-010` Physical depletion.
- [ ] `DOM-011` Explained depletion.
- [ ] `DOM-012` Variance and variance value.
- [ ] `DOM-013` Recipe version expansion.
- [ ] `DOM-014` Purchase cost snapshots and period average.
- [ ] `DOM-015` Legacy golden fixtures.

### Phase 3 pre-mortem

- Failure: formulas are duplicated between pages and reports.
- Warning: JSX contains arithmetic for stock, measurements, or variance.
- Prevention: pure domain functions with golden tests.

## Phase 4 — Interactive Workflows

- [ ] `FLOW-001` Start an audit.
- [ ] `FLOW-002` Record full/package counts.
- [ ] `FLOW-003` Record weighed open-container counts.
- [ ] `FLOW-004` Review missing and unusual counts.
- [ ] `FLOW-005` Reconcile and drill into variance sources.
- [ ] `FLOW-006` Approve and close an audit.
- [ ] `FLOW-007` Receive and post a purchase.
- [ ] `FLOW-008` Record direct sale and recipe sale.
- [ ] `FLOW-009` Record non-revenue and waste.
- [ ] `FLOW-010` Upload and stage a sample file.
- [ ] `FLOW-011` Map unmatched import rows.
- [ ] `FLOW-012` Approve and simulate import commit.
- [ ] `FLOW-013` Filter and export-preview reports.
- [ ] `FLOW-014` Approve or reject risky work.
- [ ] `FLOW-015` Ask Stocky fixture-backed questions with source links.

## Phase 5 — Production API and Data

- [ ] `API-001` NestJS application, configuration, health, and OpenAPI.
- [ ] `DATA-001` PostgreSQL and Prisma foundation.
- [ ] `DATA-002` Tenant, site, location, user, role, and permission schema.
- [ ] `SEC-001` Authentication, refresh sessions, password hashing, and CSRF.
- [ ] `SEC-002` Tenant/site enforcement and PostgreSQL RLS.
- [ ] `API-010` Catalog and measurement APIs.
- [ ] `API-020` Journal command and balance query APIs.
- [ ] `API-030` Audit and reconciliation APIs.
- [ ] `API-040` Purchase and supplier APIs.
- [ ] `API-050` Usage, sales, recipe, and production APIs.
- [ ] `API-060` Import staging and commit APIs.
- [ ] `API-070` Report and export APIs.
- [ ] `API-080` Approval and audit-log APIs.
- [ ] `STK-001` Permission-safe Stocky read tools.

## Phase 6 — Desktop and Offline

- [ ] `DESK-001` Secure Electron shell.
- [ ] `DESK-002` Typed and validated IPC bridge.
- [ ] `DESK-003` SQLite schema and migrations.
- [ ] `DESK-004` Local repositories.
- [ ] `DESK-005` Durable outbox.
- [ ] `DESK-006` Idempotent sync batches.
- [ ] `DESK-007` Retry and crash recovery.
- [ ] `DESK-008` Conflict review.
- [ ] `DESK-009` Device trust and OS credential storage.
- [ ] `DESK-010` Packaging, signing, updates, and diagnostics.

### Phase 6 pre-mortem

- Failure: the desktop client confirms work before SQLite persistence.
- Warning: success UI is driven by local component state.
- Prevention: confirmation occurs only after the durable transaction returns.

## Cross-Cutting Quality Gates

- [x] `TEST-001` Measurement and conversion unit tests.
- [x] `TEST-002` Audit and reconciliation golden tests.
- [ ] `TEST-003` Recipe version tests.
- [ ] `TEST-004` Journal reversal and idempotency tests.
- [x] `TEST-005` Component and permission tests.
- [x] `TEST-006` Owner Playwright workflows.
- [ ] `TEST-007` Staff Playwright workflows.
- [x] `TEST-008` Auditor negative-action tests.
- [x] `TEST-009` Desktop and tablet viewport tests.
- [ ] `TEST-010` Import safety fixtures.
- [ ] `TEST-011` Tenant-isolation tests.
- [ ] `TEST-012` PostHog and Sentry privacy payload tests.
- [x] `OPS-001` CI quality checks.
- [ ] `OPS-002` Backup and restore drill.
- [ ] `OPS-003` Deployment and rollback runbook.
- [ ] `OPS-004` Support diagnostic bundle.
- [ ] `OPS-005` User manual and training scenarios.

## Update Log

| Date | Update | Evidence | Next action |
|---|---|---|---|
| 2026-06-30 | Created the master plan and tracker from the legacy code, all local documentation, the 16-page proposal, and StockLedger reference. | `docs/fnb_master_implementation_plan.md` | Complete the clickable web prototype foundation. |
| 2026-06-30 | Implemented the complete role-aware clickable web page catalog and critical prototype workflows. | `apps/web`, unit tests, and six passing desktop/tablet Playwright cases | Validate remaining domain rules and begin the production API foundation. |
