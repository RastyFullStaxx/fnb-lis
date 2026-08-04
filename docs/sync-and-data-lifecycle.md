# Sync & data lifecycle — the offline desktop mirror

How the Electron desktop and the server share data, and how that data is kept safe over years.
**Written before any Electron code exists**, on purpose: the schema decisions here are migrations
against a live database, and they are far cheaper now than after a desktop is in a bar.

Companion to [architecture.md](architecture.md) (data model) and
[golden-fixtures.md](golden-fixtures.md) (the numbers none of this may move).

---

## 1. The decision: a local mirror, not a write buffer

Proposal §18 sells the desktop as running on **"one (1) client computer"**, as the establishment's
**"sole operational interface"**, with **"full offline capability with local SQLite storage"**.

Two readings were possible:

- **Write buffering** — the desktop queues writes and is otherwise a thin client. Cheap, but it
  cannot show a Full Audit offline, which is the one thing the client actually trusts.
- **Local mirror** — the desktop holds a real copy and computes everything locally. What §18
  describes.

It is a **local mirror**. The original reasoning was that §18's *"one (1) client computer"* plus
*"sole operational interface"* guaranteed exactly one writer per establishment, so two-way merge
never arose.

That guarantee is gone — the client now wants the browser and the desktop usable together (§7). What
survives, and is the more durable reason this works, is that **almost every write in this system is
an append**. Two writers inserting different rows have nothing to merge. The genuinely mutable
surface is small enough to enumerate, and §7 enumerates it.

> **Superseded 2026-07-30.** This document originally required that an establishment use the desktop
> **or** the browser, never both. The client asked for both, with changes flowing each way. That is
> tractable — most of this system is append-only, so most of it cannot conflict — but it is a real
> change to the assumptions below. **§7 is the authority on two-way operation**; read it before
> changing anything in §2–§4.

## 2. Ownership — who is allowed to write what

This is the whole design in one table. It is not new: it falls straight out of the existing schema
split, which is why the mirror fits without restructuring anything.

| Data | Owner | Direction | Why |
| --- | --- | --- | --- |
| `Unit`, `Category`, `Item`, `ItemVariant` (incl. tare/density weights) | **Server (LIS)** | server → device, overwrite | `ItemVariant` is **global** — no `clientId`. It is LIS's calibration library, shared by every tenant. A device that edited it would silently rewrite another establishment's numbers. |
| `Client`, `Location`, `Subscription`, users, roles, modules | **Server** | server → device, overwrite | Commercial and access state. Only the LIS admin changes it. |
| `LocationItem` (the catalog: cost, retail, par, per-location weight overrides) | **Server** | server → device, overwrite | Client-owned but managed through the admin/catalog screens. Kept one-way to preserve "one writer per row". |
| `ClientItemUnitDefault`, `UserItemUnitPreference` (per-item display unit — admin default, staff override) | **Server** | server → device, overwrite | A manager's or staff member's Settings-page pick, same shape as `LocationItem`: written from a desk, not a device, and read-only everywhere else. Display only — no reconciliation, weighing, or pricing value ever passes through either table. Client req 2026-07-31 (`docs/per-user-per-item-uom-plan.md`). |
| `CountSession`/`CountLine`, `Purchase`/`PurchaseLine`, `SaleRecord`, `Forfeit`, `Transfer`/`TransferLine`/`TransferReceiptLine` | **Device** | device → server, append-only | The nightly work. Append-only already (void + `correctionOfId`), so there is nothing to merge. |
| `ActivityLog` | Both, append-only | device → server | Never updated, so two writers cannot collide. |

**As of §7 this table is the *default*, not an invariant.** Master data (the first three rows) stays
server-authoritative and one-way — that part still holds, and Rule 3 in §7.2 is what keeps it true.
The transactional rows are now written from both sides, which is safe because they are append-only;
the four places that are *not* pure appends are listed in §7.1 and closed by the rules that follow
it.

## 3. The two flows

### Pull — `GET /api/locations/:locationId/sync/snapshot`

A **whole-location snapshot**, not a "changes since X" feed. Deliberately.

A location is a couple of hundred catalog rows and a few thousand transactions — a megabyte or two
of JSON. Replacing the local copy outright on reconnect has no drift failure mode, and needs
neither `updatedAt` columns nor tombstones to notice that something was deleted or deactivated.
An incremental cursor would need both, plus the bug surface that comes with them, to save a
download that takes under a second.

`?from=YYYY-MM-DD` bounds it when history grows. This works because **committed periods are
immutable**: the desktop keeps what it has already pulled and asks only for the open tail. See §6.

### Push — the ordinary create routes

**There is no push endpoint.** The device replays the normal `POST /sales`, `POST /counts/:id/lines`
and so on, carrying record ids it minted itself. Those routes are idempotent, so a retried upload
converges instead of duplicating. Reusing them means the desktop cannot drift from the browser's
validation, permissions or activity logging — there is only one write path to get right.

`POST /sync/ack` marks the batch done (`Device.lastSyncAt`), so an admin can see how much work is
stranded on a machine that has gone dark.

## 4. Failure cases, and what answers them

| Failure | What happens | Mechanism |
| --- | --- | --- |
| Connection drops mid-upload; device retries | The already-written records return `200` with their existing rows; only the unwritten ones are created | `syncFields.id` + `lib/idempotency.ts`. **The record's primary key IS the idempotency key** — the device mints a cuid before writing locally, so a record has one identity from the moment it exists. No separate token table, and so no retention policy for one. |
| Device replays an id belonging to another establishment | `409`, nothing written | `replay()` takes the ownership predicate as a **required argument**, so eight create routes cannot become eight chances to forget the tenant check |
| Desktop offline for three weeks | Still signed in | Device sessions last a year and do not slide (`DEVICE_SESSION_TTL_MS`). The 7-day browser session would have locked the bar out of its own till |
| Machine stolen or decommissioned | Cut off at its next contact with the server | `Device.status` is checked on **every** request, and `POST /admin/devices/:id/revoke` deletes its sessions in the same transaction. This check is what makes a year-long token acceptable |
| Offline work all syncs at 9pm | The audit trail still shows when it really happened | `occurredAt` (device) is stored separately from `createdAt` (server receipt). Reconciliation is unaffected either way — every report keys off the business date, which is `TEXT` and always came from the user |
| Desktop clock is wrong | A far-future `occurredAt` is rejected | `syncFields` refine, ±1 day of slack. A device is not a trusted clock |
| Someone tries to license a second machine | `403` naming the cap | `Subscription.maxDevices`, default 1 (§18) |
| Staff member sets up a new machine themselves | `403` | Registration needs `devices.manage` (ADMIN/OWNER). Consuming a licence slot is a commercial act |

Verified end to end by `npm run verify:sync -w @fnb/server` — 45 checks against a throwaway
database, covering every row above plus the PIN and attribution rules in §5a/§5b.

## 5. Built vs. still to build

**Done (server side, this phase):**

- `Device` model, registration on first login (trust-on-first-use, licence-capped), revocation
- Device-bound sessions: 1 year, non-sliding, revoked-checked on every request
- `occurredAt` on every device-writable model + `ActivityLog`
- Client-supplied ids accepted and made idempotent on every create and correction route
- `GET /sync/snapshot`, `POST /sync/ack`
- `npm run verify:sync -w @fnb/server`

- **Offline authentication: a device PIN** — decided and built, see §5a
- **Attribution**: the acting user on a device session, see §5b
- **Physical Count Sheets** (§3.11) — blind printable sheet, by category or alphabetical

**Still required before the desktop ships:**

- **Licence binding** (§20) — the server half exists (`maxDevices`, fingerprint, revocation); the
  Electron half is enforcement at startup.
- The Electron app itself: local SQLite, the PIN keypad, the sync loop.

### 5a. Offline authentication — the device PIN

**The rejected option first, because it is the obvious one.** Ship `User.passwordHash` in the
snapshot and verify it locally. It needs no new concepts and it is wrong: the secret on the bar PC
would be *the same secret* that logs into the web application, so stealing one computer becomes
remote access to the establishment's books. Scrypt makes cracking slow, not impossible, and a staff
password of `paolo123` does not survive it.

**What was built instead:** a separate `DevicePin` credential.

| Property | Consequence |
| --- | --- |
| Accepted only by the desktop, **never** by the server | A stolen PIN unlocks a machine the thief already physically holds. Blast radius stops there |
| 4–8 digits, guessable PINs refused (`validatePin` in `@fnb/core`) | The realistic attacker is a coworker who watched you type, not a cracking rig |
| Policy lives in `@fnb/core` | The Electron app applies the identical rule, so a PIN the desktop accepts cannot be one the server would reject |
| Set from the browser (Settings → Offline desktop PIN), any role | STAFF are exactly who stand at the bar PC at 2am |

**Be honest about what it is not.** Four digits will not survive an offline attack on the file, and
it is not meant to. Whoever holds the machine holds the mirror — encryption at rest answers that, not
a longer PIN. What the PIN buys is casual-access control, attribution, and a blast radius of one
revocable device.

**Forgetting it**, in the order these actually get used:

1. **Online** — set a new PIN with your password. This is the normal path; the network is usually up.
2. **A manager clears it** — `DELETE /api/admin/users/:id/pin` (`users.manage`). Stronger than any
   security question, because it requires a second human who is physically present.
3. **Offline break-glass** — a recovery question the user *writes themselves*, because shipping a
   canned "mother's maiden name" list is how that becomes the weakest link. Reserved for the case
   that actually happens: no network, PIN forgotten, and the closing count still has to be done.
   Rate-limited on the same 5-attempt/1-hour lockout as login, and **every use writes a
   `pin.recover` activity row that syncs to the admin**. A break-glass with an alarm on it is a
   different thing from a back door.

### 5b. Attribution — one machine, many people

A desktop holds **one** session, opened when the owner registered it, but a whole shift uses it.
Nineteen routes read the session user for `createdById`, so without intervention every count line
from that machine would carry the owner's name. An audit trail that credits one person for
everyone's work is worse than none: it is a confident lie.

The desktop sends `X-Acting-User`; `sessionMiddleware` swaps in that person once, centrally. Because
the substitution happens at the session layer, **permissions follow the real actor too** — a STAFF
member on the owner's device session still cannot void a record.

The trust boundary, stated plainly: a registered device is trusted to assert which of **its own
client's** users is acting, because offline there is nobody else to ask — the PIN check happened on
the machine, against hashes it was given. Bounded **four** ways: the header is ignored unless the
session is device-bound, the named user must belong to that device's establishment, an unrecognised
claim is a 403 rather than a silent fallback, and — added 2026-08-01 — **the claim may only NARROW
privilege, never widen it**. A browser session cannot use the header at all.

That fourth bound closes a real escalation. The header used to adopt the claimed user's *role*
outright, and a device session is not owner-only: `resolveDevice` hands an already-registered
machine to any user of the establishment, checking `devices.manage` only when registering a new one.
So an ordinary STAFF sign-in on the bar PC was one header away from holding `users.manage`. The role
is now capped at the session holder's own, which leaves the real workflow untouched — the desktop's
one session belongs to the owner who registered it, and everyone acting under it is at or below
that.

> **Login contract changed 2026-08-01 — the Electron client must handle it.** A device login is no
> longer exempt from two-factor authentication. `POST /api/auth/login` may now answer
> `{ mfaRequired: true, challenge, expiresAt }` instead of a session, and the desktop must exchange
> that at `POST /api/auth/mfa/verify` with a code. The device payload it sent in step one is carried
> through automatically (`MfaChallenge.deviceJson`), so nothing else changes and the machine is
> registered only once both factors are proved.
>
> The old exemption keyed off `device` in the request body — data the caller supplies — so a phished
> password plus an invented fingerprint bought a full 365-day session with no code. See
> [security.md](security.md) H-4.
>
> This costs the offline story nothing: registration and sign-in happen at the server, over the
> network, with the owner standing at the machine. Once registered, the desktop verifies PINs
> locally and does not re-authenticate here.

**Deliberately not built:** `updatedAt`/tombstones/cursor sync (§3 explains why), a separate push
endpoint, an idempotency-token table, and the event-sourcing rewrite the proposal's language
gestures at. The system already has the two properties event sourcing would buy — stock is
*computed*, never stored, and committed records are immutable.

---

## 6. Long-term data lifecycle

The append-only tables only ever grow. None of this is urgent, all of it is cheaper to decide now.

### Growth, measured not guessed

An establishment counting weekly across ~200 items generates roughly **10–15k transactional rows a
year** (count lines dominate; sales come in batches from imports). At SQLite's row sizes that is
single-digit megabytes annually. **A five-year-old install is still a file you can email.**

The conclusion matters: there is no archival emergency coming, and no justification for building
partitioning, cold storage, or a warehouse. The risks worth planning for are *report latency* and
*backup discipline*, not disk.

### Retention: keep everything, bound what is *carried*

Audit data is the product. Deleting a committed period would destroy the thing the client pays for,
and would break the golden fixtures, which reach back to 2026-06-01 permanently.

**Policy: committed records are never deleted, on the server or on a device.** What gets bounded is
what a *device carries*, via `?from=` — and only because committed periods are immutable, so the
desktop's copy of a closed period can never be stale. Two things do age out:

| Data | Retention | Why |
| --- | --- | --- |
| `AuthSession` | Deleted on expiry (already) | Credentials, no audit value |
| `ImportBatch.rawExtractJson` | Prunable after the batch is COMMITTED or REVERSED | Raw AI extraction payloads are the largest rows in the schema and have no value once reviewed. Not yet implemented — the first real size problem, if one appears |
| `ActivityLog` | Keep indefinitely | It is the audit trail. Fast-growing but small per row |
| Everything else | Forever | The product |

### Report latency, the real long-term risk

`buildFullAudit` recomputes from raw records every time. That is correct and it is why the
fixtures hold — but its cost grows with history, and the proposal already anticipates this
(§14.5 snapshot caching).

**When to act:** when a Full Audit over a closed period takes more than ~2 seconds. **What to do
then:** cache per-period *totals* keyed by `(locationId, begin, end)`, invalidated whenever a
record in that window is written or voided — never cache a computed *variance* as source of truth.
The recomputation from records must stay the authority, or the fixtures stop meaning anything.

### Backup — the actual exposure

A local mirror puts a real copy of an establishment's books on a computer in a bar. The failure
that costs a client their data is not schema growth, it is that machine dying with unsynced work on
it. Three things follow, in priority order:

1. **Sync often.** `Device.lastSyncAt` exists so an admin can *see* a machine that has stopped
   pushing. Surfacing that in the admin UI is worth more than any retention policy here.
2. **Back up the server DB.** SQLite in WAL mode: `VACUUM INTO` a dated file. It is one file; there
   is no excuse for not having yesterday's.
3. **Count sheets are the disaster plan.** Restated from §5 because it belongs here too: on a
   single-computer install, paper is the only fallback that survives the computer. Reports →
   Physical Count Sheet, and it is deliberately **blind** — no expected quantities, no values.
   Printing the expected figure beside an empty box is how you get people copying the system's
   number instead of counting the shelf, and the gap between those two numbers is the product.

### Schema evolution with a device in the field

A desktop can be weeks behind. Two rules keep that safe, and both are already project law:

- **Migrations stay additive** (architecture.md §2). A device running last month's build must not
  choke on a snapshot from this month's server — extra fields are ignored, missing ones are null.
- **Never alter reconciliation math without re-verifying the fixtures** (README). A device computing
  a Full Audit locally makes this sharper, not softer: the same inputs must produce the same
  numbers on the server and on the bar PC, or the report the client trusts most disagrees with
  itself. `packages/core` has zero Prisma or server imports precisely so the identical code runs in
  both places.

---

# 7. Two-way operation — browser AND desktop, both writing

**Requirement (client, 2026-07-30):** the desktop is a full replica of the web app. Both are usable
at the same establishment. The desktop additionally works offline; its changes push when the network
returns, and it receives what happened elsewhere meanwhile.

This section is the plan for that. It supersedes the single-writer rule in §1.

## 7.1 The good news, stated first

**Most of this system cannot conflict, because most of it is append-only.**

Every sale, forfeit, count line, purchase line, transfer line and receipt is an INSERT with a
globally-unique id. Two sources inserting different rows never collide — there is nothing to merge.
Corrections are already void-plus-replacement rather than edits, so even "changing" a committed
record is an append. That is not luck; it is the ledger discipline the project has enforced since
day one, and it is what makes this request cheap rather than a rewrite.

Auditing every mutating route, the conflict surface is **four things**:

| # | Surface | Routes | Count |
| --- | --- | --- | --- |
| A | Hard deletes of draft lines | `DELETE` count / purchase / transfer line | 3 |
| B | Mutation of open work | `PUT` purchase header, transfer header, count line | 3 |
| C | Status transitions | `commit` x3, `void` x7 | ~10 |
| D | Catalog and master edits | `PUT` location-item, supplier, menu | 3 |

Everything else — the overwhelming majority of writes — is already safe. The rules below exist to
close exactly A, B, C and D.

## 7.2 The four rules

### Rule 1 — Open work belongs to where it started (closes A and B)

Add `originDeviceId` to `CountSession`, `Purchase`, `Transfer` (null = the browser). **While the
document is OPEN or DRAFT, only its origin may add, edit, delete or commit its lines.** The other
side sees it read-only: *"Count in progress on Front bar PC."*

This deletes conflict classes A and B outright rather than resolving them, and it matches reality —
one person is walking round with the scale. Merging two people's edits to the same in-progress count
is a problem worth not having.

**Escape hatch, required:** an ADMIN/OWNER can force-release a stranded draft (the bar PC died
mid-count). Explicit, confirmed, logged. Without it a dead computer freezes an open count forever.

### Rule 2 — The server decides status, and says so (closes C)

Commit and void become compare-and-set: the client sends the status it believes is current, and a
mismatch is a `409` carrying the actual server state. **Never auto-resolve** — the device raises it
in the conflict inbox (Rule 4) for a human.

This needs the one thing §4 was proud of not needing: **a real idempotency-token table**. For creates
the primary key answers "did this already apply?" for free. A void is not a new row, so there is no
key to collide — and a replayed void is indistinguishable from someone else's void without one.
Add `SyncOp(opId, userId, appliedAt, result)`, written in the same transaction as the mutation;
`opId` travels on commit/void/correct requests. **This table has a retention policy** (see §7.6) —
it is the only table here that does.

### Rule 3 — Catalog and master data stay server-authoritative (closes D)

`LocationItem` is the only genuinely mutable shared row that matters, and it carries cost and retail
— the inputs to every valuation. Last-write-wins on a price is how an establishment's stated
inventory value changes without anyone deciding to change it.

**Offline the desktop can count, sell, receive and forfeit. It cannot re-price, re-weigh, edit
suppliers or edit recipes.** Those need connectivity. This is a genuine limitation and it is the
right trade: pricing is a management action taken at a desk, not a thing done at 2am with a scale.

*If the client rejects that:* fall back to field-level last-write-wins keyed on `updatedAt`, and log
both the old and the new value on every merge so a surprise price is traceable. Do not do it
silently.

### Rule 4 — Nothing is ever silently dropped

Every push the server rejects lands in a **conflict inbox**: the local record, the server's reason,
the current server state, and the choice. A sync that quietly discards a staff member's work is
worse than one that fails loudly, because the count still balances — against the wrong numbers.

## 7.3 The mechanisms this needs

| Mechanism | Why | Status |
| --- | --- | --- |
| `originDeviceId` on CountSession/Purchase/Transfer + `assertMayEditDraft` | Rule 1 | **Shipped** |
| `POST /drafts/:entity/:id/release` | Rule 1 escape hatch — a dead machine must not freeze a count open forever | **Shipped** |
| `SyncOp` + `opId` + `expectedStatus` (`assertExpectedStatus`) | Rule 2 | **Shipped** |
| `holdParentOpen` + `transitionStatus` (`src/lib/two-way.ts`) | Rule 2, the *concurrent* half. `assertExpectedStatus` compares the client's belief against a status read **outside** any transaction, which closes offline divergence but not a race. See the note below. | **Shipped** |
| `SyncOp` pruning on `/sync/ack` | §7.6 — a retention policy that exists only in a document is not one | **Shipped** |
| `assertNotQueuedEdit` on catalog/supplier edits | Rule 3 | **Shipped** |
| `originDeviceId` on SaleRecord/Forfeit + `GET /sync/duplicates` | §7.4 provenance and double-entry review | **Shipped** |
| `GET /sync/status` | §7.5 staleness — which machines are holding unpushed work | **Shipped** |
| **Ordered outbox** with causal dependencies | A void must not reach the server before the record it voids; a line must not precede its session. Push in creation order, and when one operation fails, stop **that chain** while independent chains continue | Electron |
| **Merge-on-pull, not replace** | §3's snapshot replaces the local copy wholesale. With local unsynced work that would destroy it. Rule: replace everything **except** rows still in the outbox | Electron |
| **Conflict inbox** | Rule 4 — the UI that shows a human what the server rejected | Electron |
| Idempotent creates, `occurredAt`, device identity, PIN, attribution | Phases 35–36 | **Shipped** |

`updatedAt` on the three headers was planned here and **dropped**: `status` already *is* the version
for these documents, and Rule 1 means an open draft has no concurrent editor. It would have been a
column nothing read.

### Why Rule 2 needed a second mechanism (2026-08-04)

`assertExpectedStatus` answers "did this change while the device was offline?" It cannot answer
"is it changing *right now*", because the status it compares was read outside any transaction. That
left a real window on every line route: the `status !== "OPEN"` check passed, then a commit landed,
then the insert wrote — attaching a line to a **committed** count. Its ending quantity moves after
the audit period closed, and the `count.commit` summary's "(N lines)" is already wrong. Nothing
downstream can detect it; the row looks entirely ordinary.

Rule 1 makes this rare but not impossible, and the case it does not cover is exactly the one the
desktop creates: a device **replaying its outbox** is not the interactive editor Rule 1 reasons
about, so its queued line can arrive while a manager commits the same count in the browser.

Two closures, both in `src/lib/two-way.ts`:

- **`holdParentOpen`** — before the line write, a *conditional self-write* on the parent:
  `UPDATE … SET status = 'OPEN' WHERE id = ? AND status = 'OPEN'`. It changes nothing (and none of
  the three headers carries `@updatedAt` to disturb — see the paragraph above, which is why that
  column's absence matters more than it looked), but it is a real write, so SQLite takes the row's
  write lock and holds it for the rest of the transaction. Both orderings become correct rather than
  merely unlikely: line-then-commit → the commit counts the line; commit-then-line → zero rows
  matched, `409 STATUS_CONFLICT`.
- **`transitionStatus`** — the commit/void flip itself becomes compare-and-set, as this rule asked
  for in so many words. The flips were unconditional `update({ where: { id } })`, so two commits
  arriving together both passed the pre-check and both wrote, the second silently overwriting
  `committedAt`/`committedById` — the trail crediting the wrong person at the wrong time.

Covered: line create, edit and delete, plus the header edit, on all three documents; and every
commit and void flip. Proven by `npm run verify:races -w @fnb/server`, which drives the two
transactions directly and pins the interleaving — an HTTP race almost always ends at the outer
pre-check instead, so it cannot demonstrate the guard at all.

> **Phase 39 (adversarial review) changed four things above.** The snapshot is
> now **device-sessions-only** — it carries PIN hashes, and ordinary location
> access was not a sufficient gate. It now ships **full** Location/Client rows
> plus an `identity` block (subscription, clientAccess, userModules,
> **locationModules**) — without those the mirror boots and then 404s every
> call, and a missing module set reads as *unrestricted*, which would have made
> the offline Full Audit disagree with the server's. `unitCost`/`unitRetail` on
> count lines and `recipeVersionId` on sales are now sent by the device, because
> the server was minting them at PUSH time — restating a Monday count with
> Wednesday's prices. And `resolveActingUser` no longer rejects disabled users,
> which had silently contradicted §7.5.

**The browser-side UI for all of this is deliberately deferred** to the Electron phase. With no
registered device, `originDeviceId` is null everywhere, `anyStale` is always false and the duplicate
report is always empty — there is nothing to render yet. The server rules are enforced and
verified now, because they are migrations and route logic; the screens that surface them are
built when there is state to surface.

## 7.4 What sync cannot fix

**Two people recording the same real-world event.** Staff records a 10-bottle delivery on the
desktop; the manager records the same delivery in the browser. Two records, different ids, both
valid, both counted. **This is not a sync bug and no merge algorithm can resolve it** — those two
rows are indistinguishable from a genuine repeat delivery.

The old single-writer rule prevented this structurally. Removing it means accepting the risk and
mitigating it in the product, not in the sync layer:

- **Detect and warn:** same `locationItemId` + business date + quantity + kind, recorded from a
  different source within a short window, flagged at entry time and listed in a review report.
- **Show provenance:** every record displays where it came from (this bar PC / the web). An auditor
  chasing a double-counted delivery needs that on screen, and `ActivityLog.deviceId` already carries
  it.
- **Say it out loud to the client.** This is the one genuine cost of the change, it lands on their
  variance figures, and they should hear it before it happens rather than after.

## 7.5 Edge cases, and the decided handling

**Concurrent work**

| Case | Handling |
| --- | --- |
| Both sides record different sales | Both land. No conflict — different ids, pure inserts |
| Both sides record the *same real* delivery | Not resolvable by sync. Detect, warn, show provenance (§7.4) |
| Desktop commits a count offline; browser voids it meanwhile | Push carries expected status, gets `409`, goes to the conflict inbox. Never auto-applied |
| Both sides void the same record | `opId` distinguishes *my replay* (200) from *someone else's void* (409, inbox) |
| Browser tries to edit a count open on the desktop | Read-only, labelled with the machine holding it (Rule 1) |
| Desktop dies mid-count, draft stranded | ADMIN/OWNER force-release, logged (Rule 1 escape hatch) |
| Two devices at one client, both offline, both counting | Rule 1 stops cross-editing; two sessions for one date is the §7.4 duplicate problem |

**Ordering and referential integrity**

| Case | Handling |
| --- | --- |
| Sale created offline, then voided offline | Outbox preserves causal order: the create pushes before the void |
| Correction chain (`correctionOfId`) pushed out of order | Same — parent first. A broken chain stops that chain only |
| Count lines pushed without their session | Parent-before-child ordering; an FK failure here is an outbox bug, not a conflict |
| Push dies halfway | Idempotent creates make the retry converge (shipped). `opId` does the same for voids |
| Device references a catalog row deactivated meanwhile | Fine — catalog rows are `isActive`-flagged, never hard-deleted |

**Stale authorisation** (the desktop's copy of who-may-do-what can be hours old)

| Case | Handling |
| --- | --- |
| User disabled in the browser while the desktop is offline | They keep working locally until sync. **Accept their pushed records** — the work really happened, and destroying it would falsify the audit — then flag the batch for review |
| User's role changed offline (e.g. demoted) | The server re-checks permission at push time, so a demoted user's void is rejected and goes to the inbox. Correct, and it is why permissions are enforced at push rather than only in the UI |
| PIN changed or cleared in the browser while the desktop is offline | The old PIN keeps working on that machine until it next syncs. Accepted and documented: a device that cannot reach the server cannot learn its credential changed. This is why revocation is at the *device* level, which is checked on every request |
| Subscription goes past due mid-offline-stretch | **Accept pushes of work recorded before the lockout** (by `occurredAt`) and flag them; block new work after. Refusing outright strands real audit records to enforce a billing state |

**Reporting — the case that matters most here**

| Case | Handling |
| --- | --- |
| Desktop computes a Full Audit from a mirror that is hours stale | **Every desktop screen shows "synced &lt;time&gt;".** The Full Audit specifically refuses to print or export while unsynced changes exist, or when the last sync predates the period being reported — overridable only with an explicit, watermarked "unsynced draft". This is the one report the client trusts above all, and a stale copy of it is the most dangerous artefact this feature can produce |
| Desktop and server disagree on a computed figure | They must not. `packages/core` has zero Prisma/server imports precisely so identical code runs in both places. **Run the golden fixtures against the device's local database too** — same two anchors, same numbers, or the mirror is wrong |

**Clocks**

| Case | Handling |
| --- | --- |
| Device clock wrong | `occurredAt` already rejects anything more than a day in the future. Business dates are user-entered TEXT and unaffected by clock drift |
| Device clock wrong *and* the user accepts a defaulted business date | Not caught. Surface the device's date on the entry screen so a wrong one is visible before it is filed |

## 7.6 Retention (extends §6)

`SyncOp` is the first table here that must **not** be kept forever. It exists only to recognise a
replayed operation, and an operation is never replayed after its device has synced past it.

**Policy: prune `SyncOp` rows older than 90 days** — comfortably longer than the longest plausible
offline stretch, and bounded so the table cannot grow with history the way the ledger does.
Everything else in §6 is unchanged: committed records are still never deleted.

## 7.7 Suggested build order

Each step is independently useful and independently verifiable. None requires the Electron app to
exist yet, and all of them are testable through `verify:sync`.

1. **`originDeviceId` + `updatedAt` on the three headers**, and enforce Rule 1 server-side. One
   migration, and immediately meaningful even before a desktop exists — it makes "who is holding
   this draft" answerable.
2. **`SyncOp` + `opId` on commit/void/correct**, with compare-and-set status transitions. Closes the
   ambiguity between a replay and a genuine conflict.
3. **Block catalog/master mutation from device sessions** (Rule 3). A guard, not a feature.
4. **Duplicate-entry detection + provenance display.** The mitigation for the one risk sync cannot
   carry.
5. **Staleness rules on the Full Audit.** Server-side flags; the desktop enforces the refusal.
6. **Outbox, merge-on-pull, and the conflict inbox.** These live in the Electron app, and are the
   point at which it starts being written.

---

## 7.8 What one cycle actually does

Corrected 2026-07-31, after finding that three of these steps existed only on
paper — the code shipped, ran clean, reported "synced", and did not do them.

```
push  →  reconcile (+ re-queue)  →  ack  →  pull  →  MERGE  →  advance cursor
```

- **push** replays the outbox in sequence order. Order is causal, so a hard
  failure stops the run rather than skipping ahead.
- **reconcile** asks the server which ids this device believes it pushed never
  arrived, and **puts those entries back in the queue** by clearing `pushedAt`.
  Replay is safe: every create route is idempotent on the client-supplied id, so
  a replay of something that did land answers 200 instead of duplicating.
  *Previously the answer was counted and discarded — a device that lost a
  request stayed permanently un-synced with no route back.*
- **ack** only when the queue drained AND nothing was missing, so
  `Device.lastSyncAt` never advertises a sync that did not happen.
- **pull + MERGE** applies the snapshot to the mirror, skipping any row this
  device still holds unpushed work on — the server's copy of such a row is older
  than the local edit by definition, and `INSERT OR REPLACE` would discard the
  newer one silently. *Previously the snapshot was fetched and thrown away: after
  first-run provisioning the mirror never received another byte from the server.
  A void entered in the browser, a corrected line, a new price — none of it
  reached the bar PC, while the desktop's Full Audit went on reporting the
  numbers it was provisioned with.*
- **cursor** (`_sync_state.lastPullAt`) advances only after a merge succeeds and
  lives in the mirror, not `config.json`. *Previously it came from an env var
  read once at boot: the utility process cannot write config (safeStorage is in
  the main process), so `since` stayed frozen at the value first-run setup saw,
  for the life of the install.*

The merge runs even on a stalled cycle. Inbound truth does not depend on
outbound success, and a device that cannot push is precisely the one whose
operator most needs to see what the office changed.

**Known lever, deliberately unused.** The snapshot is whole-location by design
(see the endpoint's own note in `routes/sync.ts`). `from` bounds history if a
client ever accumulates enough for that to hurt; at a megabyte or two per
location it is not worth the complexity yet. This is why a cycle applies the
same row count each time rather than a shrinking delta — `since` adds late edits
to old periods back in, it does not narrow the window.
