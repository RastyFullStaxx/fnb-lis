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

Expected report cells (exact fractions; engine output matched to 6 dp):

| Item | Usage | Sold | Non-Rev | Prod | Variance | % | Var Cost | Var Retail |
|---|---|---|---|---|---|---|---|---|
| Absolut 700 (620/1650) | 4 + 439/700 = **4.627143** | 3 (rev 4950) | 350/700 = **0.5** | 0 | −789/700 = **−1.127143** | **−24.3594%** | **−698.8286** | **−1859.7857** |
| JD 700 (950/2400) | 2 + 114/700 = **2.162857** | 2 (rev 4800) | 0 | 0 | −114/700 = **−0.162857** | **−7.5297%** | **−154.7143** | **−390.8571** |
| San Miguel 330 (45/120) | 48+24−39 = **33** | 30 (rev 3600) | 2 | 0 | **−1** | **−3.0303%** | **−45** | **−120** |
| Tonic 200 (30/90) | 24+12−23 = **13** | 8 (rev 720) | 0 | 4 | **−1** | **−7.6923%** | **−30** | **−90** |

Open equivalents verified: Absolut begin 355/700 = 0.507143, forfeit 256/700 = 0.365714,
end 172/700 = 0.245714; JD begin 241/700 = 0.344286, end 127/700 = 0.181429.

**Re-verify this table after ANY change to packages/core reconciliation/weighing/pricing/rounding.**

## Done when

- Full Audit reproduces every golden number exactly (manual fixture check — no test framework, per AGENTS.md)
- Voiding a committed purchase line changes the report accordingly; correction chains render
- Server rejects edits to committed lines (verified via UI and direct API call)
- Weigh entry blocks scale < tare; warns content > size
