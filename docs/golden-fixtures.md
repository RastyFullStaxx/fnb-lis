# Golden fixtures — the answer key

Every number below is **hand-computed**, then verified against the engine. This file is the
regression suite the project deliberately has instead of a test framework (no automated tests
during the initial build, per AGENTS.md).

> **Re-verify the affected fixture after ANY change to `packages/core`** —
> `reconciliation.ts`, `weighing.ts`, `pricing.ts`, `rounding.ts`, `billing.ts`, `cost-analysis.ts`
> — or to `services/report-assembly.ts` / `report-lists.ts` / `exports.ts`.

**How to verify:** `npm run db:seed` (idempotent), then read the numbers off the running app —
Full Audit at `/l/:locationId/reports/full-audit` with the stated dates, or call the service
functions directly with `npx tsx` from `apps/server`. Compare to 6 decimal places.

> **Seeding rule.** `prisma/seed.ts` writes the fixture layer; `prisma/seed-demo.ts` stacks demo
> trading on top of it. Demo data must never land on or before **2026-06-15** at Main Bar or
> Depot — that boundary closes fixtures 1 and 2. Kitchen is free after 2026-06-08; Casa Verde has
> no fixtures. Weighted-average cost values an item from counts at or before the as-of date and
> purchases strictly before it, so later activity cannot move an earlier valuation.
> Re-verified byte-identical after the Phase 13 demo layer landed (2026-07-21), on both bases.

---

## 1. Golden audit cycle — THE sacred fixture

**Location:** Prime Hospitality Group → Main Bar · **Period:** 2026-06-01 → 2026-06-08
Verified 2026-07-03, re-verified 2026-07-19 (byte-identical after the transfer columns landed).

Scale entries in **oz** with legacy oz→ml density factors.
Weigh math: `remaining = phpRound((scale − tare) × density)`.

**Seeded events**

- Begin count 06-01: Absolut 12 full + weigh(28.7, 16.9, 30.12) → **355 ml**; JD 8 full +
  weigh(25.0, 17.2, 30.86) → **241 ml**; San Miguel 48; Tonic 24
- Purchase 06-03 (INV-8841, Metro Beverage): Absolut ×6 @615, San Miguel ×24 @44, Tonic ×12 @30
- Sales: Absolut ×2 + ×1 @1650; San Miguel ×30 @120; JD ×2 @2400; Tonic ×8 @90
- Non-revenue: Absolut ×1 contentOverride **350** (STAFF_USE) → content path only (Nuance A/B);
  San Miguel ×2 (SPILLAGE)
- Production: Tonic ×4
- Forfeit 06-06: Absolut weigh(25.4, 16.9, 30.12) → **256 ml** re-entering stock (add-back)
- End count 06-08: Absolut 14 full + weigh(22.6) → **172 ml**; JD 6 full + weigh(21.3) → **127 ml**;
  San Miguel 39; Tonic 23
- Menu "Vodka Tonic" v1 = 45 ml Absolut 700 + 1 × Tonic 200, SRP 250,
  costAtPublish = (45/700)×620 + 30 = 69.857143. Sales: ×12 @250, ×2 @250 at 10% off,
  1 × NON_REVENUE (STAFF_USE, serving fallback). Tonic end count is 8 (physically consistent with
  15 menu bottles consumed). `menuTotalServing` (legacy `mtotal`) = 45 + 1 = **46** — legacy sums
  servings across lines regardless of unit; reproduced faithfully.

**Expected report cells** (exact; engine matched to 6 dp)

| Item | Usage | Sold direct + portion | Revenue | Non-Rev | Prod | Variance | % | Var Cost | Var Retail |
|---|---|---|---|---|---|---|---|---|---|
| Absolut 700 (620/1650) | 4 + 439/700 = **4.627143** | 3 + (45×14)/700 = **0.9** | 4950 + ((45/46)·250·14 − 25) = **8348.913043** | 0.5 + 45/700 = **0.564286** | 0 | **−0.162857** | **−3.5196%** | **−100.9714** | **−268.7143** |
| JD 700 (950/2400) | 2 + 114/700 = **2.162857** | 2 + 0 | **4800** | 0 | 0 | **−0.162857** | **−7.5297%** | **−154.7143** | **−390.8571** |
| San Miguel 330 (45/120) | 48+24−39 = **33** | 30 + 0 | **3600** | 2 | 0 | **−1** | **−3.0303%** | **−45** | **−120** |
| Tonic 200 (30/90) | 24+12−8 = **28** | 8 + **14** | 720 + ((1/46)·250·14 − 25) = **771.086957** | 1 (menu serving) | 4 | **−1** | **−3.5714%** | **−30** | **−90** |

Grand totals: **−₱330.69** at cost · **−₱869.57** at retail.
Report-level sales cross-checks: gross ₱17,570 / net ₱17,520; purchases ₱5,106 (Metro Beverage);
non-revenue 3 entries, qty 4, ₱710; on-hand ₱16,699.70 cost / ₱43,740.86 retail.

**Also verified**

- Discount deduction: only the ×2 @10% record deducts ((250×0.10)/2)×2 = 25 per ingredient row.
- Open equivalents: Absolut begin 355/700 = 0.507143, forfeit 256/700 = 0.365714,
  end 172/700 = 0.245714; JD begin 241/700 = 0.344286, end 127/700 = 0.181429.
- Version immunity: publishing Vodka Tonic v2 (different recipe/SRP) leaves this report
  byte-identical — sales snapshot their `recipeVersionId`.
- Import reversal restores this report byte-for-byte (variance arrays identical to baseline).

**Why this row is the product's pitch:** Absolut's raw shortage was −1.127143 before menu sales
were recorded; recording the cocktail sales *explained* 0.9 + 0.064286 of it, shrinking the
unexplained variance to −0.162857.

---

## 2. Transfers — 10 sent vs 8 received

**Locations:** Main Bar → Depot (STOCKROOM, same client) · **Period:** 2026-06-08 → 2026-06-15
Verified 2026-07-19. Seeded by `seedTransferFixture()`, dated ≥ 2026-06-10 so fixture 1's window
is untouched.

**Seeded events:** Transfer T-1 businessDate 2026-06-10, San Miguel ×**10** @45 (lineTotal 450),
COMMITTED. Depot receipt: **8** received, receiptDate 06-10, note "2 bottles broken in transit".
Depot sells 1 @120 on 06-12. Closing counts 06-15: Main Bar beer **29** (every other golden item
repeats its 06-08 value), Depot beer **7**. Depot opened with a zero count on 06-08.

| Check | Expected | Why |
|---|---|---|
| Main Bar beer usage | **0** | 39 + 0 + 0 + 0 + 0 − 10 − 29 |
| Main Bar beer transferOut / variance | 10 / **0** | dispatched 06-10; nothing else moved |
| Every other Main Bar item variance | **0** | counts repeated verbatim |
| Depot beer transferIn | **8** | the RECEIVED qty, not the sent 10 |
| Depot beer usage / variance / revenue | **1** / **0** / 120 | 0 + 8 − 7 = 1 = the one sale |
| Transfer Out report (Main Bar) | 10 · ₱450 cost · ₱1,200 retail | 10 × 45 / 10 × 120 |
| Transfer In report (Depot) | 8 · ₱360 cost · ₱960 retail | 8 × 45 / 8 × 120 |
| The missing 2 (₱90 at cost) | appears **nowhere else** | visible only as Out(10) vs In(8) |

That last row is the whole point of the linked design: in-transit loss is neither hidden nor
silently absorbed into either location's variance.

**Guard behaviours** (verified live): cross-client destination → 404 · self-transfer → 400 ·
void with an active receipt → 409 (checked inside the `$transaction`) · duplicate line ids in one
receive → 400 · module-incompatible commit → 400 naming the offending items · a line delete
scoped to another document → 404, line untouched.

---

## 3. Cost Analysis

Legacy `food_downloadCA` / `beverage_downloadCA` formulas. Verified 2026-07-19.

`Cost = Beginning + Purchases + Transfers − Ending` · `Cost Net = Cost ÷ 1.12` ·
`GROSS % = Cost ÷ gross sales` · `NET % = Cost Net ÷ net sales`

**Golden window** [2026-06-01, 2026-06-08), Main Bar, **Beer**:
Beginning 48×45 = 2,160 · Purchases 24×44 = 1,056 · Ending 39×45 = 1,755 →
**Cost 1,461** · Cost Net = 1,304.464286 · GROSS % = 1,461 ÷ 17,520 = **8.3390 %**

Beverage gross sales 17,520 **≡ the Full Audit revenue grand total** — equal by construction, so
the two reports can never disagree. Under a uniform 1.12, NET % ≡ GROSS % (the legacy's columns
differed only via its dead-row 1.22 quirk — see architecture.md deviation #13).

**Transfer window** [2026-06-08, 2026-06-15) — proves transfers are movement, not consumption:
Main Bar Beer: 1,755 + 0 **− 450** − 1,305 = **0** (nothing consumed)
Depot Beer: 0 + 0 **+ 360** − 315 = **45** (exactly the one bottle sold)

---

## 4. Billing access state

`@fnb/core/billing` — period = `[due, nextDue)`; a payment counts only for the period its
timestamp falls in. Verified 2026-07-19 (18 cases).

| Case | Expected |
|---|---|
| Jan-31 anchor, eval Feb 15 | period [Jan 31, **Mar 1**) — short-month rollover |
| Jan-31 anchor, eval Mar 10 | period [Mar 1, Mar 31) |
| Paid on the due date 00:10, eval same period | ACTIVE |
| **Same payment, next period** | **GRACE** — one payment must never cover two months |
| Same payment, next period + 10 days | VIEW_ONLY |
| Paid 3 days late | ACTIVE until that period's next due |
| Never paid, 10 days past due | VIEW_ONLY (no monthly oscillation back to GRACE) |
| Prepaid before startDate (first period) | ACTIVE for period 1 only |
| STANDALONE paid / unpaid | ACTIVE / GRACE (pay once, no time pressure) |
| `daysUntilDue`: 5 days past due · future start · on the due day | −5 · +4 · 0 |

The 4th row is the regression that shipped in `fd8f84b` and was fixed on 2026-07-19: the accepted
window spanned ~2 months, so a single payment displayed the following month as paid.
Related guards: changing `startDate` resets `paid`/`lastPaidAt` (no re-crediting a stale payment
into a re-anchored first period); `mark-paid` is rejected on CANCELLED/SUSPENDED subscriptions.

---

## 5. Kitchen NET weighing

`netQuantity` rounds in **base grams**, then converts to the variant's counting unit — an oz scale
must not quantize kitchen counts to whole ounces.

Example: item counted in kg, weighed on an oz scale, scale 100.9 oz, tare 20.4 oz →
net 80.5 oz → phpRound(80.5 × 28.3495) = phpRound(2282.13) = **2,282 g** → **2.282 kg**.
(Rounding the ounces first would store 2.296 kg — a 14 g error per line.)

NET mode is rejected when the variant is `contentTracked` or its counting unit is not MASS —
both enforced on create and on merged update state.

---

## 6. Top Sellers

Replaces the legacy Graph report. Verified 2026-07-20 against `services/top-sellers.ts`.

**Location:** Prime Hospitality Group → Main Bar · **Window:** 2026-06-01 → 2026-06-08 (inclusive,
same `SaleRecord` base filter as the Sales report — `kind = SALE`, `status = ACTIVE`).

**Seeded events** (layered on top of the golden audit cycle — no new seed data required):

- Direct item sales (same records as fixture 1): Absolut ×3 @1,650; JD ×2 @2,400; San Miguel ×30 @120
- Menu sales `kind = SALE` only (NON_REVENUE is excluded from both menus and ingredient buckets):
  - Vodka Tonic v1 (recipe snapshot: 45 ml Absolut 700 + 1 × Tonic 200): ×12 @250 full price · ×2 @250 at 10% off → **14 total**
  - JD Coke v1 (recipe snapshot: 30 ml JD 700 + 1 × Coke 200, `contentTracked=false`, SRP 200): ×5 @200

**Top Brands** (`locationItemId` set, ranked by qty)

| Rank | Item | Category | Qty | Revenue |
|---|---|---|---|---|
| 1 | San Miguel 330 ml | Beer | 30 | ₱3,600.00 |
| 2 | Absolut 700 ml | Spirits | 3 | ₱4,950.00 |
| 3 | JD 700 ml | Spirits | 2 | ₱4,800.00 |

Revenue = `unitPrice × qty × (1 − discountPct/100)`, same `net` calc as `salesReport()`.
No discount on any direct sale in this fixture → revenue = qty × unitPrice.

**Top Menus** (`menuItemId` set, `locationItemId` null, ranked by qty)

| Rank | Menu | Qty | Revenue |
|---|---|---|---|
| 1 | Vodka Tonic | 14 | ₱3,450.00 |
| 2 | JD Coke | 5 | ₱1,000.00 |

Revenue derivations:
- Vodka Tonic: `12 × 250 × 1.00 + 2 × 250 × 0.90 = 3,000 + 450 = **3,450**`
- JD Coke: `5 × 200 × 1.00 = **1,000**`

**Top Ingredients** (expanded through snapshotted `recipeVersion.lines`, ranked by qty consumed)

| Rank | Ingredient | Category | Qty consumed | Derivation |
|---|---|---|---|---|
| 1 | Tonic 200 ml | Mixer | **14.000000** | `contentTracked=false` → `servingQty × qtySold = 1 × 14` |
| 2 | Coke 200 ml | Mixer | **5.000000** | `contentTracked=false` → `1 × 5` |
| 3 | Absolut 700 ml | Spirits | **0.900000** | `contentTracked=true` → `(45/700) × 14 = 0.9` (exact — 45×14=630, 630/700=0.9) |
| 4 | JD 700 ml | Spirits | **0.214286** | `contentTracked=true` → `(30/700) × 5 = 150/700 = 0.214286` (6 dp) |

`contentTracked` branching — the same formula as `reconciliation.ts` §6:
```
contentTracked = true  →  (servingQty / size) × qtySold
contentTracked = false →  servingQty × qtySold
```

**Guards verified:**
- The 1 × Vodka Tonic `NON_REVENUE` record (STAFF_USE) is absent from all three buckets — `kind = SALE` filter excludes it.
- Absolut's ingredient qty (0.9) is distinct from its brand qty (3) — the two buckets are independent.
- Absolut appears in **both** Top Brands (direct sales) and Top Ingredients (menu expansion) — correct; they are separate aggregations.
- A hypothetical second recipe version published after the sale leaves the fixture byte-identical — ingredient expansion always walks `recipeVersion.lines` (the snapshot), never the menu's current live recipe.
- A menu sale with `recipeVersionId = null` is silently skipped from Top Ingredients and does not throw.

**How to verify:** call `topSellersReport(locationId, '2026-06-01', '2026-06-08')` via
`npx tsx` from `apps/server` against the seeded database, or read the Top Sellers report page
at `/l/:locationId/reports/top-sellers` with these dates.
