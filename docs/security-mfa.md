# MFA and third-party integrations

**Section 1 (TOTP) is BUILT and shipped** — 2026-08-01, required for ADMIN and OWNER.
Sections 2–5 remain specified but not wired, each blocked on something that does not exist yet: an
email provider, a CDN account, or a deployment topology.

Companions: **[security.md](security.md)** (findings, M-5) · **[security-runbook.md](security-runbook.md)**

---

## 1. TOTP (Google Authenticator, Authy, 1Password) — **SHIPPED**

Required for **ADMIN and OWNER** (client decision 2026-08-01), optional for everyone else.

STAFF are deliberately excluded from the requirement: they sign in on a shared bar PC mid-shift,
already carry a device PIN, and are already restricted to appends. Demanding a phone code there
costs a counting workflow real time and buys very little.

**No third-party service is involved.** The "integration" is a user pointing a phone camera at a QR
code. SMS was never on the table — SIM swap, delivery cost, and a provider dependency on the
sign-in path.

### Turning it on

MFA is **off until a key exists**. That is the switch:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put it in `apps/server/.env` as `FNB_MFA_KEY=…` and restart.

> **Losing `FNB_MFA_KEY` locks out every enrolled user.** Back it up with the same care as the
> database, and *separately from it* — storing both together defeats the point.

`FNB_REQUIRE_MFA=0` keeps enrolment available but stops enforcing it, for a staged rollout.

A dev key was generated into `.env` on 2026-08-01. Generate a **fresh one** for production.

### What it does at sign-in

```
password verified
      │
      ├─ not enrolled ─────────► session issued (unchanged)
      │
      └─ enrolled ────────────► NO session, NO cookie, NO device registration
                                { mfaRequired: true, challenge, expiresAt }
                                      │
                                      └─ POST /api/auth/mfa/verify
                                            ├─ TOTP code, or a single-use recovery code
                                            └─ THEN the session is issued
```

Five decisions worth not undoing:

1. **The password buys exactly one thing: the right to present the second factor.** No cookie, no
   `auth.login` entry, and no device registration happens in step one. Registering a device there
   would consume a licence slot for someone who has proved only half their credentials.
2. **`MfaChallenge` is its own table, not a flag on `AuthSession`.** A half-authenticated row living
   in the session table needs every reader to remember to check the flag, and forgetting once fails
   *open*. A challenge simply is not a session, so no code path can mistake it for one.
3. **Enrolment is unconfirmed until a code is proved.** A mis-scan or an abandoned QR screen cannot
   lock someone out of their own account.
4. **Login is never hard-blocked; the app is.** Refusing an unenrolled ADMIN's login would lock out
   the only administrator with no way back in. They sign in, and `requireMfaEnrolment` refuses
   everything except `/api/auth/*` until they enrol.
5. **The challenge is single-use and 5-minute.** It dies with the attempt that spends it, so a
   captured token cannot be replayed against a second guess.

### The desktop is NOT exempt

It was, briefly, and that was the single worst bug of the engagement.

The exemption was written as `if (!device && isMfaAvailable())` — gating a security control on
`device`, which is **unauthenticated request body**. Nothing proves the caller is the Electron app:
no client certificate, no shared secret, no signature. So a phished password plus an invented
fingerprint bought a full session with no code, and because registering a machine needs
`devices.manage` = `[ADMIN, OWNER]` — the same set as `MFA_REQUIRED_ROLES` — the exemption was
available to exactly the roles that must never have it. The session was device-bound, so it lasted
**365 days** and suppressed the enrolment gate permanently.

**A control must never be switched off by data the caller supplies.** If the exemption cannot be
proved, it cannot exist.

Every enrolled account now presents its factor, desktop or not. The device payload rides the
challenge (`MfaChallenge.deviceJson`) so no machine is registered on half a credential, and the
offline story is untouched: registration happens at the server, over the network, with the owner
standing at the machine — exactly when a phone is to hand. Once registered, the desktop verifies
PINs locally against its mirror and does not re-authenticate here.

`Device.status`, re-checked on every request, remains the revocation control for a stolen machine.

### `x-acting-user` may only narrow privilege

The header names which staff member is working, for attribution. It was adopting the claimed user's
**role** with no proof, so anyone able to obtain a device session could name the OWNER and hold
`users.manage`. That was reachable by ordinary staff: `resolveDevice` returns an already-registered
machine to any user of the establishment, checking `devices.manage` only when registering a new one.

It is now capped at the session holder's own role, and an attempt to widen is logged.

### Recovery

- **Ten single-use codes**, shown once at enrolment, stored as scrypt hashes. Grouped `xxxx-xxxx`
  because they get written on paper and read back under pressure.
- A recovery-code sign-in is **distinguishable in the audit trail** (`"signed in using a recovery
  code"`) — worth alerting on, since it means a lost authenticator or someone else's codes.
- **Self-disable is refused for ADMIN and OWNER**, and so is resetting your OWN factor through the
  admin route. Lost phones go through `DELETE /api/admin/users/:id/mfa` performed by **someone
  else** — a second human, present, holding `users.manage`, with a mandatory reason and a
  transactional audit entry.
- **Keep two ADMIN accounts.** They can reset each other. A lone ADMIN who loses phone and codes has
  no in-app path back; the escape hatch is `npm run mfa:reset -w @fnb/server -- <username>
  "<reason>"`, which needs a shell on the host and logs `mfa.breakGlassReset`.

### Where it lives

| Path | What |
|---|---|
| `apps/server/src/auth/totp.ts` | RFC 6238 on `node:crypto` — no dependency. AES-256-GCM secret storage |
| `apps/server/src/routes/mfa.ts` | Enrol / confirm / disable, and the admin reset |
| `apps/server/src/routes/auth.ts` | The two-step login and `completeLogin` |
| `apps/server/src/middleware/auth.ts` | `requireMfaEnrolment` — the server-side gate |
| `apps/web/src/pages/account-security.tsx` | Enrolment UI (QR, recovery codes) |
| `apps/web/src/pages/login-mfa.tsx` | The code prompt |
| `packages/core/src/constants.ts` | `MFA_REQUIRED_ROLES` — change the policy here |

**Why the algorithm is hand-written:** every TOTP package is a wrapper around ~60 lines of HMAC and
truncation, and an auth primitive with a supply chain is a worse trade than code you can read.
SHA-1 is not a choice — it is what RFC 6238 specifies and what every authenticator app implements;
its collision weakness does not apply to HMAC-SHA1.

### Changing the policy

`MFA_REQUIRED_ROLES` in `packages/core/src/constants.ts`. Adding a role takes effect on that role's
next request — existing sessions are not evicted, they are gated. Removing one lifts the gate
immediately and lets those users self-disable.

### Verified

`npm run verify:security -w @fnb/server` — around 50 of its 119 checks cover MFA, including: an
unenrolled ADMIN can still sign in but is refused everything else; an unconfirmed enrolment does not
lift the gate; a password alone sets no session cookie; a challenge cannot be replayed; a recovery
code works once and not twice; a required role cannot self-disable; **a device payload does not
bypass the factor and registers no machine**; **STAFF cannot become OWNER via `x-acting-user`**;
**an administrator cannot reset their own factor**; **an enrolled account fails closed when the key
is missing**; and with no `FNB_MFA_KEY` the whole feature is off.

Five of those checks exist because an adversarial review found the bugs they now pin — including one
case where the harness had asserted the **opposite** and scored a critical bypass as a pass.

Also driven end-to-end in a real browser against the production build: gate → enrolment → QR →
code → recovery codes → two-step login → dashboard.

---

## 2. Email — verification and password reset

**Status:** specified · **Blocked on:** no provider account, and no self-service reset today

Password reset is currently admin-mediated: an OWNER or ADMIN sets a new password (which, since
M-4, also evicts that user's sessions). For a system whose users work in one building with their
manager present, **that is a legitimate design** and arguably safer than an emailed link. Add email
only if the client asks for self-service.

If they do:

- **Provider:** Resend or AWS SES. Both are a single HTTPS call — no SDK needed.
- **Token:** 32 bytes from `randomBytes`, stored **hashed** (same pattern as `AuthSession.tokenHash`
  — never store a live reset token), 30-minute expiry, single-use, invalidated on use *and* on any
  password change.
- **Response must not reveal whether an address exists** — always answer "if that address is on
  file, a link is on its way". Note the M-2 lesson: make the *timing* uniform too, or the message
  is undone by the clock.
- **Rate limit by both address and IP.**
- **Reset must evict sessions**, matching M-4.
- `User.email` is already nullable and optional; a reset flow needs it verified before it can be
  trusted as a recovery channel.

---

## 3. WAF, CDN, and DDoS

**Status:** not needed yet · **Blocked on:** deployment topology

The in-process rate limiter (H-2) handles application-layer abuse for a single-instance deployment,
which is what this is. A volumetric attack has to be absorbed upstream — no application-layer code
can help.

**When there is a public hostname, put Cloudflare (free tier) in front.** It gives, for roughly an
hour of DNS work: volumetric absorption, TLS at the edge, bot filtering, and a managed WAF ruleset.

Two settings that specifically matter here:

- **Do not cache `/api/*`.** Caching an authenticated response is how one establishment's Full Audit
  gets served to another. Cache-poisoning of a report is a data-integrity incident in this product,
  not just a stale page.
- Restrict origin access to Cloudflare IPs, or use a Tunnel, so port 3001 is never reachable
  directly.

With Cloudflare in front, `FNB_TRUST_PROXY=1` becomes **required** — and `CF-Connecting-IP` is then
the more reliable source than the XFF chain. If you switch to it, update `clientIp()` in
`middleware/security.ts` and the M-1 note in `security.md` together.

---

## 4. Secret management

**Status:** `.env` on disk · **Adequate for one host**

`.env` is untracked and correct today. It becomes inadequate the moment there is more than one
server or more than one person deploying.

- **1 host, 1 operator (now):** `.env` with restricted filesystem permissions. Fine.
- **Multiple hosts / operators:** Infisical or Doppler (both have usable free tiers), or the cloud
  provider's own manager.

Secrets in play: `ANTHROPIC_API_KEY`, `SENTRY_DSN`, and — once section 1 ships — `FNB_MFA_KEY`.

**Rotation:** `ANTHROPIC_API_KEY` quarterly and on any suspected compromise. `FNB_MFA_KEY` cannot be
rotated without re-encrypting every `UserMfa.secretEnc`; if you ever need to, decrypt-then-re-encrypt
in a single migration script and take a database backup first.

Run `gitleaks` against **full history** once, before this repo is shared with anyone
(`security-runbook.md` §5).

---

## 5. Hardware security keys (WebAuthn / FIDO2)

**Status:** not planned · **Recommendation: do not build this**

Phishing-resistant and genuinely the strongest option, but it needs a real dependency
(`@simplewebauthn/server`), per-credential storage, and an attestation policy — and it protects
against phishing, which is not this system's realistic threat. The adversary here is an insider with
legitimate access trying to alter history, and a hardware key does nothing about that.

Revisit only if a client's own compliance regime requires it. The TOTP schema above does not block
it — a WebAuthn credential table sits alongside `UserMfa` without conflict.
