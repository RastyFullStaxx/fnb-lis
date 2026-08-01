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
// N=16384 (16 MB, ~100 ms) is OWASP's stated floor for scrypt at r=8,p=1. It is
// deliberately not higher: /api/auth/login runs this BEFORE it knows who is
// calling, so the work factor is also an unauthenticated CPU cost. The per-IP
// login limiter (app.ts) is what makes room to raise it — do that together, not
// separately.
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P });
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
  await scrypt(password, randomBytes(16), KEY_LENGTH, { N, r: R, p: P });
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, keyHex] = parts;
  const salt = Buffer.from(saltHex!, "hex");
  const expected = Buffer.from(keyHex!, "hex");
  const key = await scrypt(password, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
