# AGENTS.md — FNB/LIS Modernization Planning Guide

You are helping plan the modernization of the FNB/LIS legacy system into a modern, scalable, offline-capable inventory management system. We will name the system the same with the legacy.

Do not start coding yet. First, study the available documentation, legacy codebase, and prototype reference. Then create a complete master implementation plan.

## Main Goal

Create a solid implementation plan for rebuilding the system from the ground up.

The new system should not simply copy the old FNB/LIS workflow. Use the legacy system to understand the business logic, reports, calculations, pain points, and existing modules. Then propose a cleaner, faster, more modern, and more scalable system.

The target system should be:

* Universal, not limited to food and beverage
* Customizable for different product types
* Very user-friendly and fast to use
* Clean, modern, and low-clutter
* Secure and audit-friendly
* Capable of offline desktop use
* Capable of producing reports
* Capable of API-assisted file ingestion for POS, PDF, image, Excel, and CSV files
* Supported by the Stocky chatbot concept from StockLedger

## References to Read

### 1. Legacy System Documentation

```text
C:\xampp\htdocs\fnb-lis\docs\fnb_legacy_system_documentation.md
```

### 2. Additional Legacy Notes

```text
C:\xampp\htdocs\fnb-lis\docs\fnb-database-keys.md
C:\xampp\htdocs\fnb-lis\docs\fnb-workflow.md
```

### 3. Existing Rough Modernization Plan

```text
C:\xampp\htdocs\fnb-lis\docs\fnb_modernization_implementation_plan.md
```

### 4. Project Proposal

```text
C:\xampp\htdocs\fnb-lis\docs\Bar and Kitchen Inventory Management System (Powered by LIS), Online_Offline, Event-Driven Architecture Project Proposal.pdf
```

### 5. Legacy FNB/LIS Codebase

```text
C:\xampp\htdocs\fnb-main
```

### 6. StockLedger Prototype Reference

```text
C:\xampp\htdocs\StockLedger
```

## Important Planning Notes

Use the legacy system as a reference, not as the final workflow.

The new system should improve the old process, reduce manual steps, simplify the user experience, and make inventory work much faster.

Pay special attention to:

* Item/product management
* Custom units of measurement
* Net weight, net content, tare weight, package conversion, and other flexible computation needs
* Stock movement tracking
* Purchases
* Sales/usage
* Physical counts
* Variance and reconciliation
* Reports
* File ingestion through API
* Offline desktop app behavior
* Security, roles, and audit history
* Stocky chatbot assistant

## Required Output

Create a complete Markdown implementation plan.

Save the final plan here:

```text
C:\xampp\htdocs\fnb-lis\docs\fnb_master_implementation_plan.md
```

The plan should be clear enough for developers to follow later, but it should focus on planning, architecture, workflow, modules, phases, and implementation direction.

Do not write production code yet unless specifically asked.

## Codex Superpowers and Build Discipline

Use the available Codex skills and tools to improve the quality of the plan and future implementation, but do not let them make the project unnecessarily complex.

Preferred Codex skills/superpowers:

```text
design-taste-frontend
impeccable
design-motion-principles
agent-browser
ponytail
```

Use these skills as follows:

* `design-taste-frontend` (from Taste Skill) should help make product, UX, and design decisions feel refined, premium, and intentional.
* `impeccable` should help enforce high standards for code quality, planning quality, consistency, correctness, and completeness.
* `design-motion-principles` should guide subtle, useful, non-distracting motion and interaction design.
* `agent-browser` should help inspect the actual running interface when needed, especially for UX review and debugging.
* `ponytail` should enforce implementation restraint: understand the affected flow first, reuse existing code and platform features, avoid speculative abstractions and dependencies, and make the smallest safe change. It must not simplify away validation, security, accessibility, auditability, offline data integrity, or error handling that prevents data loss.

Preferred MCP/tools:

```text
Context7 MCP
Playwright MCP
shadcn MCP
```

Use `Context7 MCP` when current library documentation is needed before implementing or planning around a specific framework, package, or API.

Use `Playwright MCP` when inspecting, testing, or debugging the running app through browser interaction.

Use `shadcn MCP` to search, inspect, and install components from the shadcn registry. Prefer existing project components before adding new ones, review generated code before keeping it, and adapt it to the FNB/LIS design tokens, accessibility requirements, and shared component conventions.

Important rule:

```text
MCPs and superpowers should support better decisions, not introduce unnecessary tools, libraries, or architecture.
```

Select only the minimum relevant skills and tools for each task. Project requirements and this `AGENTS.md` override generic skill or registry recommendations.

## UI and Design System Rules

Use the following as the main UI direction:

```text
shadcn/ui
Tailwind CSS
Royal blue and white main palette
Clean, modern, premium, low-clutter interface
```

Use shadcn/ui as the primary component system. Do not mix multiple design systems unless there is a strong reason.

Charts should default to:

```text
shadcn/ui Charts
Recharts
```

Tremor may be used only as dashboard inspiration or selectively adapted blocks. Do not introduce another charting library unless Recharts cannot support a required visualization.

## Analytics, Monitoring, and Testing

Use:

```text
PostHog
Sentry
Playwright tests
```

PostHog should be used for product analytics, feature flags, and understanding how users interact with the system.

Sentry should be used for errors, crashes, performance issues, sync issues, and production debugging.

Playwright tests should be used for permanent automated testing of critical workflows. Playwright MCP may help inspect the app during development, but it does not replace committed Playwright tests.

Do not send sensitive client data, raw inventory values, prices, supplier names, uploaded file contents, or private business records to analytics or error tracking by default.

## Web First, Desktop Later

The first implementation target should be the web application.

Build and stabilize the web version first, including the core inventory engine, item management, measurement/computation engine, file ingestion workflow, reports, user roles, security, Stocky assistant, and clean UI.

The desktop application is still required, but it should come after the web app is completed and stabilized.

Desktop app direction:

```text
Electron desktop app
Offline-capable
Local storage through SQLite
Sync with backend when online
```

Do not let desktop/offline complexity slow down the first web implementation unless a design decision must be made early to support it later.

The web system should be architected so that the future desktop app can reuse as much logic, UI, validation, and API behavior as possible.

## Final Working Rule

Use all tools, skills, MCPs, and references to create a better system, but the final product must remain simple for the user.

The system should feel dramatically faster, cleaner, and easier than the legacy FNB/LIS system, even if the architecture behind it is more powerful.
