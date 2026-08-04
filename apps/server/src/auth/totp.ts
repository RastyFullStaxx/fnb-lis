import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * TOTP (RFC 6238) on node:crypto — no dependency.
 *
 * Every TOTP package is a wrapper around exactly this, and an auth primitive
 * with a supply chain is a worse trade than sixty lines we can read. SHA-1 is
 * not a choice here: it is what the algorithm specifies and what every
 * authenticator app implements. Its collision weakness is irrelevant to
 * HMAC-SHA1, which is unbroken.
 *
 * See docs/security-mfa.md.
 */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
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
  let bits = 0;
  let value = 0;
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
 * drift on a cheap phone. Do not widen it: each extra step is another code that
 * is valid at any given instant.
 *
 * No early return on match — every candidate is compared so the work is
 * constant regardless of WHICH step matched, and each comparison is
 * `timingSafeEqual`.
 */
export function verifyTotp(secretB32: string, token: string, window = 1): boolean {
  return verifyTotpStep(secretB32, token, window) !== null;
}

/**
 * Which 30-second step this code belongs to, or null.
 *
 * The step is returned so the caller can record it and refuse to accept the
 * same one twice (RFC 6238 §5.2). Without that, `window = 1` leaves a single
 * 6-digit code usable for ~90 seconds — ample for anyone who watched it being
 * typed or captured it in transit.
 *
 * Still no early return: every candidate is compared regardless of which one
 * matched, so the work is constant, and each comparison is `timingSafeEqual`.
 */
export function verifyTotpStep(secretB32: string, token: string, window = 1): number | null {
  const cleaned = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return null;
  const secret = base32Decode(secretB32);
  if (secret.length === 0) return null;
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  const given = Buffer.from(cleaned);
  let matched: number | null = null;
  for (let i = -window; i <= window; i++) {
    if (timingSafeEqual(Buffer.from(hotp(secret, counter + i)), given)) matched = counter + i;
  }
  return matched;
}

/** What the QR code encodes. Scanned, or typed by hand from the same secret. */
/**
 * `issuer` is what an authenticator app shows above the code, so it is brand
 * copy, not an internal name. It was "FNB/LIS" — the repository's codename —
 * which told a bar owner nothing and matched no label anywhere else in the
 * product.
 *
 * Safe to change now and only now: the issuer is baked into each otpauth URI at
 * ENROLMENT time, so altering it cannot rename an entry already in someone's
 * phone. Every enrolment was cleared by the 2026-08-04 reseed, so there are
 * none to leave stranded on the old label.
 */
export function otpauthUri(username: string, secretB32: string, issuer = "Liquor Inventory Solution"): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// ── Secret storage ───────────────────────────────────────────────────────────

/**
 * MFA is available only when a key is configured.
 *
 * Deliberately the on-switch for the whole feature. Without a key the secrets
 * could not be encrypted, and enforcing "ADMIN must enrol" while enrolment is
 * impossible would brick the administrator account with no way back in. So a
 * missing key means MFA is simply off — fail-safe, and it makes setting
 * FNB_MFA_KEY the single deliberate act that turns the feature on.
 */
export function isMfaAvailable(): boolean {
  return Boolean(process.env.FNB_MFA_KEY);
}

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
  if (!ivHex || !tagHex || !ctHex) throw new Error("Malformed MFA secret");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]).toString("utf8");
}
