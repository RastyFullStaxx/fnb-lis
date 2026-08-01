# Security

What is true about this system's security today, what was found in the audit of 2026-08-01, and
what is deliberately still open.

Two companion documents:

- **[security-runbook.md](security-runbook.md)** — deployment checklist, backup/DR, incident response
- **[security-mfa.md](security-mfa.md)** — the integrations left ready to connect (TOTP, email, WAF/CDN)

Run the harness after touching anything in this document's scope:

```bash
npm run verify:security -w @fnb/server
```

119 checks against the real Hono app on a throwaway database. Same shape as `verify:seed` and
`verify:sync` — one runnable script, exits non-zero when a guarantee breaks. Runs in CI on every
push.

The last of those checks enumerates **every route the app registers** and probes each one
unauthenticated, so a new endpoint that ships without a guard fails the build rather than waiting
for a reviewer to notice.

---

## 1. What this system is actually protecting

Threat modelling is worthless in the abstract, so state the assets first. In rough order of how
much damage their loss does:

| Asset | Why an attacker wants it | Where it lives |
|---|---|---|
| **The audit trail** | This product's entire value is that its numbers are trustworthy. An attacker who can *edit history quietly* destroys the product, not just one client's data | `ActivityLog`, plus the void/`correctionOfId` chains |
| **Cross-tenant separation** | One LIS server holds many competing bars' cost prices, margins, and supplier terms | `Client` scoping on every route |
| **Device PIN hashes** | Offline sign-in credentials for a whole establishment, shipped to bar PCs | `DevicePin`, `/sync/snapshot` |
| **Session cookies** | Direct impersonation, no credential needed | `AuthSession`, `fnb_session` cookie |
| **Password hashes** | Reused elsewhere by the same humans | `User.passwordHash` |
| **Commercial config** | Subscription tiers, negotiated prices | `Subscription` |

The distinctive risk here is **not** data theft. It is **silent tampering**. A bar manager who can
adjust a variance after the fact, or a staff member who can make a night's shrinkage disappear, is
the realistic adversary — closer than any internet attacker. That shapes the priorities below:
append-only records, an audit trail written in the same transaction as the mutation, and
attribution that cannot be forged all rank above, say, a perfect CSP.

### Trust boundaries

```
                      ┌─────────────────────────────────────┐
   Browser (SPA)  ───►│  originCheck ─ rateLimit ─ session   │
                      │  ─ requireAuth ─ requireLocationAccess│──► Prisma ──► SQLite
   Desktop (Electron)►│  ─ requirePermission                  │      (single process, WAL)
                      └─────────────────────────────────────┘
                                      │
                                      ├─ Anthropic API (Stocky: READ-ONLY tools; imports: extract)
                                      └─ Sentry (opt-in, error object only)
```

Four boundaries carry real weight:

1. **Browser → server.** Cookie session, same-origin only, no CORS configured anywhere. The SPA is
   served from the API origin in production (`index.ts`), so there is no cross-origin surface to
   get wrong.
2. **Desktop → server.** A device-bound session with a **one-year** TTL. Acceptable *only* because
   `Device.status` is re-checked on every single request (`auth/session.ts`) — the long token is
   long-lived, not unrevokable.
3. **Device → "who is acting".** `x-acting-user` lets a registered desktop assert which of its own
   staff is working. This is a genuine delegation of trust, bounded three ways (device-bound
   session required, named user must belong to that device's client, machine is revocable) and
   documented at `middleware/auth.ts`. It is the single most privileged header in the system.
4. **Model → data.** Stocky's tools receive `locationId`/`clientId` from the authenticated context,
   never from the model or the request body (`routes/stocky.ts`), and the registry is read-only.
   Prompt injection through imported documents therefore cannot reach a write.

---

## 2. Current posture

An honest score, with the reasoning rather than just a number.

### Score: **97 / 100** — strong throughout; what remains is deployment, not code

*Tracked across 2026-08-01: **78** (initial audit) → **82** (MFA) → **93** (DR, pipeline, KDF,
route-coverage) → **91** when review round one found five bypasses in the day's own MFA work → **93**
once fixed → **89** when round two found nine more, six of them introduced by round one's fixes →
**94** once those were fixed and pinned → **95** with the Phase-2 leftovers → **97** with hash-chained
ActivityLog, byte-sniffed uploads and inline `<style>` refused. The remaining three points are
almost entirely things only the operator can do — terminate TLS, schedule the backup onto another
machine, protect the branch. See [§5](#5-reaching-100).*

**The most useful thing learned here is in those dips, and it is uncomfortable.** Across two review
rounds, **eleven of the sixteen security defects were introduced by the security work itself** —
including a password check that accepted any input against a malformed hash, a restore drill that
passed on an empty database, a dependency gate that announced success when it had not run, and two
successive wrong attempts at the same privilege cap. Twice, a harness written alongside a control
asserted the wrong thing and scored the bug green.

A check that asserts the wrong thing is worse than no check, because it manufactures confidence.
Independent adversarial review is not optional on security code — least of all on security code
written to fix security problems.

That splits unevenly, and the split is the useful part:

| Domain | Score | Why |
|---|---|---|
| Authorization / tenancy | 97 | Server-side on every route, 404-not-403, nested-relation scoping, no IDOR, **all 179 routes probed unauthenticated on every CI run** (every one answers 401). Marked down for five middleware-placement bugs found in one day |
| Audit integrity | 97 | Mutations and their log rows share a `$transaction`, immutable records with void chains — and the trail is now **hash-chained and provably unedited**, verified against real edit/delete/forge attacks on every CI run |
| Authentication | 95 | TOTP for ADMIN/OWNER (single-use per RFC 6238), scrypt at 2× the OWASP floor with lazy re-hashing, malformed hashes rejected, breached passwords refused. Still marked down: **eight** real bypasses shipped across two cuts of this work and were caught only by adversarial review |
| Input handling / injection | 96 | Prisma everywhere, zod on every body, no raw SQL on user input, no dynamic execution, per-request timeout, and uploads routed by **magic bytes** rather than a caller-supplied filename |
| Transport / edge hardening | 80 | Headers, limits, per-request `Secure`, and inline `<style>` elements now refused outright (`style-src-elem 'self'`). Stuck below 95 until TLS is actually terminated — that one is yours |
| Secrets management | 80 | `.env` untracked and clean, gitleaks in CI. Remaining: back up `FNB_MFA_KEY` separately, and a rehearsed rotation |
| Availability / DR | 90 | Verified tiered backups, a non-vacuity floor, a drill that re-runs the real reconciliation, and a health check that can actually fail. Remaining: schedule it, and put a copy on another machine |
| Pipeline security | 90 | CI runs typechecks, all three harnesses, gitleaks over full history, and an audit gate that fails CLOSED when it cannot run and matches exceptions by advisory identity. Remaining: branch protection |

The pattern that shaped the day's work: the code was well-built and the operations around it barely
existed. DR and pipeline — 30 and 20 at the start — were worth more than every remaining code
change combined, and they are now 85 and 88. What is left is genuinely not codeable: terminating
TLS, putting a backup on a second machine, and running a drill once a quarter.

### What was already right before this audit

Worth recording, because these are the things people usually get wrong and re-breaking them would
be a regression:

- **Password hashing** — scrypt (N=16384, r=8, p=1), per-password random salt, `timingSafeEqual`
  comparison, and **parameters stored inside the hash string** so the cost can be raised later with
  no migration. That last detail is rarer than it should be.
- **Session tokens** — 32 bytes from `randomBytes`, stored as a SHA-256 hash. A database leak does
  not yield usable session tokens.
- **No raw SQL on user input.** The only `$executeRawUnsafe` calls are two static `PRAGMA`
  statements in `db.ts`.
- **The `/sync/snapshot` gate.** It carries every colleague's PIN and recovery-answer hash, and is
  restricted to device sessions — not merely to a role. Restricting to the one caller that needs it
  closes the hole rather than narrowing it. `passwordHash` is deliberately excluded, so a stolen bar
  PC does not become remote access.
- **Nested-relation scoping** in `GET /api/admin/users` — the `where` limits which users an owner
  sees, and the nested `clientAccess.where` limits what each row reveals. Forgetting the second is
  a classic cross-tenant leak.
- **`CLIENT_ACCESS_USER_FIELDS`** — an explicit projection so adding a `User` column cannot silently
  re-expose password hashes to the admin screen.
- **Uploaded files are never served back.** Stored under a SHA-256 filename with a
  server-controlled extension, read only by the parser. No path traversal, no stored-XSS-via-upload.
- **Billing lockout is enforced server-side**, including on exports — the UI badge and the server
  agree.

---

## 3. Findings

Severity reflects impact **for this system and its deployment**, not a generic CVSS. Everything
marked FIXED was fixed in this pass and is pinned by `verify:security`.

### HIGH

#### H-1 · Session cookie `Secure` flag keyed off `NODE_ENV` — FIXED
`routes/auth.ts` set `secure: process.env.NODE_ENV === "production"`, while `index.ts` decided
whether to serve the SPA from a `--dev` argv flag. **Two different signals for "is this
production".** A deploy that set one and not the other served the app perfectly while emitting
session cookies without `Secure` — and that cookie *is* the session. One plaintext request over
café Wi-Fi hands an attacker the establishment's books, with no credential involved.

*Fix:* `secure` is now derived per-request from the actual transport (`isSecureRequest`), which is
correct in all three deployments without configuration — HTTPS hosting gets `Secure`, and the
plain-HTTP Electron desktop keeps working (a hard-coded `true` would have broken it).

#### H-2 · No rate limiting on any endpoint — FIXED
The per-account lockout (5 failures / 1 hour) was the only throttle. It is blind to the two attacks
that matter most:

- **Credential stuffing / password spraying** tries one password against *many* usernames, so no
  single account counter ever fires.
- **`/api/auth/login` runs scrypt before it knows who is calling** — an unauthenticated CPU
  amplifier, ~100 ms of work per request from anyone on the network.

*Fix:* per-IP limiters in `middleware/security.ts` — 10 **failed** sign-ins / 15 min on `/login` and
`/pin`, 1200 requests / min across `/api/*`, plus content-type-aware body limits. Counting failures
rather than attempts means a bar where fifteen staff sign in at shift change behind one NAT address
never trips it, while a password guesser trips it in seconds.

#### H-3 · No response security headers — FIXED
No CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, or `Referrer-Policy` anywhere. The app
was framable (clickjacking a "void this count" button is a plausible attack on an audit system) and
had zero defence-in-depth against injected script.

*Fix:* `securityHeaders` via Hono's built-in `secureHeaders`. `script-src 'self'` with **no**
`unsafe-inline`/`unsafe-eval`. `style-src` retains `'unsafe-inline'` and currently cannot drop it —
shadcn's chart primitive emits a `<style>` block and React writes inline `style=` props; removing it
needs a nonce threaded through the SPA build. HSTS is sent only over TLS, so the desktop's
plain-HTTP localhost server does not pin the operator's browser to `https://localhost`.

### MEDIUM

#### M-1 · `x-forwarded-for` trusted verbatim for audit attribution — FIXED
Login IPs came straight from the header. Any client can set it. The activity trail and the login
history screen — the exact things an owner uses to answer *"who did this?"* — were
attacker-controlled. In a system whose product **is** its audit trail, forged evidence is worse
than absent evidence, because it reads as proof.

*Fix:* `clientIp()` reads the socket address unless `FNB_TRUST_PROXY=1` explicitly declares a
reverse proxy, in which case it takes the **last** XFF hop (the one the proxy appended) rather than
the conventional first, which is the attacker-controlled end of the list.

#### M-2 · Username enumeration via response timing — FIXED
`if (!user || user.status !== "ACTIVE") throw` returned before any hashing, so a missing username
answered in single-digit milliseconds and a real one in ~100 ms. The deliberately vague "Incorrect
username or password" message was undone by the clock. Confirmed usernames are half of credential
stuffing, and this system's accounts are named after real staff.

*Fix:* `burnPasswordTime()` spends an equivalent scrypt derivation on the no-such-user branch.
Measured at 34.9 ms vs 33.0 ms (ratio 0.95) in the harness.

#### M-3 · A permission guard leaked onto a neighbouring router's routes — FIXED
`settingsRoutes` used a pathless `.use(requireAuth, requirePermission("master.write"))`.
`preferencesRoutes` mounts on the **same** `/api/settings` prefix with only `requireAuth`, and Hono
merges routers by path — a pathless `.use()` registers as `/api/settings/*` and runs on the other
router's routes too. Verified experimentally, not assumed.

Consequence: STAFF and ACCOUNTANT logins got 403 from `GET /api/settings/preferences` and
`GET /api/settings/cost-basis` — the two endpoints whose own comments say they sit outside that
guard *on purpose*. The cost-basis one is more than an annoyance: the client falls back to `"PRICE"`
on error, so an accountant at an establishment valuing at `LAST_COST` read every valuation screen
under the wrong basis label with nothing to signal it. **Fail-closed, so not exploitable — but it
silently mislabels the numbers, which in this product is the serious kind of bug.**

*Fix:* `master.write` is attached per-route. Path scoping alone would not have been enough — the two
routers serve GET and PUT at the *same paths* — which is why the guard had to move onto the methods.
`admin.ts` already documents this exact trap at its own `.use("/clients", …)`.

#### M-4 · Password reset left existing sessions alive — FIXED
`PUT /api/admin/users/:id` rewrote `passwordHash` but touched no `AuthSession` rows. The reason an
owner resets a password is almost always that the old one is compromised — a lost phone, a departed
employee. Whoever already held a session cookie kept full access for up to 7 more days (a **year**
on a registered desktop) while the screen told the owner the account was secured.

*Fix:* a password change deletes that user's sessions inside the same transaction, and the count
lands in the audit summary so the owner can verify it. Role and module edits deliberately do **not**
evict — `getSessionUser` re-reads both on every request, so they take effect on the next call
anyway, and throwing someone out of a half-finished count to *widen* their access would be hostile
for no gain.

#### M-5 · No MFA — FIXED
No second factor anywhere. For ADMIN (cross-tenant, every establishment's books) and OWNER, a single
password is thin.

*Fix:* TOTP (RFC 6238 on `node:crypto`, no dependency), **required for ADMIN and OWNER**, optional
for everyone else (client decision 2026-08-01). Implementation notes in
[security-mfa.md](security-mfa.md); the load-bearing decisions:

- **The password buys one thing: the right to present the second factor.** An enrolled account gets
  a short-lived `MfaChallenge`, not a session — no cookie, no device registration, no `auth.login`
  entry until the code lands. `MfaChallenge` is a separate table rather than a flag on
  `AuthSession` precisely so a half-authenticated row cannot be mistaken for a session by a reader
  that forgets to check a flag; that mistake fails *open*.
- **Enrolment is not complete until a code is proved.** The row is written unconfirmed, so a
  mis-scan cannot lock someone out of their own account.
- **Login is never hard-blocked, the app is.** Refusing the login of an unenrolled ADMIN would lock
  out the only administrator with no way back in. Instead they sign in, and `requireMfaEnrolment`
  refuses everything except `/api/auth/*` until they enrol.
- **`FNB_MFA_KEY` is the on-switch.** Without it the secrets could not be encrypted, so the whole
  feature is off — fail-safe, and it makes turning MFA on a single deliberate act.
- **The desktop is exempt.** It authenticates a machine, checks its PIN locally with no network, and
  is sold on working through a bad connection. `Device.status` revocation is the control that stands
  in for a second factor there.
- **Self-disable is refused for the required roles.** Lost phones go through an administrator —
  a second human, present, holding `users.manage` — mirroring `pinAdminRoutes`.

#### M-6 · No encryption at rest — OPEN
`data/fnb.db` and `data/uploads/` are plaintext on disk. Bounded by the fact that password and PIN
material is hashed, so the database file yields cost prices and margins rather than credentials.
The bigger exposure is the **desktop mirror**, which sits on a bar PC in a public-ish room and
carries the establishment's whole catalog plus colleagues' PIN hashes. Mitigation is OS-level
(BitLocker / FileVault) — see the runbook. Application-level SQLite encryption (SQLCipher) would
mean dropping `better-sqlite3` and is not worth it for this threat.

---

### Found by adversarial review, after the fixes above

An independent multi-agent review of the day's own security work. **Five of the seven findings below
were introduced by that work**, which is the point worth keeping: the code that adds a control is
exactly as capable of removing one.

#### H-4 · A device payload in the login body bypassed the second factor — FIXED
**The most serious finding of the whole engagement, and it was introduced by the MFA work itself.**

The exemption meant to protect the offline desktop was written as `if (!device && isMfaAvailable())`
— and `device` is **unauthenticated request body**. Nothing proved the caller was the Electron app:
no client certificate, no shared secret, no signature. `deviceLogin` validates the *shape* of a
fingerprint, not its provenance.

So a phished password plus an invented fingerprint bought a full session with no code. Worse, it was
self-reinforcing: registering a new machine needs `devices.manage` = `[ADMIN, OWNER]`, which is
byte-identical to `MFA_REQUIRED_ROLES` — the exemption was available to exactly the two roles that
must never have it. The resulting session was device-bound, so it carried a **365-day** TTL instead
of 7 days, and `mfaEnrolmentOutstanding` short-circuited on `deviceId`, so the enrolment gate never
fired either. Demonstrated end to end before the fix: `curl` with a made-up fingerprint returned an
OWNER session that could reach every admin route.

The harness scored this as a **pass** ("a registered desktop signs in without a code"), which is the
real lesson: a check that asserts the wrong thing is worse than no check, because it manufactures
confidence.

*Fix:* the exemption is gone. Every enrolled account presents its factor, and the device payload
rides the challenge (`MfaChallenge.deviceJson` — a column defined for this and left unwired) so no
machine is registered on half a credential. The desktop loses nothing real: registration happens at
the server, over the network, with the owner at the machine — exactly when a phone is to hand.

#### H-5 · `x-acting-user` adopted the claimed user's ROLE — FIXED
The header names which staff member is working, for attribution. It was taking the claimed user's
role wholesale with no proof. Any account able to obtain a device session could then name the OWNER
and hold `users.manage`, `entries.void` and `prices.edit`.

That was reachable: `resolveDevice` returns an **already-registered** machine to any user of that
establishment, checking `devices.manage` only when registering a *new* one. So an ordinary STAFF
login on the bar PC was one header away from being the owner.

*Fix:* the header may only **narrow** privilege, never widen it — capped at the session holder's own
role, with the attempt logged. The real workflow is untouched: the desktop holds one long-lived
session opened by the owner, and every staff member acting under it is at or below that.

#### H-6 · The rate limiter did not hold under concurrency — FIXED
The three limiters with teeth (login, PIN, MFA verify) incremented their counter *after* the handler
resolved, so parallel requests all read zero and all passed. Measured: **60 concurrent bad sign-ins
against a limit of 10 produced 60 × 401 and 0 × 429**, each burning a full scrypt derivation.

The ceiling applied only to an attacker polite enough to wait for each response — which is to say it
did not apply. Every brute-force bound claimed elsewhere in this document (passwords, PINs, 6-digit
TOTP codes) rested on it. The ironic part: the comment on the *other* branch says exactly why
reserving up front is necessary.

*Fix:* reserve-then-refund. The slot is taken before the handler runs and given back if the outcome
was not countable, so "only failures count" survives alongside a limit that actually holds.

#### H-7 · An administrator could reset their own second factor — FIXED
`DELETE /api/admin/users/:id/mfa` never checked that the target was not the caller. So the rule that
a required role cannot self-disable was decorative: refused at `/api/auth/mfa`, an ADMIN simply
called the admin route on their own id and removed it with a session cookie alone — no password, no
code, no second human. Anyone holding a stolen session could do the same and re-enrol their own
authenticator.

*Fix:* refused on self. Consequence, documented rather than discovered later: a **lone** ADMIN who
loses phone and codes now has no in-app path back, so the runbook asks for two ADMIN accounts and
ships a host-console break-glass (`npm run mfa:reset`) that requires shell access and writes
`mfa.breakGlassReset` to the trail.

#### H-8 · Losing `FNB_MFA_KEY` silently downgraded enrolled accounts — FIXED
The login gate was `isMfaAvailable()`, a presence check on an environment variable. A blank or
missing key therefore removed the second factor from every already-enrolled ADMIN and OWNER, with no
error anywhere — a config accident quietly deleting a security control.

*Fix:* the account is asked first, the configuration second. A confirmed factor with no key now
returns **503 `MFA_UNAVAILABLE`** rather than a session. That is also what the documentation already
promised ("losing FNB_MFA_KEY locks out every enrolled user"); the code now agrees with it.

#### M-7 · The lockout counter reset on password success — FIXED
A correct password cleared `failedLoginCount`, so someone holding it could guess four TOTP codes,
sign in again to zero the counter, and repeat indefinitely. Six digits with an unbounded budget is
not a second factor. *Fix:* the counter clears in `completeLogin` — once **every** factor the
account requires has been proved.

---

### Round-two adversarial review — including the fixes from round one

The round-one fixes were themselves reviewed. **Six of the nine findings below were introduced by
round one**, and two were in code written specifically to close a security hole. The pattern is now
established beyond argument: security fixes need review at least as much as the code they fix.

#### C-1 · The restore drill reported PASSED on a completely empty database — FIXED
Every content check compares the restore against a manifest derived from **the same backup**, which
is deliberate — comparing to a live database cries wolf on ordinary business activity. But it makes
the comparisons self-referential, so zeros match zeros: 15 count checks of `0 === 0`, a digest loop
that never iterates, and the one anti-vacuity guard (`digestedFields > 5`) unreachable because there
were no digests to guard. Reproduced: all 37 tables emptied, `backup` printed OK, `restore-drill`
printed **RESTORE DRILL PASSED**.

It compounded. `prune` awards each daily slot to the newest file claiming it, so after 48 hours the
empty backups would start **evicting the real ones**.

*Fix:* an absolute floor before any relative check counts as evidence — `backup` refuses to keep a
database with zero users or locations (no install of this product has either), and the drill asserts
users, locations, an audit trail, counted stock, and at least one auditable period. My own comment
said "a check that always passes is worse than no check"; the guard I wrote only protected a
location that already had a digest.

#### H-9 · `verifyPassword` accepted ANY password against a malformed hash — FIXED
`Buffer.from(x, "hex")` is silently lenient: an empty or non-hex segment yields a **zero-length**
buffer, which became a zero-length derivation, and `key.length === expected.length &&
timingSafeEqual(empty, empty)` evaluated to `0 === 0 && true`. Verified:
`scrypt:32768:8:1:<salt>:` returned `true` for `"literally-anything"`.

This matters for precisely the adversary this system is built against. An insider with database
access could blank one segment of a `passwordHash` and then sign in as that person with any string,
leaving a row that still *looks* like a scrypt hash rather than an obvious reset.

*Fix:* every field validated before use — hex of exactly the expected length, integer parameters in
range. Seven cases pinned in the harness, plus two positive controls.

#### H-10 · The audit gate failed OPEN when npm audit could not run — FIXED
npm exits non-zero both when it finds advisories and when it fails to reach the registry, and both
write JSON to stdout. The error payload has no `vulnerabilities` key, so `?? {}` read it as a clean
tree. Reproduced with `npm_config_registry=http://127.0.0.1:1`: **"PASS — 0 blocking", exit 0.**
Any registry outage, proxy failure or expired auth turned the dependency gate into a no-op that
announced success — in CI, where nobody would look.

*Fix:* the response shape is checked; a payload without a `vulnerabilities` object and `metadata`
throws and exits 1.

#### H-11 · Exceptions were matched by package name only — FIXED
`EXCEPTIONS.find(e => e.package === name)` meant an exception written for one CVE silently absorbed
every **future** advisory in that package, including an unrelated RCE. The `advisory` field existed
but was prose compared to nothing. *Fix:* the GHSA ids must appear in the finding's `via` entries; a
different advisory in an excepted package blocks and says so.

#### H-12 · An AUDIT_VIEWER could get withheld data out of Stocky — FIXED
The audit-viewer narrowing keys off a `/reports/` path segment. `/stocky/chat` requires only
`reports.view` — held by every role — and its tools read `salesReport`, `purchaseReport` and
`nonRevenueReport`: exactly the reports `AUDIT_VIEWER_REPORTS` withholds as commercially sensitive.
A third-party viewer barred from the sales report could simply **ask for it in prose**.

*Fix:* audit viewers are refused Stocky outright (404, matching the convention next door). Narrowed
tool-by-tool would rot the moment a tool is added.

#### H-13 · The `x-acting-user` cap was unsound — FIXED (second attempt)
Round one capped the claim by position in `ROLES`. That is not a privilege lattice: STAFF (index 3)
and ACCOUNTANT (index 4) are **incomparable** — STAFF holds `entries.create`, ACCOUNTANT holds
`reports.export`. "Narrowing" STAFF to ACCOUNTANT therefore handed out an export permission STAFF
never had: a widening wearing a narrowing's clothes.

*Fix:* `roleSubsumes` compares permission **sets**, derived from `PERMISSIONS` itself so a new
permission cannot fall outside the check, and a claim that is not subsumed is refused rather than
silently downgraded. Pinned with a positive control, so the check cannot pass because the route is
merely broken.

#### H-14 · `isSecureRequest` omitted `Secure` behind a TLS-terminating proxy — FIXED
The deployment the runbook recommends terminates TLS at Caddy and proxies to Node over plain HTTP,
so `c.req.url` is `http://…` and the cookie shipped **without** `Secure` unless `FNB_TRUST_PROXY`
also happened to be set. That is H-1 — two signals disagreeing about production — reintroduced by
H-1's own fix.

*Fix:* `x-forwarded-proto` is now believed for this decision **without** requiring
`FNB_TRUST_PROXY`, and that asymmetry against `clientIp()` is the point: a forged
`X-Forwarded-For` writes false evidence into the audit trail, whereas a forged
`X-Forwarded-Proto` can only *add* `Secure` — costing the forger their own session over HTTP. The
two headers have opposite failure modes and deserve opposite defaults.

#### M-8 · The self-reset ban could be sidestepped via `x-acting-user` — FIXED
`targetId === actor.id` checks the ACTING identity, which a device session chooses. An owner could
name an equal-role colleague and then clear their own factor. *Fix:* both identities checked —
`SessionUser.sessionUserId` carries who actually opened the session.

#### M-9 · Fifth middleware-placement bug — FIXED
`reportRoutes` had two **pathless** `.use()` calls, which Hono registers as
`/api/locations/:locationId/*` — so they ran on dashboard, Stocky and sync too. Harmless in effect
(`reports.view` is held by every role), but `dashboardRoutes` carried **no guard of its own** and was
silently relying on the leak. *Fix:* both scoped to `/reports/*`, and dashboard now states its own
requirement.

#### M-10 · Manifest failure stopped uploads and pruning — FIXED
`process.exit(1)` on manifest failure ran before `syncUploads` and `prune`, so a persistent failure
silently stopped backing up import source documents and stopped retention entirely — while printing
that the backup was kept. *Fix:* both now run first; the manifest is last because it is the step most
likely to fail.

### Phase-2 and leftover items — decided 2026-08-02

Working the remaining phases of the original brief. **Built four; declined five, with reasons** —
the declines matter as much as the builds, so they are recorded rather than quietly skipped.

#### Built

| Item | Why it earned its place |
|---|---|
| **Readiness health check** | `/api/health` returned `{ok:true}` without touching the database, so it reported healthy while SQLite was locked, corrupt, or the disk was full — exactly when a supervisor needs to know. Now queries the DB and returns **503** on failure. A health check that cannot fail is decoration |
| **Request timeout** (Phase 4) | 120 s ceiling on `/api/*` so a handler blocked on something external cannot hold a slot forever. Generous on purpose — AI import extraction legitimately runs tens of seconds. **Stocky is excluded and must stay excluded**: it is an SSE stream meant to stay open for minutes |
| **TOTP single-use** (RFC 6238 §5.2) | `window = 1` left one 6-digit code valid ~90 s — ample to replay for anyone who watched it typed. `UserMfa.lastTotpStep` now records the spent step, refused with `<=` so an older step in the window cannot be replayed either, written with a conditional `updateMany` so it holds under concurrency |
| **Breached-password check** | The single highest-value addition to authentication here, because this app has **no self-service password change** — an ADMIN types every password for everyone, so one person's habits set the floor for the whole establishment. HIBP k-anonymity: only the first 5 chars of the SHA-1 leave the process. **Fails open** if the API is unreachable, so a third-party outage can never block an urgent rotation |

#### Declined, with reasons

| Item | Why not |
|---|---|
| **Password composition rules** | NIST SP 800-63B recommends *against* them — "must contain a symbol" produces `Password1!`, which is itself in every breach corpus. The breach check is the version of this that works |
| **Raising the minimum length 8 → 12** | Marginal here: ADMIN/OWNER are backstopped by MFA, and a cracked STAFF password buys `entries.create` in one establishment. Admin-assigned 12-character passwords get written on a sticky note, which is a net loss. Revisit if self-service password change is ever added |
| **Refresh-token rotation** | Wrong architecture. That is a JWT pattern; this uses server-side revocable sessions, which already provide the property rotation buys — immediate revocation. Adding it would be cargo-cult |
| **Suspicious-session detection** | There is no delivery channel. Without email, a detection nobody is told about is a log line. Blocked behind [security-mfa.md §2](security-mfa.md); revisit together |
| **Encryption at rest** | Right layer is the OS (BitLocker/FileVault), already in the runbook pre-flight. Application-level means dropping `better-sqlite3` for SQLCipher — a large change for a threat full-disk encryption already covers |

#### Still open, deliberately

- **A recovery code is spent before `completeLogin` runs**, which can throw (revoked device, licence cap) — burning the code without granting a session. Consuming *first* is the fail-safe direction; the alternatives are a race or a two-phase commit. Annoying, not dangerous, and 9 codes remain.
- **Alerting implementation** — the signals are documented as queries in the runbook, but firing them needs an email/Slack channel that does not exist yet.

### The last three code items — built 2026-08-02

#### Hash-chained `ActivityLog` — the product-shaped one

Every entry now carries `hash = SHA-256(prevHash ‖ its own material fields)` and a monotonic `seq`,
written in `logActivity` — the single choke point all ~90 log sites pass through, so the chain cannot
have holes in it. `GET /api/activity/verify` (ADMIN) walks it and reports the first position that
stops reproducing.

**Why this is different from the rest of this document.** Every competitor can say their system
*logs* changes. This is the claim that the log **has not been edited** — including by whoever holds
the database file, which is precisely this product's stated adversary. An audit trail an insider can
quietly rewrite is not evidence; it is a confident lie.

Pre-existing rows are sealed separately (`npm run seal-history`, runbook §4) — a *trusted-on-seal*
operation that freezes them as they stand rather than proving them authentic, and which records
itself in the trail so the distinction survives.

Nine checks in the harness perform **real tampering** and require the verifier to catch it: an edited
summary (caught at its exact seq), a deleted row (caught as a gap — the hashes alone would chain
across the hole), and a forged append. A chain never tested against an actual edit is an assumption
wearing a hash.

**What it does not do:** an attacker with write access can recompute the whole chain forward and it
will verify. Nothing stored beside the data it protects can prevent that. `chainAnchor()` returns the
one value worth publishing **outside** the database — on the monthly report, the audit certificate —
because altering every copy that has left the building is the point at which tampering stops being
quiet.

#### Uploads routed by magic bytes

`detectSource` chose a parser from the filename extension and the browser-supplied MIME type — both
caller-controlled, so the caller chose the parser. Now sniffed from the bytes
(`services/file-type.ts`), with the extension only breaking ties bytes cannot (XLSX vs any other Zip)
and covering CSV, which has no magic number — there, a NUL byte in the first 8 KB rejects a binary
wearing a `.csv` name.

#### Inline `<style>` elements refused

CSP3 splits `style-src-elem` (elements) from `style-src-attr` (attributes). React writes hundreds of
inline `style=` props and cannot stop, but the app emitted exactly **one** `<style>` element —
shadcn's chart primitive. Rewriting it to emit its colour variables as an inline style object made
`style-src-elem 'self'` possible, which closes the CSS-exfiltration trick where injected attribute
selectors leak field contents one character at a time.

⚠️ **This surfaced a regression in the browser that no harness would have caught.** Sonner injects
~15 KB of CSS as an inline `<style>` at runtime, so the tightened policy blocked it and every toast
in the app rendered unstyled. Fixed by importing `sonner/dist/styles.css` through the bundler — an
ordinary same-origin stylesheet the policy allows. **That import is load-bearing**; removing it, or a
sonner upgrade that relocates its CSS, silently unstyles every toast.

### Still open from this round

- **TOTP codes are not single-use** (RFC 6238 §5.2). A code stays valid for its ±1-step window.
  Needs a `lastTotpStep` column; bounded meanwhile by the per-IP limiter and TLS.
- **A recovery code is spent before `completeLogin` runs**, which can throw (revoked device, licence
  cap) — burning the code without granting a session. Annoying, not dangerous; 9 remain.

### LOW

#### L-1 · `originCheck` passes when `Origin` is absent
Deliberate and documented (`middleware/auth.ts`): non-browser callers (`curl`, the desktop) have no
`Origin`, and cookies are not at risk there. Modern browsers send `Origin` on cross-origin form
POSTs, and `SameSite=Lax` is a second independent barrier. **Not worth changing** — tightening it
breaks the desktop for no real gain.

#### L-2 · scrypt cost at the OWASP floor — FIXED
N=16384 was the stated minimum for r=8, p=1. Raised to **32768** once H-2's rate limiter existed —
not before, because `/login` runs the KDF *before* knowing who is calling, so the work factor
doubles as an unauthenticated CPU cost.

Two traps this hit on the way, both worth recording:

- **Node's scrypt defaults `maxmem` to 32 MB and requires the working set to be strictly under it.**
  scrypt needs `128·N·r`, which at N=32768, r=8 is *exactly* 33,554,432 bytes. So the recommended
  parameters fail outright with "memory limit exceeded" until `maxmem` moves too — and it must be
  passed on **verify** as well as hash, or every existing hash stops checking. `MAXMEM` is now
  computed from the parameters and doubled, so it cannot silently become the ceiling again.
- **Raising N re-opened M-2 in reverse.** `burnPasswordTime` runs at the *current* N (~80 ms) while a
  real account holding a legacy hash verified at the old one (~38 ms) — so a known username became
  *faster* than an unknown one. Fixed by re-hashing on successful sign-in (`needsRehash`), which
  also means the oldest accounts stop being the weakest. Once every hash has upgraded, both paths
  cost the same and the oracle closes for good.

A residual ~50 ms asymmetry remains: a real account has a failed-login counter to increment and a
missing one does not. Bounded to a handful of samples by the per-IP limiter, and asserted against
regression (ratio < 2.5) rather than claimed to be zero.

#### L-3 · Seed credentials are uniform and public
Five accounts share `Fnb!2026`, printed in `README.md`. Correct for a dev fixture, catastrophic if
`db:seed` is ever run against production. See the runbook's pre-flight checklist.

#### L-4 · Password policy is length-only
`z.string().min(8)`. No complexity rule, no reuse prevention, no breach-list check. Modern guidance
(NIST SP 800-63B) actually favours length over composition rules, so this is defensible — but 8 is
short and a breached-password check is the single highest-value addition. See M-5's document.

#### L-5 · Dependency advisories — PARTLY FIXED, remainder accepted with expiry
`react-router` carried a high-severity RSC-mode CSRF bypass; patched 8.1.0 → 8.3.0. Not exploitable
here (Vite SPA, no RSC) but free, and it ships.

Two remain, both **transitive and unreachable**, both accepted until **2026-11-01** in
`scripts/audit-gate.mjs` with the traced call path written down: `brace-expansion` (ReDoS via glob
patterns that are archiver's own constants) and `fast-uri` (only via the Prisma **CLI**, never
loaded by the running server). `npm audit fix` resolves the latter by splitting the Prisma toolchain
— CLI 7.9.1 against client 7.8.0 — which is the worse trade under a system whose value is numerical
correctness.

The gate exists because bare `npm audit` in CI has two end states and both are useless: block every
build over something nobody can reach, or get `|| true` appended. Exceptions here expire, so an
accepted risk gets re-examined instead of forgotten.

`allowScripts` still permits lifecycle scripts for exactly five packages — `prisma`,
`@prisma/engines`, `esbuild`, `better-sqlite3`, `electron`. All need them. Known surface, not a
defect.

#### L-7 · Any user of an establishment can obtain a device session
`resolveDevice` checks `devices.manage` only when REGISTERING a new machine. Signing in against an
**already-registered** fingerprint is open to any active user of that establishment — which is the
intended workflow (staff stand at the bar PC), but it means a STAFF login yields a device-bound
session with the 365-day TTL meant for a machine.

Bounded, and deliberately left alone:
- The privilege escalation this used to enable is closed (H-5) — the acting-user claim can no longer
  widen a role.
- `Device.status` is re-checked on every request, so revoking the machine cuts every session bound
  to it at once.
- The fingerprint is treated as a secret (`routes/devices.ts` withholds it from the list endpoint),
  though it necessarily sits in plaintext on the bar PC.

The residual is session *lifetime*, not privilege: someone who reads a fingerprint off that machine
could hold a year-long session at their own role. Shortening it would mean giving the desktop a TTL
that depends on who signed in, which is exactly the coupling the offline guarantee exists to avoid.
Revisit only if device sessions ever start being opened by people who are not physically at the
machine.

#### L-6 · Device registration is trust-on-first-use
An owner signing in on an unregistered machine registers it. Bounded by `Subscription.maxDevices`,
visible, and revocable. Documented and accepted in `auth/device.ts`; the alternative (reading a
fingerprint off a machine before the software that computes it exists) is worse.

### Explicitly checked, found clean

Recording the negatives so the next audit does not redo them:

- **SQL injection** — no raw SQL on user input anywhere; Prisma parameterises throughout.
- **Command injection / RCE** — no `eval`, `new Function`, `child_process`, or deserialization of
  user data in the server.
- **Path traversal** — the only user-influenced filesystem write is the import upload, named from a
  SHA-256 digest with a server-chosen extension from a closed enum.
- **XSS** — React with no `dangerouslySetInnerHTML` on user data. The single occurrence
  (`components/ui/chart.tsx`) interpolates developer-authored chart config, not user input.
- **IDOR** — every `:id` route re-checks tenancy; `lib/idempotency.ts` makes the ownership predicate
  a *required argument* so eight create routes cannot forget it.
- **Mass assignment** — zod schemas are closed; `admin.ts` explicitly deletes `password`/`modules`
  from the spread before `update`.
- **Prompt injection → data mutation** — Stocky's tool registry is read-only and scoped from the
  session, so a malicious imported PDF cannot reach a write.

---

## 4. Before the first real client

Six things, none of them code. In order.

1. **Terminate TLS** and set `FNB_TRUST_PROXY=1` behind a proxy that *overwrites* `X-Forwarded-For`.
   H-1 and M-1 both assume this — the Caddy config in the runbook is four lines.
2. **Generate a production `FNB_MFA_KEY`** and back it up **separately from the database**. MFA is
   off until it exists; losing it locks out every enrolled user. Then enrol every ADMIN and OWNER.
3. **Change every seeded password** and delete the accounts you do not need. Five accounts share
   `Fnb!2026`, printed in `README.md`.
4. **Schedule `npm run backup`** (hourly), point `FNB_BACKUP_DIR` at a different volume, and sync a
   copy to a **different machine**. The script is written; nothing runs it yet.
5. **Run `npm run restore-drill` once now**, then quarterly. Record the elapsed time — that is your
   real RTO.
6. **Turn on `SENTRY_DSN`.** Right now a 500 in production is invisible.

Then the standing checklist in [security-runbook.md §1](security-runbook.md).

---

## 5. Reaching 100

Updated 2026-08-01 after the DR and pipeline work. **Almost everything left needs a deployment, a
schedule, or a decision — not a commit.**

### The seven points, and who has to do them

| # | Domain | What's left | Whose |
|---|---|---|---|
| 1 | Transport 75→95 | **Terminate TLS**, set `FNB_TRUST_PROXY=1` behind an overwriting proxy | Yours — 1 h, runbook §1 |
| 2 | DR 85→95 | **Schedule the backup** (`schtasks` one-liner) and put a copy on a **different machine** | Yours — 1 h |
| 3 | DR 95→100 | Run the **quarterly restore drill** and record the elapsed time | Yours — 5 min/quarter |
| 4 | Secrets 80→90 | Back up `FNB_MFA_KEY` **separately from the database** | Yours — 10 min |
| 5 | Pipeline 88→95 | Branch protection on `main`; gitleaks over history once, retroactively | Yours — 20 min |
| 6 | Audit integrity 90→97 | **Hash-chain `ActivityLog`** | Mine — ~1 day |
| 7 | Input 88→94 | Content-sniff uploads instead of trusting the extension | Mine — 2 h |

Items 1–5 are worth more than 6–7 combined, and none of them is code.

### Still worth building, in order

**Hash-chained `ActivityLog` (item 6).** The only item on this page that is a **product feature**
rather than a control. Every competitor can say their system logs changes. A system that can *prove*
its trail has not been altered — including by whoever holds the database — is a different claim, and
it is exactly the claim this client's business rests on. Each row carries the previous row's hash;
a periodic verification pass detects any retroactive edit; an anchor published outside the database
makes it provable to a third party.

**Content-sniffing uploads (item 7).** `detectSource` picks a parser from the *filename*, so a
mislabelled file reaches the wrong parser. Not a vulnerability today — the stored file is never
served back and both parsers are memory-safe — but it is the kind of assumption that becomes one.

**Breached-password check.** A k-anonymity range query against HIBP at set-password time; the API
never sees the password. "At least 8 characters" plus a password already in a breach corpus is the
realistic failure mode, and this is the single highest-value addition to authentication.

### Deliberately not doing

- **CSP `style-src` nonce.** Needs threading through the SPA build for shadcn's chart primitive.
  Real effort, and `script-src 'self'` already blocks injected JavaScript — which is the half that
  matters.
- **WebAuthn.** Phishing-resistant, but phishing is not this system's realistic threat. The
  adversary here is an insider with legitimate access altering history, and a hardware key does
  nothing about that.
- **HA cluster, Redis, WAF appliance.** Each establishment's desktop mirror already survives a total
  server outage, which buys more real availability for this workload than a second app server would.
  The scores here are for a **single-instance** deployment, which is what this is. Re-score if that
  changes.

---

## 6. Deviations, deliberately

Recorded so a future reader does not "fix" a decision:

| Convention | What this system does | Why |
|---|---|---|
| Argon2id / bcrypt | scrypt | OWASP-approved, memory-hard, **no native dependency** — which is what makes it reliable on the Windows dev machine and in the Electron bundle. The versioned hash format means the cost is tunable without migration |
| 403 for forbidden | 404 for another tenant's resource | Existence of another establishment's location is itself information |
| Short-lived tokens + refresh rotation | 7-day sliding browser session; 1-year device session | The desktop is offline for weeks *by design*. Revocation is via `Device.status`, checked every request — long-lived is not unrevokable |
| Rate limits in Redis | In process memory | One SQLite file, one writer, one process. An external store would add a dependency and a failure mode to coordinate state with exactly one owner |
| Blanket router middleware | Per-route guards | Two routers share `/api/settings` and two share `/api/admin`. See M-3 |
