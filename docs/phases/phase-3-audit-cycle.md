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

## Golden fixture (hand-computed; VERIFIED against the engine 2026-07-03)

Seeded at Main Bar, period 2026-06-01 → 2026-06-08. Scale entries in **oz** with legacy oz→ml
density factors. Weigh math: `remaining = phpRound((scale − tare) × density)`.

Seeded events:
- Begin count 06-01: Absolut 12 full + weigh(28.7, 16.9, 30.12)→**355 ml**; JD 8 full + weigh(25.0, 17.2, 30.86)→**241 ml**; San Miguel 48; Tonic 24
- Purchase 06-03 (INV-8841, Metro Beverage): Absolut ×6 @615, San Miguel ×24 @44, Tonic ×12 @30
- Sales: Absolut ×2 + ×1 @1650; San Miguel ×30 @120; JD ×2 @2400; Tonic ×8 @90
- Non-revenue: Absolut ×1 contentOverride **350** (STAFF_USE) → content path only (Nuance A/B); San Miguel ×2 (SPILLAGE)
- Production: Tonic ×4
- Forfeit 06-06: Absolut weigh(25.4, 16.9, 30.12)→**256 ml** re-entering stock (add-back)
- End count 06-08: Absolut 14 full + weigh(22.6)→**172 ml**; JD 6 full + weigh(21.3)→**127 ml**; San Miguel 39; Tonic 23

**Phase 4 extension (2026-07-03):** menu "Vodka Tonic" v1 = 45 ml Absolut 700 + 1 × Tonic 200,
SRP 250, costAtPublish = (45/700)×620 + 30 = 69.857143. Menu sales: ×12 @250, ×2 @250 at 10% off,
1 × NON_REVENUE (STAFF_USE, serving fallback). Tonic end count is 8 (physically consistent with
15 menu bottles consumed). menuTotalServing (mtotal) = 45 + 1 = 46 — legacy sums servings across
lines regardless of unit; reproduced faithfully.

Combined expected report cells (exact; engine matched to 6 dp on 2026-07-03):

| Item | Usage | Sold direct + portion | Revenue | Non-Rev | Prod | Variance | % | Var Cost | Var Retail |
|---|---|---|---|---|---|---|---|---|---|
| Absolut 700 (620/1650) | 4 + 439/700 = **4.627143** | 3 + (45×14)/700 = **0.9** | 4950 + ((45/46)·250·14 − 25) = **8348.913043** | 0.5 + 45/700 = **0.564286** | 0 | **−0.162857** | **−3.5196%** | **−100.9714** | **−268.7143** |
| JD 700 (950/2400) | 2 + 114/700 = **2.162857** | 2 + 0 | **4800** | 0 | 0 | **−0.162857** | **−7.5297%** | **−154.7143** | **−390.8571** |
| San Miguel 330 (45/120) | 48+24−39 = **33** | 30 + 0 | **3600** | 2 | 0 | **−1** | **−3.0303%** | **−45** | **−120** |
| Tonic 200 (30/90) | 24+12−8 = **28** | 8 + **14** | 720 + ((1/46)·250·14 − 25) = **771.086957** | 1 (menu serving) | 4 | **−1** | **−3.5714%** | **−30** | **−90** |

Discount deduction verified: only the ×2 @10% record deducts ((250×0.10)/2)×2 = 25 per ingredient row.
Open equivalents verified: Absolut begin 355/700 = 0.507143, forfeit 256/700 = 0.365714,
end 172/700 = 0.245714; JD begin 241/700 = 0.344286, end 127/700 = 0.181429.
Version immunity verified: publishing Vodka Tonic v2 (different recipe/SRP) leaves this report
byte-identical — sales snapshot their recipeVersionId.

Narrative note: Absolut's raw shortage was −1.127143 before menu sales were recorded (Phase 3
table, superseded); recording the cocktail sales *explained* 0.9 + 0.064286 of it, shrinking the
unexplained variance to −0.162857. That is the product's pitch in one row.

**Re-verify this table after ANY change to packages/core reconciliation/weighing/pricing/rounding.**

## Done when

- Full Audit reproduces every golden number exactly (manual fixture check — no test framework, per AGENTS.md)
- Voiding a committed purchase line changes the report accordingly; correction chains render
- Server rejects edits to committed lines (verified via UI and direct API call)
- Weigh entry blocks scale < tare; warns content > size
