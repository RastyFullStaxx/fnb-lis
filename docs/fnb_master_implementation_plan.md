# FNB/LIS Master Implementation Plan

Last updated: 2026-06-30

## 1. Product Direction

FNB/LIS will be rebuilt as a universal inventory reconciliation platform. The
legacy system defines the operational truth for audits, open-container
measurement, purchases, usage, recipes, and trusted reports. StockLedger
provides useful interaction, ledger, offline, and Stocky concepts, but neither
reference will be copied screen-for-screen.

The implementation order is web first, desktop second:

1. Validate every important workflow in a clickable web prototype.
2. Implement the production API and PostgreSQL persistence as vertical slices.
3. Stabilize the web system and its report calculations.
4. Package the shared client as a secure Electron application.
5. Add SQLite and idempotent offline synchronization.

The first prototype supports Owner, Staff, and Auditor experiences. Risky
actions use risk-based approval rather than requiring approval for all work.

## 2. Architecture

### 2.1 Workspace

```text
apps/
  web/               Web prototype and future production client
  api/               NestJS modular-monolith API
  desktop/           Future Electron shell
packages/
  ui/                Shared design system
  domain/            Pure calculations and business rules
  contracts/         Shared schemas and API contracts
  client-core/       Repository, cache, outbox, and sync abstractions
  test-data/         Fixtures and legacy parity cases
  config/            Shared tooling configuration
```

Use a pnpm TypeScript workspace without microservices or additional monorepo
orchestration. The web client uses React, React Router, Tailwind CSS,
shadcn/ui-style components, Recharts, React Hook Form, and schema validation.
The API will use NestJS, PostgreSQL, Prisma migrations, and OpenAPI.

### 2.2 Hybrid journal

FNB/LIS will not fully event-source every screen and setting. Business
documents remain normal versioned records with lifecycle states. Posting an
inventory-affecting document atomically creates an immutable journal batch.

```text
Draft business document
→ validation and approval
→ posted document
→ immutable stock journal entries
→ rebuildable balance projection
→ append-only activity audit
```

Posted journal entries are never edited or deleted. User-facing corrections
create a reversal and replacement. This retains audit quality without forcing
ordinary application state through an expensive replay architecture.

### 2.3 Multi-tenancy

The production database starts with a shared PostgreSQL schema:

- Every tenant-owned record has a `tenant_id`.
- Every operational record has explicit site/location scope.
- Repository methods require tenant context.
- PostgreSQL row-level security provides defense in depth.
- Cross-tenant and cross-site access tests are release gates.

A separate database per tenant is deferred until a contractual isolation or
scale requirement justifies its operational cost.

### 2.4 Offline boundary

The web app is not delayed by offline implementation, but it must avoid
browser-specific business logic. UI modules depend on repository interfaces
and pure domain functions.

The later Electron client will add:

- Sandboxed renderer and context isolation
- Narrow, validated IPC contracts
- SQLite business-document and journal cache
- Durable local outbox
- Device identity and OS credential storage
- Idempotent command synchronization
- Human-readable conflict review

## 3. Domain Rules

### 3.1 Items and measurements

An item has one base stock unit and any number of packages. Generic
conversions are valid only within one dimension. Cross-dimension conversions,
such as weight to volume, require an item-specific measurement profile.

API quantities are decimal strings; database calculations use precise numeric
types rather than binary floating point.

Supported count methods:

- Unit count
- Package count
- Net weight
- Direct measurement

Open-container calculation:

```text
net_weight = scale_weight - tare_weight
base_quantity = net_weight × item_conversion_factor
```

The count stores snapshots of the scale reading, tare, factor, capacity, unit,
and rounding rule. Values below tare are rejected. Values above configured
capacity require Owner review and a reason.

### 3.2 Audit boundaries and reconciliation

An audit session uses the previous closed audit as its opening boundary and
the current count cutoff as its ending boundary. Period activity uses a
half-open interval so users do not need to understand the legacy
`ending date - 1 day` convention.

```text
Physical depletion =
  beginning
  + receipts
  + transfers in
  + positive adjustments
  - transfers out
  - ending

Explained depletion =
  direct sales
  + recipe consumption
  + non-revenue
  + waste/forfeit
  + production consumption
  + authorized negative adjustments

Unexplained variance = physical depletion - explained depletion
```

Food and Beverage Full Audit reports become saved filters over one
reconciliation engine. Legacy calculations remain golden test fixtures, but
legacy behavior that is mathematically incorrect must be documented and
approved rather than copied silently.

### 3.3 Historical accuracy

Posted records snapshot all values needed to explain history:

- Recipe version and ingredient quantities
- Unit conversions and measurement profiles
- Purchase and valuation cost
- Item/package identity
- Actor, site, device, business date, and posting timestamp

Changing current catalog data must not rewrite historical reports.

### 3.4 Imports and AI

All uploads enter a staging pipeline:

```text
Upload
→ type and security validation
→ deterministic CSV/XLSX parsing where possible
→ OCR/API extraction only when needed
→ normalized staging rows
→ item and recipe mapping
→ human review
→ Owner approval when required
→ business documents and journal batches
```

Extraction never mutates inventory directly. The original file, extraction
metadata, user corrections, mappings, and commit result remain traceable.

### 3.5 Stocky

Stocky is an assistant, not an autonomous operator. It can:

- Explain workflows and calculations
- Find permitted records and reports
- Summarize audits and import exceptions
- Cite in-app source records
- Prepare drafts or navigate to a workflow

It cannot post, approve, close, reverse, or delete records. Any future write
capability requires a visible draft and explicit confirmation outside chat.

## 4. Modules and Page Architecture

### Daily work

- Overview
- Audits: sessions, setup, count, review, reconcile, final report
- Inventory: on-hand, item details, movements, transfers, adjustments
- Purchases: drafts, receipts, receiving variance, corrections
- Usage & Sales: sales, non-revenue, waste, internal use, production
- Imports: upload, extraction, mapping, review, commit summary

### Analysis and control

- Reports and exports
- Approvals
- Audit log
- Stocky

### Master data and administration

- Items, packages, aliases, prices, and measurement profiles
- Units and conversions
- Recipes and effective versions
- Suppliers
- Sites and locations
- Team and roles
- Inventory, import, security, integration, and privacy settings

The authoritative route and page checklist lives in the master tracker.

## 5. UX and Design System

- Royal blue and white foundation with neutral slate surfaces.
- Semantic green, amber, and red are reserved for status and risk.
- shadcn/ui is the sole component direction.
- Recharts powers necessary charts; reports prioritize tables and source
  drill-down over decorative dashboards.
- Desktop administration and tablet counting are first-class.
- Operational controls use at least 44px touch targets.
- Count sheets support keyboard entry, touch entry, autosave, progress, and
  clear exception states.
- Motion is subtle, functional, short, and disabled by reduced-motion
  preferences.
- Every page supplies loading, empty, populated, validation, forbidden, and
  failure states.
- Internal journal vocabulary remains behind advanced details; users see
  actions such as Receive Purchase, Count Stock, Record Waste, and Correct
  Record.

## 6. Implementation Phases

### Phase 0 — Plan and prototype foundation

- Create master plan and tracker.
- Scaffold workspace, web app, shared UI patterns, fixtures, and CI.
- Define route registry, role matrix, design tokens, and quality gates.

### Phase 1 — Complete clickable page catalog

- Implement the role-aware shell and every planned page.
- Add realistic FNB/LIS fixtures plus non-food inventory examples.
- Implement interactive audit, receiving, usage, import, reporting, approval,
  and Stocky demonstrations.

### Phase 2 — Prototype validation

- Validate formulas against legacy examples.
- Review desktop and tablet workflows.
- Complete accessibility, privacy, and Playwright coverage.
- Lock production acceptance fixtures.

### Phase 3 — Production foundation

- Implement authentication, tenant/site isolation, roles, API contracts,
  PostgreSQL schema, migrations, upload security, and audit logging.

### Phase 4 — Production vertical slices

Implement one end-to-end slice at a time:

1. Catalog and measurement
2. Journal and balance projections
3. Audit and reconciliation
4. Purchases and suppliers
5. Usage, sales, recipes, and production
6. Reports and exports
7. Imports
8. Stocky

Each slice includes UI, API, persistence, authorization, audit evidence,
tests, monitoring, and documentation.

### Phase 5 — Desktop and offline

- Add Electron shell, SQLite, outbox, sync, conflicts, installer, updates, and
  support diagnostics.
- Verify offline work survives restart and synchronizes exactly once.

### Phase 6 — Production rollout

- Backup and restore drills
- Security and tenant-isolation review
- Performance benchmarks
- Sentry and PostHog privacy verification
- Training, deployment runbook, and phased activation

## 7. Testing and Acceptance

Required test layers:

- Unit tests for measurement, units, audit formulas, recipes, costing,
  reversals, and idempotency
- Component tests for forms, permissions, tables, and exceptional states
- Integration tests for posting and journal projection behavior
- Golden fixtures for legacy Food and Beverage Full Audit reports
- Import fixtures for CSV, XLSX, PDF, image, and malformed files
- Playwright tests for all critical Owner, Staff, and Auditor workflows
- Tenant isolation and negative authorization tests
- Privacy tests for PostHog and Sentry payloads

A prototype page is complete only when it is routed, role-aware, responsive,
interactive, state-complete, deterministic, accessible, and tested. A
production feature additionally requires persistence, authorization, tenant
isolation, immutable audit evidence, observability, and operational
documentation.

## 8. Pre-Mortem

| Failure mode | Earliest warning | Prevention |
|---|---|---|
| Generic inventory clone misses the real product | Current-stock pages advance while reconciliation remains vague | Complete the audit vertical slice and golden report tests first |
| Full event sourcing creates unnecessary complexity | Simple edits require replay handlers | Restrict immutability to journal and audit history |
| Flexible units create invalid conversions | Ad hoc conversion conditions appear in UI code | Central dimension-safe domain engine and decimal arithmetic |
| Legacy mistakes are preserved | Forfeit or date results are counterintuitive | Compare legacy fixtures with the documented modern formula |
| Prototype is visually complete but functionally fake | Primary buttons only show toasts | Require fixture-backed interactions and Playwright scenarios |
| AI extraction posts bad inventory | Extraction output bypasses review | Enforce staging-only extraction and explicit approval |
| Sensitive data leaks through roles or monitoring | Costs or names appear in unauthorized views or telemetry | Central policy registry and telemetry allowlists |
| Reports change after catalog edits | Historical outputs use current costs or recipes | Snapshot posted inputs and version recipes |
| Electron requires a rewrite | Pages call HTTP or browser storage directly | Repository boundaries and shared domain packages |
| Tracker becomes stale | Features merge without acceptance evidence | Tracker evidence is part of Definition of Done |

## 9. Defaults

- Product name: FNB/LIS
- Assistant name: Stocky
- Demo locale: English, PHP, Asia/Manila
- Delivery priority: web, then Electron
- Device priority: desktop and tablet
- Active prototype roles: Owner, Staff, Auditor
- Deferred: reseller control plane, billing, mobile app, accounting, and
  historical transaction migration
