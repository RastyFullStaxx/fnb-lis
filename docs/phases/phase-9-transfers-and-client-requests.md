# Phase 9 — Inter-location transfers + the 2026-07 client request round

Delivers the client's post-checkup request list (2026-07-19) and the transfers feature. Also
remediates the billing-window defects found while auditing the subscriptions arc.

**Scope shipped in this phase**

| # | Client request | What shipped |
|---|---|---|
| 1 | Bigger, readable fonts | Default text-size preference is now "large" (18 px); users who explicitly chose a size keep it (Settings → Display) |
| 2 | Kitchen variance heading | Full Audit column renamed **"Variance vs Sold"** everywhere (screen, xlsx, csv) |
| 3 | Combined bar+kitchen report with beverage/food cost | New **Cost Analysis** report (legacy `*_downloadCA` formulas; see fixture below) |
| 4/12 | View+download-only 3rd-party access, 15–20 min sessions | READONLY: 20-minute **absolute** session, `reports.export` granted, watermark overlay on report screens, "Exported by" footer on every export. True screenshot-blocking is impossible in a browser (as told to the client) — the watermark makes captures attributable instead |
| 6/7 | Per-module login flyers | `/login?m=bar\|kitchen` flyer slot with illustration fallback until LIS sends the files (`apps/web/src/pages/login.tsx` FLYERS map) |
| 8 | Public promo page | Landing at `/` — tagline, Facebook + promo-video placeholder slots (`apps/web/src/pages/landing.tsx`) |
| 9 | Per-user module restriction (the 5 packages) | `UserModule` rows; enforced by intersection in `requireLocationAccess`; empty-intersection locations vanish from the switcher and 403 on direct URLs; checkboxes in Users admin |
| 10/13 | Trans in/out with cost+retail reports; main bar → satellites | Linked `Transfer` documents (below) + Transfer In/Out reports + `Location.kind` labels (Main/Satellite/Stockroom) |
| 14 | Numeric-only quantity inputs | Shared `QuantityInput` (digits + one decimal point; rejected keystrokes flash + toast) across all entry forms |
| 16 | Kitchen weighing: total − tare | `ItemVariant.weighMode = NET`: qty = net scale weight converted to the counting unit; bottles-with-liquid keep the DENSITY path |

## Transfers — design in one paragraph

A `Transfer` is a two-sided document: the **source** drafts lines from its own catalog, commits on a
`businessDate` (stock leaves its pool that day), and the **destination** confirms what actually
arrived per line (`TransferReceiptLine`, its own `receiptDate` — stock joins its pool that day).
Sent vs received may differ; the gap is deliberately left visible as the difference between the two
locations' Transfer reports. Tenant guard: destination must be an ACTIVE location of the **same
client** (checked at create/update). Module firewall: commit fails loudly if the destination's
modules don't cover a line's product type. Receiving auto-creates the destination catalog row for
the shared item variant (copy-from precedent). Corrections follow the house pattern everywhere —
void + `correctionOfId` on lines **and receipts** — and a transfer/line cannot be voided while an
ACTIVE receipt exists against it (the destination voids first: cause→effect order in the log).

Reconciliation: `ReconItemInput.transferInQty/transferOutQty` are **optional** (`?? 0`) — absent
inputs produce bit-identical output, so every pre-transfer caller and the phase-3 golden fixture
are structurally unchanged. `usage = begin + purchases + forfeits + transferIn − transferOut − end`.

## Golden fixture #2 — transfers (hand-computed; VERIFIED against the engine 2026-07-19)

Seeded by `seedTransferFixture()` (idempotent). All activity dated ≥ 2026-06-10 — the sacred
phase-3 window [2026-06-01, 2026-06-08) is untouched (re-verified cell-by-cell the same day).

- New location **Depot** (Prime Hospitality Group, kind STOCKROOM, module BAR), San Miguel 330 in
  catalog @ cost 45 / retail 120. Zero opening count committed 2026-06-08.
- **T-1**: Main Bar → Depot, businessDate **2026-06-10**, San Miguel ×**10** @45 (lineTotal 450), COMMITTED.
- Receipt at Depot: qtyReceived **8**, receiptDate 06-10, note "2 bottles broken in transit".
- Depot sells 1 @120 on 06-12. Closing counts 2026-06-15: Main Bar beer **29** (all other golden
  items repeat their 06-08 values); Depot beer **7**.

| Check (window 06-08 → 06-15) | Expected | Why |
|---|---|---|
| Main Bar beer usage | **0** | 39 + 0 + 0 + 0 + 0 − 10 − 29 |
| Main Bar beer transferOut / variance | 10 / **0** | dispatched on 06-10; nothing else moved |
| Every other Main Bar item variance | **0** | counts repeated verbatim |
| Depot beer transferIn | **8** | the RECEIVED qty, not the sent 10 |
| Depot beer usage / variance / revenue | **1** / **0** / 120 | 0 + 8 − 7 = 1 = the one sale |
| Transfer Out report (Main Bar) | 10 · ₱450 cost · ₱1,200 retail | 10 × 45 / 10 × 120 |
| Transfer In report (Depot) | 8 · ₱360 cost · ₱960 retail | 8 × 45 / 8 × 120 |
| The missing 2 (₱90 at cost) | appears **nowhere else** | visible only as Out(10) vs In(8) — that's the audit signal |

## Cost Analysis fixture (hand-computed; VERIFIED 2026-07-19)

Golden window [2026-06-01, 2026-06-08), Main Bar, **Beer** category:
Beginning 48×45 = 2,160 · Purchases 24×44 = 1,056 · Ending 39×45 = 1,755 →
**Cost 1,461** · Cost Net 1,461 ÷ 1.12 = 1,304.464286 · GROSS % = 1,461 ÷ 17,520 = **8.3390 %**
(Beverage gross sales 17,520 ≡ the Full Audit revenue grand total — equal by construction).
Note: under uniform 1.12, NET % ≡ GROSS % (the legacy's columns differed only via its dead-row
1.22 quirk — deviation #13).

The CA carries a **Transfers** column (received − dispatched at the lines' cost snapshots) so
`Cost = B + P + T − E` mirrors the usage line — without it a transfer window would show phantom
cost at the source and negative cost at the destination. Transfer-window checks (VERIFIED):
Main Bar Beer [06-08 → 06-15): 1,755 + 0 **− 450** − 1,305 = **0** (nothing consumed);
Depot Beer: 0 + 0 **+ 360** − 315 = **45** (exactly the one bottle sold).

## Billing fix case table (VERIFIED 2026-07-19, `@fnb/core/billing`)

The shipped "mark as paid" fix accepted payments across a ~2-month window, so one payment displayed
the NEXT month as paid too, and `+32 days` mis-stepped over February for day-31 anchors. Now:
period = `[due, nextDue)`, payment counts only for the period its timestamp falls in.

- Jan-31 anchor: periods [Jan 31, Mar 1) → [Mar 1, Mar 31) → … (calendar month-add, short-month → 1st)
- Paid ON the due date 00:10 → ACTIVE for the new period **only**; next rollover → GRACE (the regression case)
- Paid 3 days late → covers the period it fell in, until its next due
- Never-paid: VIEW_ONLY after 7 grace days with **no oscillation** back to GRACE (old code flipped monthly)
- First period accepts pre-start payments (paid at signup); STANDALONE unchanged (pay once)

## Done when (all verified 2026-07-19)

- [x] Phase-3 golden table reproduces **byte-identically** with the transfer columns present (all zeros in that window)
- [x] Transfer fixture reproduces the table above on both sides
- [x] Cost Analysis matches the hand-computed Beer row (incl. transfer windows) and cross-foots with the Full Audit
- [x] Billing case table passes (incl. the double-credit regression case)
- [x] Cross-client transfer creation rejected (tenant guard); module-incompatible commit rejected with item names
- [x] Receipt-first void ordering enforced (409, checked inside the $transaction)
- [x] Both workspaces typecheck clean
- [x] Live browser pass: transfers list/editor/receive, Full Audit "Variance vs Sold" + Transfers column, 19-column CSV with exporter footer, readonly 20-min TTL + watermark + export, per-user module 403 + switcher hiding, landing + login expired notice — zero console errors

## Adversarial review round (2026-07-19)

A five-dimension adversarial review of the full diff surfaced 25 findings; every confirmed one was
fixed and re-verified the same day. Highlights:
- **Cross-record reach**: draft line DELETE (transfers AND the pre-existing purchases/counts
  routes) now verifies the line belongs to the URL's document before touching it
- **Receive hardening**: duplicate line ids rejected; the already-received check moved INSIDE the
  $transaction (no TOCTOU double-receipt); destination can no longer read a source's DRAFT
- **Void loop closed in-app**: destination "Void receipt" button (receipt-first ordering is now
  satisfiable from the UI); source can discard its own DRAFT (entry-level, server-agreed)
- **Billing**: `/subscriptions/:id/reactivate` endpoint (cancel is no longer a dead end);
  startDate changes reset the payment state (no first-period re-credit of stale payments);
  Mark-as-paid button now keyed on the CURRENT period's derived state, not the stale `paid` flag;
  demote-to-READONLY clamps existing sessions to 20 minutes
- **NET weighing**: NET × contentTracked combination rejected everywhere (and inference is
  contentTracked-first as defense); NET quantities round in base grams, not scale units (an
  oz-scale no longer quantizes kitchen counts to whole ounces)
- **Cost Analysis**: transfers valuation added (see fixture above)
- **UI**: cleared receive field = error, not "receive everything"; negotiated-price decimals no
  longer clobbered mid-keystroke; QuantityInput validates the post-selection value; day-0 due
  copy unified ("Due today"); signed-in-but-unassigned users get an explicit notice on the landing

**Client decisions still open** (surface at the next check-in): transfer design sign-off (no legacy
precedent — deviation #11), CA VAT treatment sign-off (deviation #13), flyer/video/Facebook assets
(placeholders wired, five-minute swap when they arrive).
