# Phase 0 — Blueprint Docs

**Goal:** Lock the product, design, and architecture blueprint before any code, so every later phase (and any future agent/session) builds against the same truth.

## Tasks

- [x] Read all legacy docs, the PDF proposal, the legacy codebase (formulas verified in PHP), and the StockLedger prototype
- [x] `PRODUCT.md` (repo root) — product identity, personas/roles, user-facing workflows, universal-inventory story, multi-client model, promises, non-goals
- [x] `DESIGN.md` (repo root) — royal-blue/white OKLCH tokens, Geist type scale, tabular-nums rule, space/shape/depth, motion rules, signature component patterns, voice, a11y floor
- [x] `docs/architecture.md` — stack, data-layer portability rules, 25-model inventory, immutability pattern, core module list, API surface, **formula appendix**, imports/AI pipeline, **deviation log**, security posture
- [x] `docs/phases/phase-0…8.md` — this series
- [x] Rewrite `docs/fnb_master_implementation_plan.md` as the index tying everything together

## Done when

- All files exist and agree with AGENTS.md priorities (web first, shadcn + royal blue/white, Recharts, no tests during build, Stocky last)
- The formula appendix matches the signatures planned for `packages/core` verbatim
- A developer (or agent) could start Phase 1 from these docs alone
