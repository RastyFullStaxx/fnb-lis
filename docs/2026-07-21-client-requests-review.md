# Client Requests — 2026-07-21 (Review Guide)

> **Login for the demo:** `admin` / `Fnb!2026` (or `manager`, `staff`, `accountant`, `readonly` —
> same password). Two establishments are seeded: **Prime Hospitality Group** (locations *Main Bar* +
> *Kitchen*) and **Casa Verde Restaurant** (location *Main*).

---

## What this covers

The client sent **two rounds of notes** on 2026-07-21. This guide collects *everything* we did across
both — what was asked, what we found already in the system, what we built (or parked), and exactly
**where to see each one**. Scorecards first; details below.

### Round 1 — the five-item list (A–E)

| # | Client ask (plain English) | Verdict going in | What we did | Status |
|---|---|---|---|---|
| **A** | Highlight over/short in the Full Audit when it's material (~11%), on screen **and** in downloads; whole-bottle items highlight when off by a single bottle | ❌ Not built (and *not* in the legacy code, despite the client's belief) | Built the highlight + made the 11% a **per-establishment setting** | ✅ Shipped |
| **B** | When recording non-revenue, allow a plain/"Other" input alongside the 3 buckets; show the breakdown in the report | 🟡 Half-built | Added an **"Other / Unspecified"** option; breakdown now rolls up by bucket | ✅ Shipped |
| **C** | In the Sales report, show a **regular-vs-discounted** breakdown | 🟡 Half-built | Added a **"By Price Type"** split + Total Discount Given | ✅ Shipped |
| **D** | Can the system integrate a 3rd-party **barcode scanner**? | 🟡 Field exists, nothing wired | Answered + wrote a build spec | 📋 Parked (spec ready) |
| **E** | Count inventory offline on a device at a branch, then **upload** into the office system | ❌ Not built | Answered; tied to the future desktop phase | 📋 Parked |

Two follow-ups the client then approved, also built: the threshold became a **saved per-establishment
setting**, and a **fully-loaded demo seeder** so all of it shows with data.

### Round 2 — four more notes (1–4)

| # | Client note (plain English) | Verdict going in | What we did | Status |
|---|---|---|---|---|
| **1** | Force-enter an open item **by amount, with no liquid/tare weight** | 🟡 Already possible via a decimal count | Added a dedicated **"Open Amount"** count mode | ✅ Shipped |
| **2** | Take subscription payment via **GCash / bank transfer**; verify before activating a client (staff creation exempt) | — | Gave design suggestions only, per the client | 💭 Thought only |
| **3** | **Par Level report** — based on stock movement (begin/end) to guide purchasing | ❌ Not built | Built it | ✅ Shipped |
| **4** | **Non-Moving items report** — stock that isn't moving | ❌ Not built | Built it (+ seeded dead stock so it shows) | ✅ Shipped |

Round 1 detail is in the **A–E** sections; Round 2 detail is under **[Round 2 details](#round-2-details)**.

---

## A — Variance highlighting (the big one)

### What the client asked
> "Based on 11% on over/short… the shots should highlight in the main system view **and** in the
> download report. And 1-is-to-1 items like a bottle should auto-highlight when short or over by one
> bottle."

**In plain English:** in the Full Audit, an item is either *content-tracked* (a liquor bottle you
weigh — you can be off by half a bottle) or *whole-unit / "1:1"* (a beer bottle you count whole — you
can only be off by a whole bottle). The client wants the report to **automatically colour the rows
that matter**: a material % gap for the first kind, and any single-bottle gap for the second.

### What we found first (important to relay)
The client believed this rule already existed in the old system. **It did not.** The legacy PHP only
ever coloured a row red when the variance was *negative* (`$short < 0`) — any size, shorts only, no
11%, no over-highlighting, and the PDF had no colour at all. So this is **net-new**, built to the
client's stated numbers — not a port. (Coverage audit lives in this chat's history; the corrected
tracker is in [project-overview.md](project-overview.md).)

### What we built
A single pure helper, `varianceSeverity(row, thresholdPct)`, in
[`packages/core/src/reconciliation.ts`](../packages/core/src/reconciliation.ts). A row is **material**
if **either** rule fires (they're additive):

1. **Percentage rule** — `|variance ÷ usage| ≥ threshold` (default **11%**). Applies to any item with
   usage, so a −26% short on butter lights up just like one on a poured spirit.
2. **Whole-unit rule** — `|variance| ≥ 1` for **non-content items** (a bottle of beer, a canned good).
   Being off by one unit is the finding, even below 11%. (Also the fallback when there's no usage to
   take a percentage of.)

Then it returns a direction: **material short → red, material over → amber** (richer than the
legacy's single red — you can tell loss from a counting error at a glance).

### Where to see it
| Surface | How to get there |
|---|---|
| **On screen** | Reports → **Full Audit**. Material rows are tinted (red short / amber over); the variance numbers pick up the same colour. |
| **Downloads** | Full Audit → *Excel / CSV / PDF* **and** *Client Formats → Detailed / Inventory*. Each carries a coloured row fill **plus a new "Flag" column** ("Short"/"Over") — the Flag is how CSV conveys the finding, since a CSV can't hold a colour. |
| **Code** | Predicate: [`reconciliation.ts`](../packages/core/src/reconciliation.ts) · Screen: [`full-audit.tsx`](../apps/web/src/pages/reports/full-audit.tsx) · Exports: [`exports.ts`](../apps/server/src/services/exports.ts) (modern) + [`exports-suite.ts`](../apps/server/src/services/exports-suite.ts) (legacy) + [`pdf.ts`](../apps/server/src/services/pdf.ts) (per-row fill) |

### The fix explained (the one real bug — worth understanding)
My **first** version used the `contentTracked` flag to *choose between* the two rules (percentage for
content items, ±1 for the rest). That was **wrong**, and a live check caught it: **butter (−11.4%)**
and **cooking oil (−26.8%)** — clearly material shorts — did **not** highlight.

Why: kitchen items weighed by net weight (butter in kg, oil in L) have `contentTracked = false`, so
they were being routed to the ±1 rule and their percentage was ignored. And the client's own example
of a "1:1 bottle" — San Miguel beer — is modelled as `unit = "ml"`, *not* a discrete count unit, so
"is it a COUNT unit?" wouldn't have identified it either.

**The lesson:** `contentTracked` is not a "whole-unit" flag. The fix was to make the two rules
**additive (OR)** instead of either/or — the percentage rule applies to everyone with usage, and the
±1 rule *adds* coverage for non-content items. Simpler and correct.

### Made into a setting (the follow-up)
The client asked to make the 11% **tunable and per-establishment**. See
[**"The threshold setting"**](#the-threshold-setting--who-controls-it) below.

---

## B — Non-revenue "Other / Unspecified"

### What the client asked
> "You can tag it as Spoilage/Spillage, Trimming, or OTH/Marketing — **or just record a plain input**.
> Then see the breakdown in the report."

### What we built
- Added a 4th option, **"Other / Unspecified"**, to the reason dropdown when recording non-revenue.
  It's a *named* reason (never a blank) — so nothing ever vanishes from the audit trail; "Other" is
  simply the catch-all for "used, but not classified."
- The report's breakdown now **rolls up by the canonical bucket** (Spoilage / Trimming / Marketing-OTH
  / Other) instead of by the raw label. Bonus: old/legacy reason codes (Staff use, Internal use) fold
  into **Other** automatically, so mixed history stays tidy.

### Where to see it
| Surface | How to get there |
|---|---|
| **Recording it** | Sales → **Non-revenue** tab → the **Reason** dropdown now lists four options. |
| **The breakdown** | Reports → **Non-Revenue** → scroll to the **"By Bucket"** section (also the "Cost by Bucket" chart, and a "By bucket" block in the Excel export). |
| **Code** | Option: [`sales/index.tsx`](../apps/web/src/pages/sales/index.tsx) · Grouping: [`report-lists.ts`](../apps/server/src/services/report-lists.ts) (`nonRevenueReport`) · Web: [`reports/non-revenue.tsx`](../apps/web/src/pages/reports/non-revenue.tsx) |

---

## C — Sales regular-vs-discounted breakdown

### What the client asked
> "In the sales report, be able to see regular price vs discounted."

### What we built
The Sales report gained a **"By Price Type"** summary strip: **Regular** vs **Discounted** (count /
qty / net) plus the number a manager actually cares about — **Total Discount Given** (the pesos handed
away). It's derived automatically from whether a sale carried a discount (no new field, no toggle
needed). The Sales Excel/CSV carry a matching block.

> We deliberately left the Full Audit's revenue column as a single figure — splitting it there would
> touch reconciliation math for no audit benefit.

### Where to see it
| Surface | How to get there |
|---|---|
| **On screen** | Reports → **Sales** (the *Sales* view) → the strip sits above the table. |
| **Downloads** | Sales → Excel / CSV → a "By Price Type" block at the bottom. |
| **Code** | Server split: [`report-lists.ts`](../apps/server/src/services/report-lists.ts) (`salesReport` → `byPriceType`) · Web: [`reports/sales.tsx`](../apps/web/src/pages/reports/sales.tsx) |

---

## D — 3rd-party barcode scanner (parked, with a spec)

**The client-facing answer:** **Yes, it can integrate — and there's essentially nothing to "install."**
Standard USB/Bluetooth retail scanners are *keyboard-wedge* devices: they "type" the barcode and press
Enter into whatever field is focused, exactly like a keyboard. No driver or SDK.

**Where it stands:** a per-size `barcode` field already exists in the data model end-to-end, but it's
exposed in no screen and nothing looks up by it yet — scaffolding only.

**Parked because:** it's a real feature (~1–2 days, front-end-weighted) and the client asked us to
settle the current round first. The full build spec (capture → uniqueness → resolve → scan-to-add,
and the "unknown code" behaviour) is written up in
[project-overview.md → "Parked build — 3rd-party barcode scanning"](project-overview.md).

---

## E — Offline standalone count → upload (parked)

**The client-facing answer:** this is two things, neither built yet:
1. **Offline on a device** — that's the deferred **Electron desktop + local database** phase.
2. **Uploading a count** into another instance — needs the currently-**parked** "COUNTS" import kind.

**What *is* already shipped** is the adjacent half the client referenced: full **report viewing +
download** (Excel/CSV/PDF). One caution for the team: the word `STANDALONE` already exists in the
system as a **billing plan** — do not confuse it with this offline-deployment idea. Details in
[project-overview.md](project-overview.md).

---

## The threshold setting — who controls it

The client asked to make the 11% **adjustable per establishment**. We modelled it exactly like the
existing **cost-basis** policy, because a variance tolerance is the same kind of thing — an audit
policy a bar and a fine-dining kitchen would set differently.

**Who can change it:**

| Role | Can they change it? |
|---|---|
| **ADMIN** (LIS system owner) | Yes — for **any** establishment |
| **MANAGER** (that establishment's manager) | Yes — for **their own** establishment only |
| Staff / Accountant / Read-only | **No** — they only *read* it (the report has to apply it) |

It is **not** a single global number, and **not** every user — it's per-establishment, set by that
establishment's manager or the system admin.

### Where to see it
| Surface | How to get there |
|---|---|
| **The control** | **Settings** → **"Variance Highlight Threshold"** (right below Inventory Cost Basis). A % input + Save; disabled for non-editors. |
| **Effect** | Change it, then open the Full Audit — the highlighted rows change immediately, and every export honours the same value. |
| **Code** | Column: `Client.varianceThresholdPct` (migration `20260721072637`) · API: [`routes/settings.ts`](../apps/server/src/routes/settings.ts) · threading: [`routes/reports.ts`](../apps/server/src/routes/reports.ts) (`thresholdOf`) → exports · Web: [`api/settings.ts`](../apps/web/src/api/settings.ts) + [`pages/settings.tsx`](../apps/web/src/pages/settings.tsx) |

### How it's validated
- Read is open to any report viewer (a report must show the value it's using).
- Write is behind `master.write` **and** an access check for that client.
- Value must be **0–100** (server rejects anything else with a 400).

---

## The demo seeder — so all of this shows up with data

The reconciliation fixtures are sacred (they're the numbers the client trusts, and our regression
check). So we did **not** touch them — the enrichment went into the **demo layer**
([`seed-demo.ts`](../apps/server/prisma/seed-demo.ts)), added *after* every fixture window and made
idempotent (safe to re-run). It adds:

- an **"Other / Unspecified"** non-revenue entry on each sales location, so the By-Bucket breakdown
  shows all four buckets out of the box;
- **distinct per-establishment thresholds** — Prime **11%** (default), Casa Verde **8%** — so the new
  setting visibly differs between tenants;
- a **dead-stock item** per sales location (Blue Curaçao behind the bar, truffle paste in each
  kitchen), counted equally at the period's start and end so it has stock but *zero* movement — so the
  **Non-Moving report** has rows to show.

**Proof the fixtures didn't move:** after every re-seed, Main Bar's Jun 1–8 Full Audit is still exactly
**−₱330.69** at cost / **−₱869.57** at retail. (The dead-stock item has zero variance, so it moves no
total either.)

---

## Round 2 details

### 1 — Open-amount count entry

**What the client asked:** *"In inventory input, I can force-enter open items by weight even without a
liquid weight or tare weight."*

**What we found:** a tare-free path already existed — you can type a **decimal** in a Full count (e.g.
`2.5` for two-and-a-half bottles), which records an open item without weighing. But that's a fraction
of a bottle, not the literal "enter the amount," so we closed the gap properly.

**What we built:** a third count mode — **"Open Amount."** When counting a weighable item you now see
three tabs: *Full Units · Weigh Partial · **Open Amount***. Open Amount is a single field ("Remaining
ml") — type what's left in the container, no scale or empty weight. It's stored as a weigh line with
the content set straight from the number, so **reconciliation reads it identically and no math moves**
(the golden fixture is untouched).

| | |
|---|---|
| **Where to see it** | Sidebar → **Counts** → open a count → pick a bottle/weighable item → the **"Open Amount"** tab. (Only shows for weighable items, in an open — not committed — session.) |
| **Code** | Schema: [`schemas/ops.ts`](../packages/core/src/schemas/ops.ts) (`countLineCreate` → optional `remainingContent`) · Route: [`routes/counts.ts`](../apps/server/src/routes/counts.ts) (`buildLineData`) · UI: [`counts/session.tsx`](../apps/web/src/pages/counts/session.tsx) |

### 2 — Payment method (thoughts only)

**What the client asked:** clients pay the subscription/standalone fee via **GCash or bank transfer**,
and the admin **verifies payment before activating** a client's account — while a client's own staff
creating logins are **exempt** from this.

Per the client ("just the thought for now"), we **did not build** this — here's the suggested shape:

- **No payment gateway.** GCash/bank transfer settle offline; the system should only **record proof**
  (method, reference no., amount, date, optional screenshot), never process money or store card/bank
  credentials.
- **Gate activation on the *subscription*, not the user** — which makes staff creation exempt for
  free: a new client starts pending until the admin clicks "Verify & Activate"; staff logins are made
  *inside* an already-active client and never touch payment.
- The existing `paid` / `status` machinery on the subscription is the scaffolding — this is mostly
  *capturing the method + a verify action*, not new billing logic.

### 3 — Par Level report

**What the client asked:** *"Par level report — based on the movement of stocks, beginning and ending,
to guide purchasing."*

**What we built:** a **purchasing guide** at **Reports → Par Level**. For every item with a reorder
point it shows current **on-hand vs par**, **how much moved last closed period**, and a **suggested
order** (`par − on-hand`) — below-par items sorted to the top, with a "total to buy" and an Excel/CSV/
PDF export. It projects off the Full Audit engine, so its numbers cross-foot.

| | |
|---|---|
| **Where to see it** | Reports → **Par Level** (under "Stock & Movement"). Demo shows **5 items below par, ₱5,797.40 to buy** — e.g. *Tonic Water: on-hand 19 / par 24, used 36 → buy 5*. |
| **Code** | Server: [`report-lists.ts`](../apps/server/src/services/report-lists.ts) (`parLevelReport`, shared `stockSnapshot`) · Route + exports: [`routes/reports.ts`](../apps/server/src/routes/reports.ts) · Web: [`reports/par-level.tsx`](../apps/web/src/pages/reports/par-level.tsx) |

### 4 — Non-Moving items report

**What the client asked:** *"Non-moving items report — based on stocks that don't move."*

**What we built:** a **dead-stock** report at **Reports → Non-Moving Items** — items still on hand that
saw **zero movement** over the last closed period, ranked by the value sitting idle (cost + retail),
with export. Same shared snapshot as Par Level, so it cross-foots too. Because the live demo had no
dead stock (everything moved), the seeder now plants one idle item per location so the report is
populated.

| | |
|---|---|
| **Where to see it** | Reports → **Non-Moving Items**. Demo: Main Bar shows *Blue Curaçao 750 ml — on-hand 6, ₱2,880 idle*; each kitchen shows *Truffle Paste 1 kg — ₱5,550 idle*. |
| **Code** | Server: [`report-lists.ts`](../apps/server/src/services/report-lists.ts) (`nonMovingReport`) · Route + exports: [`routes/reports.ts`](../apps/server/src/routes/reports.ts) · Web: [`reports/non-moving.tsx`](../apps/web/src/pages/reports/non-moving.tsx) · Seed: [`seed-demo.ts`](../apps/server/prisma/seed-demo.ts) (`seedDeadStock`) |

---

## Try it yourself (review path)

1. **Log in** (`admin` / `Fnb!2026`).
2. **Full Audit highlight** — Reports → Full Audit. You'll see red/amber rows (e.g. on the Kitchen/
   Casa data: Salmon amber, Butter & Cooking Oil red). Download the CSV — note the new **Flag** column.
3. **The setting** — Settings → **Variance Highlight Threshold**. Bump it to **30** and Save, reopen
   the Full Audit: most highlights disappear, but a row that's off by a whole unit stays. Set it back
   to a low number and they all come back.
4. **Non-revenue Other** — Reports → Non-Revenue → **By Bucket** section shows *Other / Unspecified*.
   (Try recording one: Sales → Non-revenue → Reason dropdown.)
5. **Sales split** — Reports → Sales → the **By Price Type** strip above the table (Regular /
   Discounted / Total Discount Given).
6. **Open-amount count** — Counts → open (or start) a count → pick a bottle → the **"Open Amount"** tab
   → type the remaining amount, save. No scale needed.
7. **Par Level** — Reports → **Par Level**: 5 items below par with suggested order quantities and a
   "total to buy."
8. **Non-Moving Items** — Reports → **Non-Moving Items**: the seeded dead stock (Blue Curaçao / Truffle
   Paste) sitting idle.

---

## What we intentionally did *not* change

- **Reconciliation math** — the highlight and the two new reports are a *presentation* layer only;
  they read existing numbers and move none of them. The golden fixtures were re-verified after every
  change.
- **The Full Audit revenue column** — kept as a single figure (the regular/discounted split lives in
  the Sales report, where it belongs).
- **The open-amount count entry** — stores the remaining content exactly the way a weighed line does,
  so reconciliation math is unchanged; it's just a different way to *enter* the same value.
- **The fixture seed data** — only the demo layer was enriched (including the dead-stock items).

## Where the canonical records live
- Architecture rationale (incl. the additive-rule note): [architecture.md](architecture.md), deviation **#25**.
- Shipped-history log: [build-log.md](build-log.md), **Phase 14** (Round 1) and **Phase 15** (Round 2).
- Request tracker + the two parked specs (barcode, offline): [project-overview.md](project-overview.md), **2026-07-21 additions**.
