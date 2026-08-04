# FORFEIT — 2026-08-02 (Build Brief)

> **Handoff doc.** Everything below was checked against the code before it was written — the "What's
> actually there" lines are findings, not guesses. Two items are smaller than they look, one is
> bigger, and one must not be started yet.
>
> Demo logins: `admin` / `Fnb!2026` (also `owner`, `manager`, `staff`, `accountant`, `readonly`).

---

## Scorecard

| # | Who | Ask (plain English) | What we found | Action | Effort |
|---|---|---|---|---|---|
| **G** | Lourd | Add **Garnish** to bar inventory (cherry, lemon, lime…); also useful for café | Product types are a fixed map; `BAR → ["Beverage"]` only | ✅ **Shipped 2026-08-04** — both BAR and KITCHEN | ~1 h |
| **1** | Jj | Warn when an entered **weight looks out of range** | Warning machinery already exists; over-range already covered, under-range missing | ✅ Build | ~2 h |
| **2** | Jj | **UOM per item**, not one setting for everything | Items already carry their own unit — a *per-user display preference* is overriding it | ✅ Build | ~½ day |
| **3** | Jj | **Reports by subscription tier** (Basic / Medium / Full / Standalone) | No tier gating exists at all. And `packageType` is **derived**, not stored | 🛑 Blocked — see the warning | — |
| **4** | Jj | Unused bottles **returned to inventory at ₱0** | Already ₱0 everywhere. Real gap is **bulk entry** | ❓ One answer, then build | ~1 day |

**Total once unblocked: ~3 days of build.**

---

## Send these to the client first

Two questions unblock two items. Suggested wording:

> **1 — On the unused bottles.** When a customer buys a set and doesn't finish it, which of these
> actually happens?
> - (a) The customer takes the remaining bottles home
> - (b) The remaining bottles stay with the bar
> - (c) The bar stores them under the customer's name to finish next visit
>
> **2 — On Garnish.** Should garnishes appear in a **bar-only** location's catalog, a **kitchen-only**
> one, or both? (Right now a bar location only sees "Beverage" items, so this decides whether we add
> a new product type or just a category.)

---

## G — Garnish — ✅ SHIPPED 2026-08-04

> Built as recommended below (client answered "parehas"). `MODULE_PRODUCT_TYPES`
> now has `BAR: ["Beverage", "Garnish"]` and `KITCHEN: ["Food", "Garnish"]`; the
> `productTypes` Setting gained it via seed + migration
> `20260806000000_garnish_product_type`. Both verification steps done: a Garnish
> item created, attached to Main Bar and returned by that bar's catalog;
> `allowedProductTypes(["ASSET"])` still `["Asset"]`; the Product Type filter
> lists it (it reads the same Setting). See build-log 2026-08-04.

### What was asked
> "Dun sa pag create Menu for bar inventory lagyan natin ng (Garnish) if ever sama nila sa inventory
> yung pang garnish like cherry, lemon, lime, etc… Pwede din sya pang café inventory."

### What's actually there
Catalog visibility is driven by `Category.productType`, filtered through a **fixed lookup**:

```ts
// packages/core/src/constants.ts:296
export const MODULE_PRODUCT_TYPES: Record<ModuleType, readonly string[]> = {
  BAR: ["Beverage"],
  KITCHEN: ["Food"],
  ASSET: ["Asset"],
};
```

### ⚠️ The trap
**A BAR-only location can only see `"Beverage"` items.** So:

- Make Garnish a **Category under Food** → zero code, but **cherries disappear from every bar
  location**, which is the opposite of what Lourd asked for.
- Make Garnish a **new product type** without touching the map → same disappearance, plus it's
  invisible everywhere.

### What to build (recommended)
Add `"Garnish"` as a product type mapped to **both** `BAR` and `KITCHEN`. That satisfies "bar" and
"pwede din sa café" in one move.

1. `MODULE_PRODUCT_TYPES` — add `"Garnish"` to both `BAR` and `KITCHEN`
2. The `productTypes` Setting — add `"Garnish"` to the list
3. Seed a `Garnish` category so it shows with data
4. Check the catalog filter UI picks it up (it reads the same list)

**Verify:** open a BAR-only location and confirm Garnish items appear; open an ASSET-only location and
confirm they don't.

---

## 1 — Weight out of range

### What was asked
> "When staff enter a weight, they may occasionally make mistakes. The system should prompt the user
> when the entered weight appears to fall outside the expected range."

### What's actually there
**Most of this already works.** `validateWeigh` returns coded warnings with a `blocking` flag
([packages/core/src/weighing.ts:26](../packages/core/src/weighing.ts)):

| Code | Blocking | Covers |
|---|---|---|
| `SCALE_BELOW_TARE` | yes | Reading below the empty weight |
| `CONTENT_EXCEEDS_SIZE` | no | More content than a full container holds — **the over-range case** |

So the **over** side is done. What's missing is the **under** side.

### What to build
One more non-blocking warning: content implausibly *low* relative to the container (a reading barely
above tare). In practice that means a mis-keyed tare weight, the wrong item selected, or a bottle
that is genuinely almost empty — all worth a "is this right?" prompt, none worth blocking.

- Add the code to `validateWeigh`, following the existing shape
- Surface it wherever `CONTENT_EXCEEDS_SIZE` is already surfaced (no new UI plumbing needed)
- Keep it **non-blocking** — an almost-empty bottle is a real thing

### ⚠️ Verification requirement
`weighing.ts` is in the **sacred set** (README rule 1). This change is additive and doesn't touch
`remainingContent`/`netQuantity`, but run it anyway:

```bash
npm run verify:seed -w @fnb/server
```

---

## 2 — Unit of measure per item

### What was asked
> "Staff may want a specific UOM for one item but not for another. The system should allow the UOM to
> be configured on a per-item basis."

### What's actually there
Each `ItemVariant` **already has its own `unitId`**. The problem is newer than that: on 2026-07-31 we
shipped a **per-user display preference** (`preferredVolumeUnit` / `preferredMassUnit`,
[routes/settings.ts:80](../apps/server/src/routes/settings.ts)) that applies to *everything* and
overrides the item's own unit.

Jj has spotted the seam: the user preference is winning where it shouldn't.

### What to build
A nullable **pinned display unit** on the item. When set, it beats the user preference; when null,
current behaviour is unchanged.

1. Nullable `displayUnitId` on `LocationItem` (migration + `db:generate` — remember migrate does
   **not** regenerate the client)
2. Display resolver: pinned unit → else user preference → else the variant's own unit
3. Item edit UI: a "Always show this item in ___" picker, blank by default

### ⚠️ Non-negotiable
**Display only.** The item's stored unit stays the source of truth for storage and all math. Nothing
in this change may reach the conversion used by counts or reconciliation.

---

## 3 — Reports by subscription tier 🛑 DO NOT START

### What was asked
> "Report type depends on the subscription. Since multiple reports have been implemented, I will
> create a checklist so the client can verify which reports shows in Basic, Medium, Full, and
> Standalone."

### What's actually there
**No tier gating exists.** `canViewReport` gates by **role** only (the audit-viewer narrowing). This
is entirely net-new work.

### ⚠️ Raise this with Jj BEFORE he writes the checklist
`packageType` is **derived, not stored**:

```ts
// packages/core/src/constants.ts:250
// packageType is NOT a separately-settable field anywhere in the app —
// it's derived from billingCycle + maxEntities + maxUsers
derivePackageType(billingCycle, maxEntities, maxUsers)
```

**If reports are gated on the tier label, an admin bumping "Max users" from 5 to 6 silently changes
which reports that client can open.** Nobody will connect the two, and it'll arrive as "bakit nawala
yung report ko?"

**Recommendation:** gate on an **explicit enabled-reports set per subscription** — same shape as the
existing `SubscriptionModule` rows — and keep the tier only as a *default preset* applied at
creation. The tier stays a label; the enabled set is the enforcement.

This changes what Jj's checklist needs to say, so agree it first. Blocked until then.

---

## 4 — Unused bottles returned at ₱0

### What was asked
> "Sometimes a customer purchases items, but some bottles remain unused. Those unused bottles should
> be returned to inventory with a cost of 0. Note that these could be a lot of bottles, like really
> many."

### What's actually there
**Returns already carry ₱0 everywhere.** Verified in three places:

| Where | Finding |
|---|---|
| `model Forfeit` ([schema.prisma:719](../apps/server/prisma/schema.prisma)) | **No cost column at all** |
| `reconciliation.ts:227` | `forfeited` enters usage as **quantity only** |
| `exports.ts:231` | `Returns` is a **qty** column — no cost column, unlike `purchased`/`purchasedCost` |

So *"returns not valued at 0"* was assumed rather than verified. **Nothing to build there.**

The one case where it *would* be real is if someone means the returned bottles should **sit in stock
at ₱0**. That needs per-unit FIFO/lot costing against a schema that deliberately holds one `cost` per
`LocationItem` — a large, math-touching change to the report the client trusts most, for no benefit
he asked for. **Decline unless he insists**, and price it honestly if he does.

### ⚠️ The business question that decides everything
Zero cost is only correct if **the house keeps the bottles**. The three cases behave completely
differently:

| Case | What actually happens | Correct handling |
|---|---|---|
| Customer takes them home | Bottles left the building | **No return at all.** Recording one invents stock you don't have, and the next count comes up short |
| House keeps them | Paid for, cost already expensed, back on the shelf | ✅ Return at ₱0 — the current feature |
| Bar stores them for the customer | Physically present, **not yours to sell** | **Separate record type.** Not a return |

The third one is common in PH bars and is the dangerous one: recorded as a return it becomes sellable
stock, and the reconciliation goes wrong **twice** — a false **surplus** at the next count, then a
false **shortage** when the customer returns and drinks it with no sale behind it. That's exactly the
variance noise that makes people stop trusting the Full Audit.

### What to build — bulk entry (the real gap)
"Really many bottles" is the actionable half. It splits:

- **Count-tracked items:** `qty` is already a number, so 50 of the *same* bottle is **already one
  entry**. The limit is one **item per request** — 12 different SKUs means 12 calls. Fix with a
  multi-line form, same shape as purchases (one header, many lines).
- **Weighed items:** genuinely one at a time, and leave it that way. Each bottle needs its own
  `scaleWeight` ([schemas/ops.ts:221](../packages/core/src/schemas/ops.ts)). Batching would throw
  away the per-bottle weight the whole weighing path exists for.

### ⚠️ Why this sits near the sacred math
Returns are load-bearing for the Full Audit. Without the `+ forfeited` term those bottles read as a
**shortage**. The bulk-entry work is UI plus a route and touches no math — but if anything reaches
`reconciliation.ts`, re-verify the golden fixtures.

---

## Suggested order

1. **Send the two client questions** — unblocks G and 4 overnight
2. **Raise the derived-`packageType` issue with Jj** before he writes the checklist
3. **#1 weight warning** (~2 h) — cheapest win, machinery already there
4. **G Garnish** (~1 h) once scoped
5. **#2 per-item UOM** (~½ day)
6. **#4 bulk returns entry** (~1 day)
7. **#3 reports by tier** — last, when the matrix arrives and the gating mechanism is agreed

## Before calling any of it done

```bash
npm run typecheck -w @fnb/server && npm run typecheck -w @fnb/web
npm run verify:seed -w @fnb/server        # required for #1; cheap insurance for the rest
npm run verify:security -w @fnb/server    # if any route or guard was touched
```
