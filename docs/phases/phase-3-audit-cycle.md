# Phase 3 — The Audit Cycle (earliest complete loop)

**Goal:** The product's heart beats: item → beginning count → purchases/sales/forfeits → ending count → **Full Audit report** that reproduces hand-computed numbers exactly.

## Tasks

- `packages/core`: `reconciliation.ts` (menu arrays accepted but empty until Phase 4) + `pricing.ts`
- Counts: sessions list; **rapid entry screen** (item combobox autofocus → FULL qty or WEIGH scale → live remaining/equivalent preview via core/weighing in the browser → Enter saves + refocuses; "recent entries" panel); commit review step; committed = read-only + line void/correct dialogs
- Purchases: draft editor (header + lines grid, auto line totals) → commit; void/correct
- Forfeits tab (in Purchases): same weigh calculator, labeled "content returning to stock"
- Sales: Tabs Sales / Non-Revenue / Production; quick single-row entry (item combobox, qty, price prefilled from retail, discount; non-revenue adds reason + per-unit content override with plain hint); day list; void/correct
- Report assembly service (half-open `[begin, end)` queries; committed+ACTIVE only) → `/reports/full-audit` → Full Audit page: date pickers constrained to committed count dates, interval explainer, sticky table, negative-variance tint, groupBy category/item
- Stock on-hand endpoint + column (last committed count + activity since)
- Seed v3 — **golden cycle**: begin counts 2026-06-01 (Absolut: 12 full + weigh 812 g/tare 478/density 30.12), purchase 06-03 (6× Absolut @615…), direct sales, non-rev with contentOverride 350, forfeit weigh 690 g, end counts 2026-06-08. **Hand-computed expected numbers below.**
- Git commit

## Golden numbers (hand-computed fixture — the report MUST reproduce these)

To be finalized when seed v3 lands; the worked example for Absolut 700 ml:

```
weigh begin: (812 − 478) × 30.12 = 10,060.08 → phpRound → 10,060 ml → wait: factor is per-oz…
NOTE: scale entries for the golden cycle are entered in grams with a g→ml factor of 0.9478
(1/1.0551 density) OR in oz with factor 30.12 — the seed uses oz to match legacy examples:
begin weigh: scale 28.7 oz, tare 16.9 oz → (28.7 − 16.9) × 30.12 = 355.4 → 355 ml → 355/700 = 0.5071…
```

The exact seed values and every expected report cell (usage, open equivalents, forfeit add-back,
variance, %, cost, retail — per item and per category) are written into this file as part of the
seeding task, then verified against the rendered report **before** the phase is marked done.

## Done when

- Full Audit reproduces every golden number exactly (manual fixture check — no test framework, per AGENTS.md)
- Voiding a committed purchase line changes the report accordingly; correction chains render
- Server rejects edits to committed lines (verified via UI and direct API call)
- Weigh entry blocks scale < tare; warns content > size
