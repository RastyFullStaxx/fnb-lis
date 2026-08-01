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

38 checks against the real Hono app on a throwaway database. Same shape as `verify:seed` and
`verify:sync` — one runnable script, exits non-zero when a guarantee breaks.

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

### Score: **82 / 100** — strong application security, incomplete operational security

*(78 at the start of this pass; MFA took Authentication from 78 to 92. The remaining ceiling is
almost entirely operational — see [§4](#4-roadmap) for what each domain needs to reach 100.)*

That splits unevenly, and the split is the useful part:

| Domain | Score | Why |
|---|---|---|
| Authorization / tenancy | 92 | Genuinely strong. Server-side on every route, 404-not-403 convention, nested-relation scoping, no IDOR found |
| Audit integrity | 90 | Mutations and their log rows share a `$transaction`. Immutable records with void chains |
| Authentication | 92 | Solid primitives, correctly used, now with TOTP for ADMIN/OWNER |
| Input handling / injection | 88 | Prisma everywhere, zod on every body, no raw SQL on user input, no dynamic execution |
| Transport / edge hardening | 75 | Fixed in this pass (was ~35). Depends on TLS termination being configured correctly |
| Secrets management | 65 | `.env` untracked and clean, but no rotation, no scanning, no manager |
| Availability / DR | 30 | **The weakest domain.** Single SQLite file, no automated backup, no restore drill |
| Pipeline security | 20 | No CI at all — no dependency scanning, no secret scanning, no protected branches |

The pattern is clear and worth naming: **the code is well-built, the operations around it barely
exist.** That is the normal shape for a system in active development by one engineer, and it means
the highest-value remaining work is not in the codebase.

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

### LOW

#### L-1 · `originCheck` passes when `Origin` is absent
Deliberate and documented (`middleware/auth.ts`): non-browser callers (`curl`, the desktop) have no
`Origin`, and cookies are not at risk there. Modern browsers send `Origin` on cross-origin form
POSTs, and `SameSite=Lax` is a second independent barrier. **Not worth changing** — tightening it
breaks the desktop for no real gain.

#### L-2 · scrypt cost at the OWASP floor
N=16384 (16 MB, ~100 ms) is the stated minimum for r=8, p=1. Deliberately not higher: `/login` runs
it *before* knowing who is calling, so the work factor doubles as an unauthenticated CPU cost. Now
that H-2 caps that, raising N to 32768 is a safe one-line change — the parameters live in the hash
string, so old hashes keep verifying and no migration is needed. Do the two together.

#### L-3 · Seed credentials are uniform and public
Five accounts share `Fnb!2026`, printed in `README.md`. Correct for a dev fixture, catastrophic if
`db:seed` is ever run against production. See the runbook's pre-flight checklist.

#### L-4 · Password policy is length-only
`z.string().min(8)`. No complexity rule, no reuse prevention, no breach-list check. Modern guidance
(NIST SP 800-63B) actually favours length over composition rules, so this is defensible — but 8 is
short and a breached-password check is the single highest-value addition. See M-5's document.

#### L-5 · `allowScripts` permits lifecycle scripts for 5 packages
`prisma`, `@prisma/engines`, `esbuild`, `better-sqlite3`, `electron` — all need them, all are
legitimate. Recorded as known supply-chain surface, not a defect.

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

## 4. Roadmap

Ordered by value per unit of effort, not by severity.

### Immediate — before the first real client goes live

1. **Terminate TLS properly** and set `FNB_TRUST_PROXY=1` on the app. Everything in H-1/M-1 assumes
   this. See the runbook.
2. **Automate backups and *test a restore*.** This is the single largest remaining risk. An
   untested backup is a belief, not a backup.
3. **Change every seeded password**; delete the accounts you do not need.
4. **Turn on `SENTRY_DSN`** or an equivalent. Right now a 500 in production is invisible.

5. **Generate `FNB_MFA_KEY` and back it up separately from the database.** MFA is off until you do,
   and losing the key locks out every enrolled user.

### Short term

6. **Breached-password check** at set-password time.
7. **CI with `npm audit` + secret scanning.** There is no pipeline at all today.
8. **Raise scrypt N to 32768** (with L-2's note).
9. **Full-disk encryption on every desktop** running the mirror.

### Longer term

10. **A dedicated audit-log integrity mechanism** — hash-chained `ActivityLog` rows. This is the one
    genuinely product-shaped security feature: an audit system that can *prove* its trail is
    unaltered is a different product from one that merely stores it.
11. **Move rate-limit state out of process memory** — only if the app is ever fronted by more than
    one instance. Today it is single-process by design (`db.ts`, SQLite WAL), so in-memory is the
    correct scope, not a shortcut.
12. **Read/write database separation**, if reporting load ever justifies it.

---

## 5. Reaching 100

The gap to a perfect score, per domain, with an honest note on where 100 is not worth buying.

**Read the effort column before the list.** Six of the eight domains are already ≥88 and their
remaining points cost more than they return. Two are cheap and enormous. If you only do the rows
marked ⭐, the overall score goes from 82 to about 95.

### Availability / DR — 30 → 100 ⭐ *the single biggest win available*

| Step | Effort | Gets you to |
|---|---|---|
| ⭐ Hourly `sqlite3 .backup` + nightly offsite, encrypted | 2 h | 65 |
| ⭐ **A restore drill that re-runs the golden fixtures** (runbook §2) | 1 h | 80 |
| Quarterly drill on a calendar, elapsed time recorded in `build-log.md` | ongoing | 88 |
| Documented RPO/RTO **agreed with the client**, not just proposed | 1 h | 93 |
| Automated backup-integrity check + alert when a backup is missed | 3 h | 100 |

The drill is the part people skip and the only part that proves anything. Restoring a file proves
the file opens; re-running `verify-seed.ts` against the restored database proves the **Full Audit
still produces the numbers the client signed off on**. Nothing else in this list matters if that
one is missing.

### Pipeline / DevSecOps — 20 → 100 ⭐ *cheapest points on the board*

| Step | Effort | Gets you to |
|---|---|---|
| ⭐ GitHub Actions: `typecheck` ×2 + all three `verify:*` on every push | 1 h | 55 |
| ⭐ `npm audit --audit-level=high` in the same workflow | 15 min | 70 |
| ⭐ `gitleaks detect --log-opts="--all"` — **scan history once**, then per-push | 30 min | 82 |
| Branch protection on `main`, no direct pushes | 10 min | 88 |
| Dependabot/Renovate with grouped weekly PRs | 30 min | 94 |
| Build provenance (`actions/attest-build-provenance`) for desktop installers | 2 h | 100 |

You already have the hard part — three real verification harnesses. They just never run unless
someone remembers. That is the whole gap.

### Secrets — 65 → 100

| Step | Effort | Gets you to |
|---|---|---|
| ⭐ `FNB_MFA_KEY` generated and backed up **separately from the database** | 10 min | 78 |
| Documented rotation schedule, and one rehearsed rotation | 1 h | 86 |
| Secret manager (Infisical/Doppler) once >1 host or >1 operator | 3 h | 95 |
| Automatic rotation with zero-downtime re-encryption | 1 d | 100 |

Below two hosts and one operator, a permissioned `.env` genuinely is the right answer — the
manager's remaining points are for a team you do not have yet.

### Transport / edge — 75 → 100

| Step | Effort | Gets you to |
|---|---|---|
| ⭐ TLS terminated + `FNB_TRUST_PROXY=1` with an overwriting proxy | 1 h | 90 |
| CSP `style-src` nonce, dropping `'unsafe-inline'` | 4 h | 95 |
| CSP violation reporting endpoint | 2 h | 98 |
| HSTS preload submission | 30 min | 100 |

Everything after the first row is defence-in-depth on top of a CSP that already blocks script
injection. The `style-src` work means threading a nonce through the SPA build for shadcn's chart
primitive — real effort, small return.

### Authentication — 92 → 100

| Step | Effort | Gets you to |
|---|---|---|
| Breached-password check (k-anonymity range query against HIBP) | 2 h | 96 |
| Raise scrypt N to 32768 (one line — cost is in the hash string) | 5 min | 98 |
| WebAuthn as an *option* alongside TOTP | 1–2 d | 100 |

The HIBP check is the only one worth doing soon: "8 characters" plus a password already in a breach
corpus is the realistic failure, and the range-query API never sees the password.

### Authorization / tenancy — 92 → 100

| Step | Effort | Gets you to |
|---|---|---|
| Extend `verify-security.ts` to assert **every** route rejects a foreign tenant | 4 h | 98 |
| A route-manifest test that fails when a new route ships with no guard | 4 h | 100 |

The second is the one that actually changes the future: today, adding an unguarded route is caught
by review or not at all. Both findings in this audit that touched authorization (M-3, and the SPA
gate bug) were *ordering* mistakes, not missing checks — a manifest catches exactly that class.

### Input handling / injection — 88 → 100

| Step | Effort | Gets you to |
|---|---|---|
| Content-sniff uploads instead of trusting the extension (`detectSource`) | 2 h | 94 |
| Fuzz the import parsers against malformed CSV/XLSX | 1 d | 98 |
| Formal schema coverage assertion across every route | 4 h | 100 |

The upload one is worth doing: `detectSource` picks a parser from the *filename*, so a mislabelled
file reaches the wrong parser. It is not a vulnerability today — the stored file is never served
back and both parsers are memory-safe — but it is the kind of assumption that becomes one.

### Audit integrity — 90 → 100 · *the one worth doing for the product, not the score*

| Step | Effort | Gets you to |
|---|---|---|
| Hash-chain `ActivityLog` rows (each row carries the previous row's hash) | 1 d | 97 |
| Periodic chain verification + an anchor published outside the database | 2 d | 100 |

This is the only item on this page that is a **product feature**. Every competitor can say their
system logs changes. A system that can *prove* its trail has not been altered — including by
whoever holds the database — is a different claim, and it is exactly the claim this client's whole
business rests on. If any of the 100-point work gets built, build this one.

### What "100" does not mean

No high-availability cluster, no Redis, no WAF appliance. Each establishment's desktop mirror keeps
working through a total server outage, which buys more real availability for this workload than a
second app server would. The scores above are for a **single-instance, single-tenant-per-database
deployment**, which is what this is. Re-score if that ever changes.

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
