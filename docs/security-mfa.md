# MFA and third-party integrations — ready to connect

Everything here is **specified and written, but not wired in**, because each piece needs something
that does not exist yet: a client decision, an email provider, or a CDN account.

Nothing in this document is currently in the codebase. That is deliberate — half-wired
authentication code is worse than none, because it looks like a control and is not one. Each section
below is complete enough to paste and turn on in a single sitting.

Companions: **[security.md](security.md)** (findings, M-5) · **[security-runbook.md](security-runbook.md)**

---

## 1. TOTP (Google Authenticator, Authy, 1Password)

**Status:** ready to paste · **Blocked on:** the client's answer to *who must enrol*
**Effort:** roughly half a day including UI

### Why TOTP and not SMS

SMS is worse in every dimension that matters here — SIM swap, delivery cost, and a provider
dependency for something as load-bearing as sign-in. TOTP needs **no third-party service at all**:
the "integration" is the user pointing a phone camera at a QR code. That is the single biggest
reason to do this one first.

### The one open decision

Ask the client before building the UI, because it changes the enrolment flow:

| Option | Effect |
|---|---|
| **A — ADMIN only** | Smallest change. Protects cross-tenant access, leaves establishments alone |
| **B — ADMIN + OWNER** (recommended) | Protects everyone who can create users or move money-adjacent settings |
| **C — Optional for all, mandatory for ADMIN/OWNER** | Best posture. Needs a self-service enrolment screen |

STAFF should **not** be required to enrol. They sign in on a shared bar PC mid-shift, and a role
that is already restricted to appends and already uses a device PIN gains little from a second
factor — at real cost to a busy counting workflow.

### Schema

Follows the project's SQLite portability rules — no enums, no `Json`, `Float` not `Decimal`
(README rule 4). Add to `apps/server/prisma/schema.prisma`:

```prisma
/**
 * Time-based one-time password enrolment. One row per enrolled user; absence
 * means "not enrolled", so no backfill is needed for existing accounts.
 */
model UserMfa {
  userId       String   @id
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// AES-256-GCM ciphertext of the base32 TOTP secret. Encrypted, not hashed:
  /// verification needs the plaintext back. Format iv:tag:ciphertext (hex).
  secretEnc    String
  /// Enrolment is only complete once the user proves one working code, so a
  /// half-finished scan can never lock someone out of their own account.
  confirmedAt  DateTime?
  /// scrypt hashes of single-use recovery codes, newline-separated. Hashed
  /// rather than encrypted because these are only ever compared, never shown
  /// again after enrolment.
  backupCodes  String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

Add the back-relation on `User`:

```prisma
  mfa          UserMfa?
```

Then, per the Windows dev loop (`CLAUDE.md`) — stop the dev server first, and remember that migrate
does **not** regenerate the client:

```bash
npm run db:migrate && npm run db:generate
```

### `apps/server/src/auth/totp.ts`

RFC 6238 on `node:crypto`. No dependency — this is ~60 lines and every TOTP package is a wrapper
around exactly this (ponytail rung 3: the stdlib does it).

```ts
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const idx = B32.indexOf(c);
    if (idx === -1) continue; // tolerate the spaces authenticator apps display
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(buf).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const code =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** A fresh 160-bit secret, base32 for the QR code. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * `window = 1` accepts the previous and next 30-second step, absorbing clock
 * drift on a cheap phone. Do not widen it — each extra step is another valid
 * code at any instant.
 */
export function verifyTotp(secretB32: string, token: string, window = 1): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const secret = base32Decode(secretB32);
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  const given = Buffer.from(token);
  let match = false;
  for (let i = -window; i <= window; i++) {
    // No early return: comparing every candidate keeps the work constant
    // regardless of WHICH step matched.
    if (timingSafeEqual(Buffer.from(hotp(secret, counter + i)), given)) match = true;
  }
  return match;
}

/** What the QR code encodes. Scanned, never typed. */
export function otpauthUri(username: string, secretB32: string, issuer = "FNB/LIS"): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// ── Secret storage ───────────────────────────────────────────────────────────
// The secret cannot be hashed (verification needs it back), so it is encrypted
// with a key that lives OUTSIDE the database. A database leak alone then yields
// no working second factors.

function key(): Buffer {
  const raw = process.env.FNB_MFA_KEY;
  if (!raw) throw new Error("FNB_MFA_KEY is not set — MFA cannot be used without it");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("FNB_MFA_KEY must be 32 bytes, base64-encoded");
  return buf;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ct.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  const [ivHex, tagHex, ctHex] = stored.split(":");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivHex!, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex!, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ctHex!, "hex")), decipher.final()]).toString("utf8");
}
```

Generate the key once per environment and put it in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> **Losing `FNB_MFA_KEY` locks out every enrolled user.** Back it up with the same care as the
> database, and *separately from it* — storing both together defeats the point.

### Login flow

The change to `routes/auth.ts` is small, and the ordering matters:

```
password verified
      │
      ├─ no UserMfa row, or confirmedAt is null ──► issue session (unchanged)
      │
      └─ enrolled ──► DO NOT issue a session
                      return { mfaRequired: true, challenge: <short-lived token> }
                            │
                            └─ POST /api/auth/mfa/verify {challenge, code}
                                  ├─ verifyTotp OR a matching unused backup code
                                  └─ then issue the session
```

Three rules that are easy to get wrong:

1. **No session cookie before the second factor.** If the first response sets a cookie, the second
   factor is decorative.
2. **The challenge token is short-lived** (5 minutes), single-use, and bound to the user id. Keep it
   server-side — an `AuthSession` row with a `pendingMfa` flag reuses machinery that already exists
   and is already revocable.
3. **`/api/auth/mfa/verify` goes on the login rate limiter.** Add it to the `id: "login"` bucket in
   `app.ts` — a 6-digit code is 10⁶ guesses, which is only strong *because* it is throttled.

Also: a successful verification must reset `failedLoginCount`, and a failed one must increment it,
so the existing per-account lockout covers the code as well as the password. `routes/pin.ts` already
shows this pattern — both PIN proofs ride the same lockout for exactly this reason.

### Backup codes

Ten codes, shown **once** at enrolment, each usable once:

```ts
const codes = Array.from({ length: 10 }, () => randomBytes(5).toString("hex")); // 10 hex chars
const hashed = await Promise.all(codes.map(hashPassword));  // reuse auth/password.ts
// store hashed.join("\n") in UserMfa.backupCodes; return `codes` to the user ONCE
```

On use, remove that line from the stored set. Reuse `verifyPassword` for comparison — it is already
constant-time, and using the same primitive means one place to audit.

Admin reset path: `users.manage` clears a `UserMfa` row for a user in their own establishment,
following the exact scoping and audit shape of `pinAdminRoutes` in `routes/pin.ts` — which is the
model to copy, including the mandatory reason string and the transactional `logActivity`.

### Turn-on checklist

- [ ] `FNB_MFA_KEY` generated, in `.env`, backed up separately from the database
- [ ] Migration applied, `db:generate` run
- [ ] `auth/totp.ts` added
- [ ] Enrol / verify / disable routes, each writing `ActivityLog` in-transaction
- [ ] `/api/auth/mfa/verify` added to the login rate-limit bucket
- [ ] Admin reset path mirroring `pinAdminRoutes`
- [ ] Enrolment UI (QR + confirm code + backup-code download)
- [ ] Checks added to `prisma/verify-security.ts`: an enrolled user gets **no** session from password
      alone; a wrong code is refused; a used backup code cannot be reused; the challenge expires
- [ ] `security.md` M-5 moved from OPEN to FIXED

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
