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
- [ ] Exactly one ADMIN account, held by a named person

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
- [ ] `npm run verify:security -w @fnb/server` — the 38 checks behind security.md
- [ ] `npm audit --omit=dev` reviewed

---

## 2. Backup and disaster recovery

**This is the weakest part of the system (scored 30/100) and the highest-value thing to fix.**

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

SQLite in WAL mode **cannot** be backed up by copying the file while the server runs — you get a
torn database. Use the online backup API:

```bash
sqlite3 apps/server/data/fnb.db ".backup 'C:/backups/fnb-$(date +%Y%m%d-%H%M).db'"
```

That is safe against a live writer. Then verify and compress — an unverified backup is not a backup:

```bash
sqlite3 "C:/backups/fnb-20260801-1400.db" "PRAGMA integrity_check;"   # must print: ok
```

### Schedule

| Frequency | Retention | Where |
|---|---|---|
| Hourly | 48 hours | Same host, separate volume |
| Nightly | 30 days | Different physical machine |
| Weekly | 12 months | Offsite / different provider |

The offsite copy is the one that survives ransomware and fire, and it is the one people skip. It
must be **encrypted** (the file holds every client's cost prices) and **write-once** if the storage
supports it.

### Restore drill — do this quarterly

An untested backup is a belief. The drill *is* the deliverable:

```bash
# 1. Restore to a scratch path — never over the live file
cp /backups/fnb-nightly.db /tmp/restore-test.db

# 2. Structural check
sqlite3 /tmp/restore-test.db "PRAGMA integrity_check;"

# 3. Prove the NUMBERS survived, not just the file. This is the real test —
#    it re-runs the golden fixtures against the restored database.
FNB_DB_FILE=/tmp/restore-test.db npx tsx apps/server/prisma/verify-seed.ts
```

Step 3 is why this project's fixture harness earns its keep: it turns "the file opens" into "the
Full Audit still produces the numbers the client signed off on".

Record each drill in `build-log.md` with the date and the elapsed restore time. That elapsed time
is your **real** RTO, as opposed to the aspirational one above.

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
# Snapshot the database and logs BEFORE changing anything
sqlite3 apps/server/data/fnb.db ".backup '/incident/evidence-$(date +%s).db'"
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

No CI exists today (scored 20/100), so this is manual until one does.

```bash
npm audit --omit=dev          # production dependencies only
npm outdated
```

Monthly, and before any release. Treat `critical`/`high` in a production dependency as SEV-3.

`allowScripts` in the root `package.json` permits install-time lifecycle scripts for exactly five
packages — `prisma`, `@prisma/engines`, `esbuild`, `better-sqlite3`, `electron`. All genuinely need
them. **Do not extend that list casually**; an install script is arbitrary code execution on the
build machine.

### When CI exists

The minimum worth having, in priority order:

1. `npm audit --audit-level=high`
2. Secret scanning (gitleaks) — on **history**, not just the diff
3. `npm run typecheck` for both workspaces
4. All three `verify:*` harnesses
5. Protected `main`, no direct pushes

Note that the repo currently commits `apps/server/.env` to `.gitignore` correctly, but **git history
has never been scanned**. Do that once, retroactively, before the repo is ever shared:

```bash
gitleaks detect --source . --log-opts="--all"
```
