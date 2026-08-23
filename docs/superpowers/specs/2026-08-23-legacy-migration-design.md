# Legacy data migration — design

**Status:** approved 2026-08-23 · **Supersedes:** nothing · **Blocks:** production go-live

Migrating the legacy FnB/LIS PHP + MySQL system's records into the rebuild, for a client who
wants his history present in the system he is about to start using.

Related: [architecture.md §6](../../architecture.md) (formula appendix) ·
[golden-fixtures.md](../../golden-fixtures.md) ·
[security-runbook.md §0–§1](../../security-runbook.md) ·
[reference/legacy-db-keys.md](../../reference/legacy-db-keys.md)

---

## 1. Goal and non-goal

**Goal.** The client's legacy records exist inside the new system — browsable, reportable for the
periods they belong to — and the new system is operationally usable from day one.

**Non-goal.** Reproducing legacy stock levels as *current* inventory. The most recent legacy count
for five of six branches is from 2023; carrying that forward as today's opening balance would make
the first Full Audit confidently wrong on the one report this client trusts absolutely.

These two are separable, and separating them is the core of this design. History imports at its
**true dates**; current stock comes from a **fresh physical count at go-live**, which becomes the
anchor for live operation. The 2023 → 2026 gap is real and stays visible. A Full Audit spanning it
reports the gap as variance, which is the truthful answer to "what happened in three years with no
records".

### Decisions taken

| | Decision |
|---|---|
| Scope of data | Master data live; historical transactions imported at true legacy dates |
| Opening stock | Fresh physical count per venue at go-live — **not** imported |
| Establishments | Six branches with real data; Mansion 73 + 74 merged as one venue |
| Tenancy | **Three Clients, five Locations** (§5) |
| Source of truth | `C:\xampp\htdocs\fnb-main\fnb.sql`, 48,322 rows, dumped 2026-06-26 |

---

## 2. Blocker: production has no reference data

`prisma/seed.ts:1489` runs `seedUsers`, `seedUnits`, `seedCategories` and `seedSettings` inside the
same `main()` as every demo fixture. No other path creates them.

`security-runbook.md §1` correctly forbids `db:seed` in production. **Therefore a production
database built by following the deployment runbook has no units, no categories, no settings and no
users — it cannot be logged into.** This is true today, independent of this migration.

**Fix (ships first):**

- Extract `seedUnits`, `seedCategories`, `seedSettings` verbatim into `prisma/bootstrap.ts`.
- Add `seedAdmin()` — one ADMIN from `FNB_ADMIN_USER` / `FNB_ADMIN_EMAIL`, with a **randomly
  generated password printed once to stdout**. There is no `mustChangePassword` column and this
  design does not add one: the admin changes it through the app. No fixed default password ever
  reaches production.
- `seed.ts` imports from `bootstrap.ts` rather than duplicating; demo accounts stay in `seed.ts`.
- New script: `npm run db:bootstrap -w @fnb/server`.
- `docs/security-runbook.md §0` gains `db:bootstrap` between `db:deploy` and first login.

`verify:seed` runs the same seeder over the same data, so **golden fixtures are unaffected**. That
is an assertion the implementation must prove by running it, not assume.

---

## 3. Architecture

Three commands, each independently useful:

```
db:bootstrap      reference data + first ADMIN          production prerequisite
import:legacy     the migration, --dry-run by default   this work
verify:legacy     parity against legacy reports         the proof
```

`import:legacy` runs ordered stages, each separately re-runnable:

```
tenancy → catalog → pricing → menus → history → trail
```

Each stage is one `$transaction`: it lands whole or not at all. A failure reports the stage and the
offending legacy row id, and leaves prior stages intact.

### Reading the legacy data

`fnb.sql` loads into a scratch MariaDB database on the XAMPP instance already present; the importer
queries it with `SELECT JSON_OBJECT(...)`, one JSON object per line, via the `mysql` CLI.

**Not a hand-rolled `.sql` parser.** During design, two successive hand-written parsers mis-read
this dump — first missing multi-line tuples (reporting 114 rows instead of 48,322), then reading
only the first `INSERT` chunk per table (reporting 494 catalog rows instead of 2,156). Both looked
like they worked. A migration whose input parser is silently wrong produces a database that is
plausibly, undetectably incorrect. MariaDB is already installed; use it.

Zero new npm dependencies.

---

## 4. Schema addition

```prisma
model LegacyMap {
  id          String @id @default(cuid())
  legacyTable String   // "bottles" | "client_bottles" | "client_bottle_audits" | …
  legacyId    String
  newId       String

  @@unique([legacyTable, legacyId])
}
```

Additive, no enums, no `Json`, SQLite-portable — consistent with the schema rules in
`architecture.md`.

This table is what makes the import idempotent. Without it a second run duplicates 8,525 count
lines. Every stage resolves a legacy id through `LegacyMap` first: found → update, absent → create
and record.

---

## 5. Tenancy

Legacy `clients` conflates business and venue. The rebuild separates `Client` (tenant: roles,
suppliers, aliases, subscription, billing) from `Location` (venue). Mapping:

| New Client | New Location | Legacy source | Module |
|---|---|---|---|
| Mansion Sports Bar & Lounge | Sports Bar | branch 73 **+ 74 merged** (clients 35, 36) | BAR |
| | Kitchen | branch 90 (client 52) | KITCHEN |
| Xylo | Bar | branch 93 (client 55) | BAR |
| | Kitchen | branch 87 (client 49) | KITCHEN |
| Sample Kitchen | Main | branch 88 (client 50) | KITCHEN |

This is the pattern `seed.ts:1497` documents as real and supported — one business splitting into a
BAR location and a KITCHEN location — not a collapse to be undone later.

**`Client` "Xylo" is synthesised.** Legacy has no parent row; it holds "Xylo Bar" (55) and "Xylo
Kitchen" (49) as separate clients. The importer creates the parent and records both legacy client
ids against it in `LegacyMap`.

**Subscriptions.** One per Client, with `SubscriptionModule` rows covering the modules its locations
use. `packageType`, `maxUsers` and `maxDevices` are commercial decisions the importer cannot know:
it creates a subscription covering the observed modules, sets `maxEntities` to the location count,
and **lists every client in the import report as requiring an LIS admin to set the tier**. Guessing
a billing tier silently is worse than leaving it flagged.

### Excluded

The three test clients (`copyTest`, `anotherTest`, `theTest` — two already soft-deleted), the 31
branches whose `client_id` has no row in `clients`, and `The Bar 2023` (branch 89: 10 catalog rows,
21 counts, 4 sales — below any useful threshold). Every exclusion is listed by name and row count in
the import report; none is silent.

---

## 6. Mapping

| Legacy | → | New | Notes |
|---|---|---|---|
| `categories` (45) | → | `Category` | `category_type` 1→Food (12 rows), 2→Beverage (32). `liquid_weight` → `defaultDensityFactor`, **but `0.00` → `null`** (§6.5). No type-3 rows exist — cocktails live only in `client_menus`. Names are unique, so `Category.name @unique` holds. One row fails naive parsing and must be read via MariaDB (§3) |
| `bottles` (1,205) | → | `Item` | `is_deleted` → `isActive: false`, not skipped: a deleted item may still appear in historical counts |
| `bottle_sizes` (1,251) | → | `ItemVariant` | `(bottle_id, bottle_size, bottle_uom)` → `@@unique([itemId, size, unitId])`. `contentTracked: true` for Beverage |
| `bottle_tare_weights` / `bottle_liquid_weights` | → | `ItemVariant.tareWeight` / `.densityFactor` | oz scale, matching the seeded category defaults (Vodka 30.12, Rum 30.49 …) |
| `client_bottles` (2,156) | → | `LocationItem` | `default_cost`→`cost`, `default_retail`→`retail`; per-venue `tare_weight`/`liquid_weight` become the LocationItem overrides |
| `client_menus` (889) | → | `MenuItem` + `RecipeVersion` | one initial version per menu |
| `client_menus_ingridients` (1,808) | → | `RecipeLine` | `serving` maps directly; the version is snapshotted at import |
| `client_bottle_audits` (8,525) | → | `CountSession` + `CountLine` | grouped by (branch, `date_audit`) → **one** COMMITTED session. `audit_type` 1→FULL qty; 2→WEIGH (`scale_weight`, `tare_weight`, `liquid_weight` → `remainingContent`) |
| `client_sales` (5,886) | → | `SaleRecord` | `sales_type` 1→SALE, 2→NON_REVENUE. `discount = 100` → **PRODUCTION** (deviation #4). `item_type` 1→item, 2→menu |
| `purchases` (44) + `purchase_items` (1,115) | → | `Purchase` + `PurchaseLine` | imported COMMITTED; `real_date` is the business date, not `date_created` |
| `client_forfeited_bottles` (1) | → | `Forfeit` | |
| `users` (7) | → | `User` | **no passwords** — see §6.2 |
| `trail` (21,991) | → | `ActivityLog` | unchained — see §6.3 |

**Not migrated:** `lis_inventory` and `wunderbar_pricing` (Wunderbar spout hardware — no counterpart
in the rebuild), `ci_sessions`, `sessions`, `page_menu`, `print`, `print_list`, `misc`, `logs`, and
the `_`-prefixed backup tables (`_bottles`, `_client_bottles`, `_client_bottle_audits`, `_purchases`,
`_purchase_with_category`).

### 6.1 Cost and retail snapshots

`CountLine`, `SaleRecord` and `PurchaseLine` carry cost/retail **snapshots**. Legacy stores
`default_cost` on the audit and sale rows themselves.

**Snapshots come from the source row, never from today's `LocationItem`.** Reading them from current
pricing would silently restate three years of valuation at 2026 prices — a difference no error
message would report and no user would notice until a historical report disagreed with the paper
copy.

### 6.2 Users and passwords

Seven legacy users import as `User` rows with username and status. Legacy password hashes are not
portable to scrypt and are not imported. Every migrated user lands with no usable credential; an
ADMIN sets passwords at go-live.

**Roles are not derived from `user_level`.** The legacy field holds only two values (`1` ×5, `2` ×2)
and the codebase has no record of what they meant. Every migrated user is created as
**`AUDIT_VIEWER_LIMITED`** — the lowest role in `@fnb/core` `ROLES`, holding `reports.view` and
nothing else — with `status: "DISABLED"` and an unusable password hash. An ADMIN enables each
account and assigns its real role deliberately; the import report lists them.

Inferring elevated privilege from an undocumented integer is how a migration silently grants
someone the ability to void committed records.

`security-runbook.md §1` already requires two named ADMINs with 2FA before real data lands — the
migration does not change that, and the import report restates it.

### 6.3 The activity trail

`ActivityLog` is hash-chained and immutable. Legacy `trail` rows carry no hash.

The codebase already has exactly this concept: entries written before hash-chaining shipped are
reported by the verifier as **`unchained`** rather than corrupt, and `npm run seal-history` seals
them once. Legacy trail imports as unchained entries, then a single `seal-history --confirm` run
seals the whole history.

Reusing that mechanism beats inventing an archive table. It is also honest about what it proves:
sealing freezes the entries as they stand — it does not certify that legacy history was authentic,
which is why the seal itself is recorded as `activity.sealHistory`.

### 6.5 Units and density — two traps

**Legacy weights are on the OUNCE scale; the rebuild stores GRAMS.** Legacy `tare_weight` has a
median of 20.4 (range 13.2–35.8) — a 750 ml bottle's empty weight in ounces — and legacy
`liquid_weight` (30.12, 30.49 …) is ml **per ounce**. The rebuild stores
`Category.defaultDensityFactor` per **gram** (`seed.ts:1487`, `densityPerGram = perOz / 28.349523125`)
and sets `tareWeightUnit: "g"` (`seed.ts:487`).

**The catalog converts; historical count lines do not.**

- `ItemVariant` / `LocationItem` → `tareWeight = gramsFromOz(legacy)`,
  `densityFactor = densityPerGram(legacy)`, `tareWeightUnit: "g"`. These govern *future* counts,
  and the counter's scale reads grams — leaving them in ounces would make staff convert every
  reading in their head.
- `CountLine` → **ounces, unconverted**. Each line carries its own scale/tare/density snapshot, so
  it is self-describing and internally consistent whatever scale it uses, and the arithmetic is
  unit-agnostic: `(s·k − t·k) × (d/k) ≡ (s − t) × d`. `seed.ts:1472-1484` does exactly this for the
  golden fixtures and documents the reasoning. Converting would introduce rounding drift into
  historical figures the client holds paper copies of, for no benefit.

Storing oz values unconverted would compute `1200 g − 20.4 "g" = 1179.6 × 1.0625 ≈ 1253 ml` for a
750 ml bottle. Keeping the oz scale instead and setting `tareWeightUnit: "oz"` is *not* the safer
option: `resolveDensityFactor` falls back variant → category, and the category default is per gram,
so any variant without its own density would silently mix scales.

Conversion rounding cannot move a historical number, because historical `remainingContent` is
carried from legacy `remaining_ml` verbatim rather than recomputed (§6 counts row). The converted
weights govern only *future* counts.

**`liquid_weight = 0.00` means "not weighable", not "density zero".** Twelve legacy categories
(Groceries, Liquer, …) carry `0.00`. Importing that literally into `defaultDensityFactor` would make
every weigh count on those categories compute `(scale − tare) × 0 = 0 ml` — a silent, total loss of
open-container content that `integrity_check` and every type check would pass. Rule: `0` → `null`,
which is the "derived, not configured" fallback `resolveDensityFactor` already expects.

**`bottle_uom` is free text and does not match `Unit.name`.** Fourteen distinct values are in use:

| Legacy | Rows | → `Unit` |
|---|---|---|
| `ml` | 1,525 | `ml` |
| `kg` | 364 | `kg` |
| `grams` | 75 | `g` |
| `liter` | 58 | `L` |
| `bottle` | 37 | `bottle` |
| `piece` | 33 | `pc` — **not** `Piece`, which is asset-register vocabulary |
| `can` | 28 | `can` |
| `pack` | 25 | `pack` |
| `portion` | 5 | **new** COUNT unit, `factorToBase: 1` |
| `oz` | 2 | `oz` |
| `case`, `box` | 1 each | `case`, `box` |
| `order` | 1 | **new** COUNT unit, `factorToBase: 1` |
| `mil` | 1 | `ml` — typo, normalised |

The importer carries this table explicitly and **aborts on any value not in it**. Auto-creating a
unit from an unrecognised string is how `mil` would have become a real unit with no conversion
factor, silently detaching one variant from every calculation that converts.

`portion` and `order` are added by `db:bootstrap`, not invented mid-import.

### 6.4 The one collision

Mansion branches 73 and 74 share **308 of 308** catalog items — 74 is the same venue duplicated to
hold a second audit cadence. They collide on exactly **one** count date: **2023-05-01**.

Rules for the merge:

- **Catalog:** union by `(bottle_id, bottle_size, bottle_uom)`, preferring branch 73's pricing.
- **Counts:** keep branch 73's session for 2023-05-01. Branch 74's lines for that date are skipped
  and **every skipped row is listed in the import report with its legacy id**.

Merging both into one session would sum two independent counts into a single anchor — the exact
double-anchor defect found in the 2026-08-22 audit, where a stray line moved an item's beginning
inventory from 1 to 100 and reported a 99-bottle shortage that never happened.

---

## 7. Running it

- **`--dry-run` is the default.** It reads everything, resolves every mapping, writes no rows, and
  produces a report: rows read per table, rows that would be created per model, unmapped categories,
  variants with no tare weight, date collisions, orphan references, and every exclusion by name.
  Writing requires an explicit `--confirm`.
- **Stage granularity:** `--stage=catalog` re-runs one stage. Default runs all, in order.
- **Ledger invariant:** each stage writes one `ActivityLog` entry — `import.legacy.<stage>` with its
  counts — inside the same `$transaction` as its writes. One entry per stage, not 48,000.
- **Rollback:** `npm run backup -w @fnb/server` immediately before `--confirm`. On a fresh
  production database the faster path is deleting the database file and re-running
  `migrate deploy` + `db:bootstrap`.

---

## 8. Verification

`verify:legacy` is a deliverable, not an afterthought. Following the project's established pattern
(`verify:seed`, `verify:sync`, `verify:security`), it builds its assertions from real legacy output.

For each location with at least two committed counts, it takes the periods bounded by consecutive
counts, runs the rebuild's `buildFullAudit` over them, and compares against the legacy
`beverage_fullaudit.php` figures for the same period. `docs/reference/` already holds two real
legacy XLSX reports (January 2025) — those become the first fixture cases.

**Legitimate differences, which the report must state rather than hide:**

1. **Date semantics.** Legacy used `BETWEEN begin AND end-1day` for purchases and sales but
   `BETWEEN begin AND end` for forfeits. The rebuild uses half-open `[begin, end)` uniformly
   (architecture.md §6, documented deviation).
2. **The 2023-05-01 Mansion anchor**, per §6.4 — correctly different.

Any other difference is a migration bug, not a deviation.

**Golden fixtures are re-run after the bootstrap extraction and after any core-adjacent change**
(`npm run verify:seed -w @fnb/server`), per the project's standing rule.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Silent parser error produces a plausible but wrong database | Read through MariaDB, not a custom parser (§3). Two hand-written parsers already failed this dump during design |
| Import run twice, doubling history | `LegacyMap` unique constraint (§4) |
| Historical valuation restated at current prices | Snapshots read from source rows (§6.1) |
| Double-anchored count period | Sessions synthesised by (branch, date); the one collision handled explicitly (§6.4) |
| Client mistakes imported 2023 stock for current stock | Opening balances deliberately **not** imported; fresh count at go-live (§1) |
| Bootstrap extraction breaks the golden fixtures | `verify:seed` run before and after; it builds a throwaway database, so it cannot touch working data |
| Subscription tiers guessed wrong | Not guessed — flagged per client in the import report (§5) |

---

## 10. Out of scope

- Wunderbar / `lis_inventory` spout-dispense data
- Legacy report *layouts* — the rebuild's report suite is its own body of work
- Any change to `reconciliation.ts`, `weighing.ts`, `pricing.ts` or `rounding.ts`
- Migrating legacy password hashes
- A general-purpose import UI — this is a one-shot go-live migration run from a shell, and the
  existing Imports feature (CSV/XLSX/AI extraction with human review) already covers ongoing ingest
