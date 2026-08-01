import { createHash } from "node:crypto";

/**
 * Refuse passwords that already appear in a public breach corpus.
 *
 * Why this and not "complexity rules". NIST SP 800-63B explicitly recommends
 * checking candidate passwords against known-breached lists and explicitly
 * recommends AGAINST composition rules ("must contain a symbol"), because those
 * push people toward `Password1!` — which is itself in every breach corpus.
 * Length plus a breach check beats character classes, and annoys nobody.
 *
 * It matters more here than in most systems: this app has NO self-service
 * password change. Every password is typed by an ADMIN on behalf of someone
 * else (routes/admin.ts), so one person's habits set the floor for the whole
 * establishment. "Password123" reused across ten staff accounts is the
 * realistic failure, and it is exactly what this catches.
 *
 * ── The password never leaves this process ──
 * k-anonymity (the HIBP range API): SHA-1 the candidate, send the FIRST FIVE
 * hex characters only, and receive every suffix sharing that prefix — several
 * hundred of them. The comparison happens locally. The service learns a
 * 5-character prefix shared by tens of thousands of passwords and nothing else.
 * SHA-1 is not a security choice here; it is the API's index, and the hash is
 * never transmitted whole.
 */

const RANGE_API = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 3000;

/** Off by explicit opt-out, so an air-gapped deploy can disable it outright. */
export function isBreachCheckEnabled(): boolean {
  return process.env.FNB_BREACH_CHECK !== "0";
}

/**
 * How many times this password appears in known breaches. 0 = not found.
 *
 * FAILS OPEN, deliberately. If the range API is unreachable, slow, or returns
 * something unexpected, this returns 0 and the password is allowed. The
 * alternative — refusing to create or reset any account while a third-party
 * service is down — turns an advisory check into an outage, and would block the
 * administrator during exactly the incident where they most need to rotate a
 * password. This is a quality gate, not an authentication control.
 */
export async function breachCount(password: string): Promise<number> {
  if (!isBreachCheckEnabled()) return 0;

  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const res = await fetch(`${RANGE_API}${prefix}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Asks the API to pad the response with decoy hashes, so the SIZE of
        // the reply leaks nothing about how many real matches the prefix had.
        "Add-Padding": "true",
        "User-Agent": "fnb-lis",
      },
    });
    if (!res.ok) return 0;
    const body = await res.text();

    for (const line of body.split("\n")) {
      const [hashSuffix, count] = line.trim().split(":");
      if (hashSuffix !== suffix) continue;
      const n = Number(count);
      // Padding entries are returned with a count of 0 — a real match never is.
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  } catch {
    return 0; // unreachable, timed out, or malformed — see the fail-open note
  }
}

/**
 * The message an administrator sees. Deliberately says nothing about which
 * password was checked, and gives a usable instruction rather than a scolding.
 */
export function breachMessage(count: number): string {
  return (
    `That password has appeared in ${count.toLocaleString()} known data breaches, ` +
    `so it is among the first an attacker will try. Choose a different one — ` +
    `length matters more than symbols.`
  );
}
