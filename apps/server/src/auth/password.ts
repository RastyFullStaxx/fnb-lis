import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))),
  );

// scrypt (no native deps — reliable on Windows). Format:
// scrypt:N:r:p:<salt hex>:<key hex>
//
// The parameters are STORED IN THE HASH and read back by verifyPassword, so
// raising N below re-hardens every password set from that moment on while every
// existing hash keeps verifying. Raising the cost is a one-line change with no
// migration; see docs/security.md §2.
//
// N=32768 (32 MB, ~200 ms) — double OWASP's stated floor for scrypt at r=8,p=1.
//
// Raised from 16384 once the per-IP login limiter (app.ts) existed, and not
// before: /api/auth/login runs this BEFORE it knows who is calling, so the work
// factor doubles as an unauthenticated CPU cost. Raising it without a limiter
// in front would have made the endpoint a better amplifier, not a safer one.
//
// Existing hashes keep verifying at whatever N they were written with, so this
// needed no migration — every password set or reset from here is stronger, and
// the old ones are re-hashed the next time their owner changes them.
const N = 32768;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

/**
 * Node's scrypt defaults `maxmem` to 32 MB and requires the working set to be
 * strictly UNDER it. scrypt needs 128·N·r bytes, which at N=32768, r=8 is
 * exactly 33,554,432 — exactly 32 MB — so raising N to the recommended value
 * fails with "memory limit exceeded" unless maxmem moves too. It is a genuinely
 * nasty trap: the parameters look correct, and every hash and verify throws.
 *
 * Computed from the parameters rather than hard-coded, and doubled, so this
 * cannot silently become the ceiling again the next time N is raised.
 *
 * It must be passed on VERIFY as well as hash — a stored hash carries its own
 * N, and reading back an N=32768 hash needs the same headroom that writing it
 * did.
 */
const MAXMEM = 128 * N * R * 2;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt:${N}:${R}:${P}:${salt.toString("hex")}:${key.toString("hex")}`;
}

/**
 * Spend a verification's worth of CPU and discard it.
 *
 * For the no-such-user branch of login. Without it the endpoint answers a miss
 * in milliseconds and a hit in ~100 ms, which enumerates usernames regardless of
 * how carefully the error message is worded. The salt is real but throwaway —
 * only the elapsed time is the point.
 */
export async function burnPasswordTime(password: string): Promise<void> {
  await scrypt(password, randomBytes(16), KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
}

/**
 * Was this hash written with weaker parameters than we use now?
 *
 * Raising N is only half an upgrade. The other half is that EXISTING hashes
 * keep verifying at their old, cheaper cost — so without re-hashing, the
 * accounts that have been around longest stay the weakest, forever.
 *
 * It also closes a timing oracle that raising N would otherwise OPEN. The
 * no-such-user branch burns a derivation at the CURRENT N (~80 ms), while a
 * real account holding a legacy hash verifies at the old one (~38 ms) — which
 * inverts the enumeration signal that burnPasswordTime exists to remove. Once
 * every hash has been upgraded on its owner's next sign-in, both paths cost the
 * same again and the oracle closes for good.
 */
export function needsRehash(stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return Number(parts[1]) < N || Number(parts[2]) < R;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, keyHex] = parts;

  /**
   * A malformed stored hash must FAIL, not pass.
   *
   * `Buffer.from(x, "hex")` is silently lenient: an empty or non-hex segment
   * yields a ZERO-LENGTH buffer. That flowed straight into
   * `scrypt(..., expected.length, ...)` — a zero-length derivation — and then
   * `key.length === expected.length && timingSafeEqual(empty, empty)` was
   * `0 === 0 && true`. So a row whose key segment was truncated or corrupted
   * accepted ANY password. Verified: `scrypt:32768:8:1:<salt>:` returned true
   * for "literally-anything".
   *
   * That matters most for exactly the adversary this system is built against.
   * An insider with database access could blank one `passwordHash` segment and
   * then sign in as that user with any string — leaving a row that still looks
   * like a scrypt hash rather than an obvious password reset.
   *
   * Every field is therefore validated before use: even-length non-empty hex of
   * the expected size, and parameters that are real positive numbers.
   */
  const isHex = (s: string | undefined, bytes: number): boolean =>
    typeof s === "string" && s.length === bytes * 2 && /^[0-9a-fA-F]+$/.test(s);
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || n < 2 || !Number.isInteger(r) || r < 1 || !Number.isInteger(p) || p < 1) {
    return false;
  }
  if (!isHex(saltHex, 16) || !isHex(keyHex, KEY_LENGTH)) return false;

  const salt = Buffer.from(saltHex!, "hex");
  const expected = Buffer.from(keyHex!, "hex");
  if (expected.length !== KEY_LENGTH) return false;
  // Headroom derived from the STORED parameters, not the current constants:
  // this must verify hashes written before N was raised, and hashes that will
  // be written after it is raised again.
  const key = await scrypt(password, salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: Math.max(MAXMEM, 128 * n * r * 2),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
