# Client Requests — 2026-07-21 Round (Review Guide)

> **Login for the demo:** `admin` / `Fnb!2026` (or `manager`, `staff`, `accountant`, `readonly` —
> same password). Two establishments are seeded: **Prime Hospitality Group** (locations *Main Bar* +
> *Kitchen*) and **Casa Verde Restaurant** (location *Main*).

---

## The message we were answering

| # | Client ask (plain English) | Verdict going in | What we did | Status |
|---|---|---|---|---|
| **A** | Highlight over/short in the Full Audit when it's material (~11%), on screen **and** in downloads; whole-bottle items highlight when off by a single bottle | ❌ Not built (and *not* in the legacy code, despite the client's belief) | Built the highlight + made the 11% a **per-establishment setting** | ✅ Shipped |
| **B** | When recording non-revenue, allow a plain/"Other" input alongside the 3 buckets; show the breakdown in the report | 🟡 Half-built | Added an **"Other / Unspecified"** option; breakdown now rolls up by bucket | ✅ Shipped |
| **C** | In the Sales report, show a **regular-vs-discounted** breakdown | 🟡 Half-built | Added a **"By Price Type"** split + Total Discount Given | ✅ Shipped |
| **D** | Can the system integrate a 3rd-party **barcode scanner**? | 🟡 Field exists, nothing wired | Answered + wrote a build spec | 📋 Parked (spec ready) |
| **E** | Count inventory offline on a device at a branch, then **upload** into the office system | ❌ Not built | Answered; tied to the future desktop phase | 📋 Parked |

Then the client approved two follow-ups, which we also built: (A) making the threshold a **saved
setting**, and (2) a **fully-loaded demo seeder** so all of this shows up with data.

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
  setting visibly differs between tenants.

**Proof the fixtures didn't move:** after re-seeding, Main Bar's Jun 1–8 Full Audit is still exactly
**−₱330.69** at cost / **−₱869.57** at retail.

---

## Try it yourself (5-minute review path)

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

---

## What we intentionally did *not* change

- **Reconciliation math** — the highlight is a *presentation* layer only; it reads existing numbers
  and moves none of them. The golden fixtures were re-verified after every change.
- **The Full Audit revenue column** — kept as a single figure (the regular/discounted split lives in
  the Sales report, where it belongs).
- **The fixture seed data** — only the demo layer was enriched.

## Where the canonical records live
- Architecture rationale (incl. the additive-rule note): [architecture.md](architecture.md), deviation **#25**.
- Shipped-history log: [build-log.md](build-log.md), **Phase 14**.
- Request tracker + the two parked specs (barcode, offline): [project-overview.md](project-overview.md), **2026-07-21 additions**.
