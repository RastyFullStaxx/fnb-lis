# Security runbook

Operational procedures: deploy, back up, detect, respond. Companion to
**[security.md](security.md)** (what is true and why) and **[security-mfa.md](security-mfa.md)**
(what is ready to connect).

This is the document to follow when something is happening, so it is written as checklists rather
than prose.

---

## 1. Production pre-flight

Run through this **once per environment**, before the first real client's data lands. Anything
unchecked is a known-accepted risk, not an oversight — write down which ones you accepted.

### Secrets and accounts

- [ ] `apps/server/.env` exists, is **not** tracked (it is in `.gitignore` — verify with
      `git ls-files | grep env`, which should show only `.env.example`)
- [ ] `ANTHROPIC_API_KEY` is a **production-scoped** key, not a personal one
- [ ] Every seeded password changed. The seed ships five accounts sharing `Fnb!2026`, published in
      `README.md`
- [ ] Unused seed accounts **deleted**, not merely disabled
- [ ] `npm run db:seed` is **not** wired into any deploy script. It is idempotent, which makes it
      *more* dangerous in production, not less — it will happily re-create demo clients
- [ ] **At least TWO ADMIN accounts**, each held by a named person. An administrator cannot reset
      their own second factor and an OWNER cannot manage an ADMIN, so a lone ADMIN who loses both
      their phone and their recovery codes has no path back through the app — only the break-glass
      below

### Transport

- [ ] TLS terminated (Caddy is the least-effort option — automatic certificates)
- [ ] `FNB_TRUST_PROXY=1` set on the app **and** the proxy overwrites `X-Forwarded-For` rather than
      appending. Both, or neither — setting the flag without a proxy that overwrites re-opens M-1
- [ ] Plain HTTP redirects to HTTPS
- [ ] Confirm `Secure` is present:
      `curl -sI https://<host>/api/auth/login -X POST | grep -i set-cookie`
- [ ] Confirm headers arrive: `curl -sI https://<host>/api/health | grep -iE 'content-security|strict-transport|x-frame'`

Minimal Caddy config — this is the whole file:

```
books.example.com {
    encode gzip
    reverse_proxy localhost:3001 {
        header_up X-Forwarded-For {remote_host}
    }
}
```

`header_up X-Forwarded-For {remote_host}` **sets** rather than appends. That is the line M-1 depends
on.

### Process and filesystem

- [ ] Server runs as a **non-administrator** account
- [ ] `apps/server/data/` readable only by that account (it holds the database and every uploaded
      import)
- [ ] Port 3001 is **not** reachable from outside the host — only the proxy reaches it
- [ ] Full-disk encryption on the server, and on **every** desktop running the mirror
- [ ] A process supervisor restarts the app on crash (Windows Service, NSSM, or pm2)

### Verify

- [ ] `npm run typecheck -w @fnb/server` and `-w @fnb/web`
- [ ] `npm run verify:seed -w @fnb/server` — golden fixtures intact
- [ ] `npm run verify:sync -w @fnb/server` — offline mirror guarantees
- [ ] `npm run verify:security -w @fnb/server` — the 119 checks behind security.md
- [ ] `npm run audit` passes (the gate, with its reviewed exceptions — see §5)
- [ ] Both ADMINs enrolled in two-factor, recovery codes stored somewhere that is not the same
      place as the password
- [ ] `npm run backup -w @fnb/server` then `npm run restore-drill -w @fnb/server` — prove the backup path works BEFORE you need it

---

## 2. Backup and disaster recovery

Backup, verification, retention and the restore drill are now scripted (`npm run backup` /
`npm run restore-drill`). What is left is **operational**: schedule them, put the copies somewhere
else, and actually run the quarterly drill.

### Objectives

| | Target | Rationale |
|---|---|---|
| **RPO** (max data loss) | **1 hour** | One hour of counts and sales is re-enterable from paper and till tape. A day is not |
| **RTO** (max downtime) | **4 hours** | An establishment can run a shift on paper. It cannot run a month-end close on paper |

These are proposals. The client has not signed off on them — that conversation belongs in
`project-overview.md`'s open-decisions list.

### What must be backed up

1. `apps/server/data/fnb.db` — **everything transactional**
2. `apps/server/data/uploads/` — source documents for every AI-extracted import. An audit whose
   supporting documents vanished is weakened, so these are not disposable
3. `apps/server/.env` — separately, and encrypted. Never in the same store as the database

### Taking a backup

```bash
npm run backup -w @fnb/server
```

That is the whole thing — a script rather than a command to memorise, because the obvious command is
wrong in two ways: the `sqlite3` CLI is **not installed** on this machine (checked), and a plain file
copy of a WAL-mode database yields a torn database that opens fine and is missing the most recent
commits.

The script uses `better-sqlite3`'s online backup API — safe against a live writer — and then:

1. **Verifies before keeping.** `integrity_check` runs on the copy; a failure deletes it. A corrupt
   backup sitting in the directory looking like a backup is worse than a missing one, because it is
   the one you will reach for.
2. **Writes a manifest** beside it — row counts plus a Full Audit fingerprint per location, computed
   from the backup itself. This is what the restore drill checks against.
3. **Copies new uploads.** They are SHA-256-named and immutable, so "copy what isn't there" is a
   correct incremental sync.
4. **Prunes on the tiered schedule below**, so it can run hourly forever without either filling the
   disk or losing last month's history.

Two environment variables:

| | |
|---|---|
| `FNB_BACKUP_DIR` | Where backups go. **Point this at a different volume** — the default sits beside the database, where one failed disk takes both |
| `FNB_UPLOADS_DIR` | Source of import files, if not the default |

### Schedule

| Frequency | Retained | Where |
|---|---|---|
| Hourly | 48 hours, all of them | Separate volume (`FNB_BACKUP_DIR`) |
| Daily | 30 days, one per day | Different physical machine |
| Weekly | 52 weeks, one per week | Offsite / different provider |

Retention is enforced by the script. The **offsite** copy is the one that survives ransomware and
fire, and it is the one people skip: sync `FNB_BACKUP_DIR` elsewhere, encrypted, ideally write-once.

On Windows, hourly via Task Scheduler — one line, run once:

```bash
schtasks /create /tn "FNB backup" /sc hourly /ru SYSTEM /tr "cmd /c cd /d C:\xampp\htdocs\fnb-lis && npm run backup -w @fnb/server"
```

**`.env` is deliberately not backed up.** It holds `FNB_MFA_KEY`, and putting the encryption key in
the same archive as the ciphertext it protects defeats the point. Back it up separately, encrypted,
somewhere the database backups are not.

### Restore drill — do this quarterly

An untested backup is a belief. The drill *is* the deliverable:

```bash
npm run restore-drill -w @fnb/server
```

It restores the newest backup to a scratch path (never over the live file) and checks four things:

1. `integrity_check` and `foreign_key_check` — is it a valid, internally consistent SQLite file?
2. **Migration state** — is the schema the one this code expects? A backup taken before a migration
   restores fine and then fails at runtime in a much more confusing way.
3. **Row counts vs its own manifest** — did anything silently fall out?
4. **The Full Audit digest** — re-runs the real reconciliation for every location's latest committed
   period and compares it to what the backup recorded.

**Step 4 is the one that matters and the one nobody does.** Restoring a file proves the file opens.
Re-running the reconciliation proves the Full Audit — the single report this client trusts
absolutely — survives a restore intact. It is sensitive enough to catch a *single altered count
line*, a corruption `integrity_check` cheerfully reports as "ok".

Everything is compared against the backup's **own manifest**, never against the live database. Live
moves; a backup does not. Comparing to live makes the drill fail on ordinary business activity, and
a check that cries wolf is a check nobody runs.

It then reports, without asserting, how far behind live the backup is — **that number is your
measured RPO**: exactly the work a restore would discard.

Record the elapsed time in `build-log.md`. **That is your real RTO**, as opposed to the aspirational
one above. Measured 2026-08-01: **4.4 s** on the dev dataset.

### Failure scenarios

| What broke | Response |
|---|---|
| **Database corrupted** | Stop the app. Restore latest good backup. Re-run integrity + fixture check. Devices re-push their outboxes on reconnect — `POST /sync/reconcile` is exactly the "what did you never receive?" probe for this |
| **Host lost entirely** | Rebuild from source, restore `.env` and database, re-point DNS. The desktop mirrors keep operating offline throughout — this is the scenario the offline architecture was built for |
| **Ransomware** | Do **not** pay. Rebuild clean, restore from the offsite write-once copy. Assume credentials were taken: rotate `ANTHROPIC_API_KEY`, force a password reset for all users (which now also evicts sessions — M-4) |
| **A bar PC is stolen** | Revoke the device (`POST /api/admin/devices/:id/revoke`). Access dies the moment it next reaches the server. The thief holds PIN hashes, **not** password hashes — deliberately, so one theft does not become remote access. Still: clear those users' PINs |
| **Accidental bad data commit** | Do **not** edit rows. Void with a `correctionOfId` chain — that is what the immutability rule exists for |

### High availability — deliberately not built

Single process, single SQLite file, no failover. That is a **fit-for-purpose** choice, not an
omission: each establishment's desktop mirror keeps working through a total server outage, which
buys more real availability for this workload than a second app server would. Revisit only if
clients start depending on the browser as their primary interface. Moving to HA means Postgres,
which the schema was written to allow (no enums, no `Json`, `Float` not `Decimal`).

---

## 3. Monitoring and detection

### Turn on error reporting

`lib/telemetry.ts` is a no-op until `SENTRY_DSN` is set, and the SDK is imported lazily so nothing
loads without it. It sends **the error object only** — never request bodies, which carry inventory
figures. Set it:

```bash
SENTRY_DSN=https://...@....ingest.sentry.io/...
npm install @sentry/node -w @fnb/server
```

Without this, a 500 in production is invisible.

### What the system already records

`ActivityLog` is written **inside the same transaction** as the mutation, so "it happened but
nothing recorded it" is unreachable. Every row carries actor, timestamp, action, entity, and a
details blob with before/after where relevant.

Already logged: `auth.login`, `auth.logout`, `auth.autoLogout`, `auth.revoke`, `pin.set`,
`pin.recover`, `pin.adminClear`, `user.create`, `user.update` (now including session eviction
counts), `user.access`, `device.*`, `draft.release`, `subscription.*`, `settings.*`, `import.*`,
and every void/correction.

### Signals worth alerting on

Query these against `ActivityLog`; none needs new instrumentation:

| Signal | Query shape | Why it matters |
|---|---|---|
| PIN recovery used | `action = 'pin.recover'` | The weakest credential path. Should be **rare** — the code comments call it a last resort |
| Repeated lockouts | `action = 'device.pinLockout'`, or `User.failedLoginCount >= 5` | Guessing, or a genuinely stuck user |
| Off-hours voids | `action LIKE '%.void'` outside trading hours | The insider-tampering signature this product exists to expose |
| New device registered | `Device` rows created | Consumes a licence slot and grants offline access to the whole catalog |
| ADMIN created | `action = 'user.create'` with role ADMIN | Should approach never |
| Rate limiter firing | HTTP 429 in proxy logs | Active guessing, or a limit set too tight |
| Stale mirrors | `GET /api/locations/:id/sync/status` → `anyStale` | Reports built right now may be missing a machine's work |

### Health

`GET /api/health` returns `{ok: true}`. It is unauthenticated and rate-limited with everything else.
Point the supervisor and any uptime monitor at it.

---

## 4. Incident response

### Severity

| | Meaning | Response |
|---|---|---|
| **SEV-1** | Cross-tenant data exposure, audit-trail tampering, or credential compromise | Immediate. Take the service down if that is what containment needs |
| **SEV-2** | Single-tenant unauthorised access, or a working exploit with no confirmed use | Same day |
| **SEV-3** | A vulnerability with no evidence of exploitation | Next working day |

### Procedure

**1 — Contain.** Preserve evidence *first*; it is the thing you cannot recover later.

```bash
# Snapshot the database BEFORE changing anything. Same online-backup path as the
# scheduled job, so it is safe while the server is still running — and it writes
# a manifest, which timestamps and fingerprints the evidence.
FNB_BACKUP_DIR=/incident npm run backup -w @fnb/server
```

Then, as appropriate:

- Kill one user's sessions — `POST /api/admin/users/:id/sessions/:sessionId/revoke` (logged, with a
  required reason)
- Kill **all** of a user's sessions — reset their password; M-4 makes that evict every session
- Cut off a machine — `POST /api/admin/devices/:id/revoke`
- Cut off an establishment — set `Client.status` to non-ACTIVE
- Full stop — stop the process; desktops keep working offline

**2 — Assess.** `ActivityLog` is the primary source and cannot have gaps for successful mutations.

```sql
-- Everything an actor did, most recent first
SELECT ts, action, entity, entityId, summary, detailsJson
FROM ActivityLog WHERE userId = ? ORDER BY ts DESC;

-- Sessions still live for that user
SELECT id, ip, userAgent, createdAt, expiresAt
FROM AuthSession WHERE userId = ? AND expiresAt > datetime('now');
```

Treat pre-2026-08-01 `ip` values as **unreliable** — before M-1 they came from a spoofable header.
`userAgent` was and remains client-supplied and is a hint, never proof.

**3 — Eradicate and recover.** Patch. Rotate `ANTHROPIC_API_KEY` and any credential that could have
been read. Force password resets for affected users. Restore from a backup predating the compromise
if data integrity is in doubt — and prefer void-and-correct over editing rows, so the incident
itself stays in the audit trail.

**4 — Review.** Within a week: what happened, what was affected, what the detection gap was, what
changes. Add a check to `verify-security.ts` for the specific hole. Record it in `build-log.md`.

### Sealing pre-chain history

Entries written before hash-chaining shipped carry no hash. The verifier reports them as
`unchained` rather than calling them corrupt, and they can be sealed once:

```bash
npm run seal-history -w @fnb/server            # dry run — writes nothing
npm run seal-history -w @fnb/server -- --confirm
```

**Sealing does not prove the old entries are authentic.** It hashes them exactly as they stand, so
anything already altered is frozen in as correct. What it buys is that from that moment they can no
longer be edited or deleted without detection. The honest name is *trusted-on-seal*, which is why
the run records itself in the trail as `activity.sealHistory` — nobody later has to wonder whether
that history was verified from origin or trusted at a point in time.

Run it while you still have reason to believe the history is good. Idempotent, so a re-run is a
no-op, and the whole batch is one transaction — a half-sealed chain would read as a break.

Sealed on the development database 2026-08-02: 420 entries, chain verifies, tamper-detection
confirmed against an edit of a sealed row.

### Break-glass: an administrator locked out of their own MFA

A lone ADMIN who has lost their authenticator **and** their ten recovery codes cannot be helped
through the application. That is deliberate — self-reset would let a stolen session remove the
factor and re-enrol a different phone, and an OWNER managing an ADMIN would break tenant isolation.

From a shell on the server:

```bash
npm run mfa:reset -w @fnb/server -- <username> "who asked, and why"
```

It requires something the network cannot supply — a shell on the host and write access to the
database — which is a stronger proof of authority than any in-app flow. It clears the factor, ends
every live session for that account, and writes `mfa.breakGlassReset` to the activity trail with
the reason. Using it is therefore visible afterwards.

**Prefer a second administrator.** Two ADMINs can reset each other through the API, with the same
mandatory reason and audit entry, and without anyone needing server access. That is why §1 asks for
two.

### Notification

Philippine **Republic Act 10173 (Data Privacy Act)** requires notifying the National Privacy
Commission and affected individuals **within 72 hours** of knowledge of a breach involving sensitive
personal information likely to cause real harm.

This system holds staff names, usernames, and email addresses — personal information, though not the
"sensitive personal information" category that most clearly triggers mandatory notification. **Get
legal advice on the specific incident rather than deciding from this paragraph.** Clients should be
told about exposure of their commercial data regardless of whether the law compels it; it is their
data and their competitors who would want it.

---

## 5. Dependency and supply-chain hygiene

```bash
npm run audit
```

Not bare `npm audit`. That has two end states in CI and both are useless: it blocks every build over
an advisory nobody can reach, or somebody appends `|| true` and it silently stops meaning anything.

`scripts/audit-gate.mjs` instead scopes to the workspaces that actually **ship** (`@fnb/server`,
`@fnb/web` — not the Electron builder toolchain), and carries exceptions that are written down,
justified by an actual traced call path, and **expiring**. When an exception lapses the build fails
and a human looks again, which is the behaviour you want from an accepted risk as opposed to a
forgotten one.

Two exceptions are live as of 2026-08-01, both expiring 2026-11-01:

| Package | Why it is accepted |
|---|---|
| `brace-expansion` | ReDoS/OOM via attacker-controlled **glob patterns**. Reached only as exceljs → archiver → glob → minimatch, where the patterns are archiver's own constants. No user input reaches a glob here — uploads are named from a SHA-256 and never globbed |
| `fast-uri` | URI host confusion, present only via the **Prisma CLI** (`prisma` → `@prisma/dev` → ajv), which runs at migrate/generate time and is never loaded by the running server |

`npm audit fix` resolves `fast-uri` by bumping the Prisma CLI to 7.9.1 while `@prisma/client` stays
7.8.0. A split Prisma toolchain under a system whose entire value is numerical correctness is the
worse trade — so it is refused deliberately, not overlooked.

**Fixed rather than excepted on 2026-08-01:** `react-router` (RSC-mode CSRF bypass) — patched
8.1.0 → 8.3.0. Not exploitable here (this is a Vite SPA with no RSC), but it was a free patch on
code that actually ships.

`allowScripts` in the root `package.json` permits install-time lifecycle scripts for exactly five
packages — `prisma`, `@prisma/engines`, `esbuild`, `better-sqlite3`, `electron`. All genuinely need
them. **Do not extend that list casually**; an install script is arbitrary code execution on the
build machine.

### CI

`.github/workflows/ci.yml` runs on every push and PR, weekly on a schedule, and on demand:

| Job | What |
|---|---|
| **verify** | Typecheck both workspaces, then all three harnesses (`verify:seed`, `verify:sync`, `verify:security`), then the web build |
| **audit** | The audit gate above |
| **secrets** | Gitleaks, with `fetch-depth: 0` |

That `fetch-depth: 0` matters: gitleaks must see **history**, not just the diff. A key committed and
removed in the next commit is still in the pack file, still published, and still valid. Scanning
only the diff is what lets that sit undetected for a year.

Still to do by hand, once:

- [ ] Enable branch protection on `main` — no direct pushes, CI must pass
- [ ] Run gitleaks against full history retroactively before this repo is shared with anyone
- [ ] Consider Dependabot or Renovate with grouped weekly PRs
