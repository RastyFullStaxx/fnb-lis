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

It is a **local mirror**. What makes that tractable — and what would otherwise make it a
distributed-systems project — is the single sentence *"one (1) client computer"* plus *"sole
operational interface"*: **there is exactly one writer per establishment.** Two-way merge never
arises. The hard problem was designed out by the proposal, not by us.

> **The rule this rests on:** an establishment uses the desktop **or** the browser, never both. The
> moment the same location is written from two places, concurrent-edit merge comes back and none of
> this design holds. Enforcing that is a licensing/operations decision, not a code one — but it is
> the assumption the whole architecture stands on.

## 2. Ownership — who is allowed to write what

This is the whole design in one table. It is not new: it falls straight out of the existing schema
split, which is why the mirror fits without restructuring anything.

| Data | Owner | Direction | Why |
| --- | --- | --- | --- |
| `Unit`, `Category`, `Item`, `ItemVariant` (incl. tare/density weights) | **Server (LIS)** | server → device, overwrite | `ItemVariant` is **global** — no `clientId`. It is LIS's calibration library, shared by every tenant. A device that edited it would silently rewrite another establishment's numbers. |
| `Client`, `Location`, `Subscription`, users, roles, modules | **Server** | server → device, overwrite | Commercial and access state. Only the LIS admin changes it. |
| `LocationItem` (the catalog: cost, retail, par, per-location weight overrides) | **Server** | server → device, overwrite | Client-owned but managed through the admin/catalog screens. Kept one-way to preserve "one writer per row". |
| `CountSession`/`CountLine`, `Purchase`/`PurchaseLine`, `SaleRecord`, `Forfeit`, `Transfer`/`TransferLine`/`TransferReceiptLine` | **Device** | device → server, append-only | The nightly work. Append-only already (void + `correctionOfId`), so there is nothing to merge. |
| `ActivityLog` | Both, append-only | device → server | Never updated, so two writers cannot collide. |

Every row has exactly one writer. That is the property that makes a plain overwrite in one
direction and a plain append in the other correct, with no merge logic anywhere.

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

Verified end to end by `npm run verify:sync -w @fnb/server` — 30 checks against a throwaway
database, covering every row above.

## 5. Built vs. still to build

**Done (server side, this phase):**

- `Device` model, registration on first login (trust-on-first-use, licence-capped), revocation
- Device-bound sessions: 1 year, non-sliding, revoked-checked on every request
- `occurredAt` on every device-writable model + `ActivityLog`
- Client-supplied ids accepted and made idempotent on every create and correction route
- `GET /sync/snapshot`, `POST /sync/ack`
- `npm run verify:sync -w @fnb/server`

**Still required before the desktop ships:**

- **Offline authentication — an open decision.** The snapshot deliberately carries users as
  *display data only* (`id, username, name, role`), never `passwordHash`. Letting staff sign in
  with no network means either shipping password hashes to a bar PC, or a device-local PIN, or
  keeping one long-lived operator session. That is a security call for the client to make, not a
  side effect of building a snapshot. **This blocks the desktop; nothing else here does.**
- **Physical Count Sheets** (§3.11) — printable, by category or alphabetical. More important on a
  single-computer install than on the web: if that one machine dies mid-count, paper is the only
  fallback for the entire establishment.
- **Licence binding** (§20) — the server half exists (`maxDevices`, fingerprint, revocation); the
  Electron half is enforcement at startup.

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
   single-computer install, paper is the only fallback that survives the computer.

### Schema evolution with a device in the field

A desktop can be weeks behind. Two rules keep that safe, and both are already project law:

- **Migrations stay additive** (architecture.md §2). A device running last month's build must not
  choke on a snapshot from this month's server — extra fields are ignored, missing ones are null.
- **Never alter reconciliation math without re-verifying the fixtures** (README). A device computing
  a Full Audit locally makes this sharper, not softer: the same inputs must produce the same
  numbers on the server and on the bar PC, or the report the client trusts most disagrees with
  itself. `packages/core` has zero Prisma or server imports precisely so the identical code runs in
  both places.
