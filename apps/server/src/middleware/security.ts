import type { Context, MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { getConnInfo } from "@hono/node-server/conninfo";
import { AppError } from "../lib/errors";

/**
 * Transport, identity-of-caller, and abuse controls — the three things that
 * were missing at the edge. Kept in one file because all three answer the same
 * question ("what do we believe about this request before we trust it?") and
 * each is easy to half-apply.
 *
 * See docs/security.md for the threat model these implement.
 */

// ───────────────────────────── Trusted proxy ─────────────────────────────────

/**
 * Whether `x-forwarded-for` / `x-forwarded-proto` may be believed.
 *
 * OFF by default, and that default is the whole point. Those headers are just
 * request headers: anything on the network can send them. The activity trail
 * records an IP against every login, void and correction, and an admin
 * investigating "who ran this count?" has to be able to trust it. Reading a
 * forgeable header into an audit record makes the trail attacker-controlled —
 * worse than having no IP at all, because it reads as evidence.
 *
 * Set FNB_TRUST_PROXY=1 only when the app genuinely sits behind a reverse proxy
 * you control (nginx/Caddy/Cloudflare) that OVERWRITES these headers rather than
 * appending to them.
 */
const TRUST_PROXY = process.env.FNB_TRUST_PROXY === "1";

/**
 * The caller's IP, from the socket unless a trusted proxy is declared.
 *
 * With a trusted proxy, the LAST entry of x-forwarded-for is the one the proxy
 * itself appended — the client-supplied prefix of that list is exactly the part
 * an attacker controls, which is why the first entry (the conventional choice)
 * is the wrong one to take here.
 */
/**
 * One-time warning for the misconfiguration that turns rate limiting into a
 * self-inflicted outage: a reverse proxy in front, but FNB_TRUST_PROXY unset.
 *
 * Every request then carries the PROXY's socket address, so the whole
 * installation shares a single bucket and ten failed sign-ins from any one
 * anonymous caller locks everybody out of /api/auth/login for fifteen minutes.
 * The symptom ("nobody can log in") looks nothing like the cause, so it is
 * worth saying out loud the first time the evidence appears.
 */
let warnedAboutProxy = false;

export function clientIp(c: Context): string {
  if (!TRUST_PROXY && !warnedAboutProxy && c.req.header("x-forwarded-for")) {
    warnedAboutProxy = true;
    console.warn(
      "[security] X-Forwarded-For is present but FNB_TRUST_PROXY is not set. " +
        "If this app is behind a reverse proxy, every client shares one rate-limit bucket " +
        "and one attacker can lock out the whole installation. See docs/security-runbook.md §1.",
    );
  }
  if (TRUST_PROXY) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) {
      const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
      const nearest = hops[hops.length - 1];
      if (nearest) return nearest;
    }
  }
  // getConnInfo reads the Node socket off c.env, which does not exist when the
  // app is driven in-process (verify:* harnesses, and the desktop's embedded
  // server). Falling back beats throwing: an unidentifiable caller should be
  // rate-limited under one shared bucket, not handed an exception.
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Did this request actually arrive over TLS?
 *
 * Used to decide the session cookie's `Secure` flag per-request rather than
 * from a build-time constant. The previous `NODE_ENV === "production"` test had
 * two failure modes in opposite directions: a hosted deploy that forgot to
 * export NODE_ENV shipped session cookies WITHOUT Secure (readable by anyone who
 * can see one plaintext request), while the Electron desktop — which talks to a
 * local server over plain HTTP by design — would have had its cookie rejected
 * outright if the constant were simply flipped on. Asking the request settles
 * both cases with no configuration.
 */
export function isSecureRequest(c: Context): boolean {
  try {
    if (new URL(c.req.url).protocol === "https:") return true;
  } catch {
    /* fall through */
  }

  /**
   * `x-forwarded-proto` is believed here WITHOUT requiring FNB_TRUST_PROXY, and
   * that asymmetry against clientIp() is deliberate — the two headers have
   * opposite failure modes.
   *
   * A forged X-Forwarded-For writes a false IP into the audit trail, which is
   * evidence, so it must be earned. A forged X-Forwarded-Proto can only make us
   * add `Secure` to a cookie. Getting that WRONG in the permissive direction
   * costs an attacker's own session over plain HTTP (the browser declines to
   * store it — a self-inflicted nuisance). Getting it wrong in the strict
   * direction costs the real user their session token in clear text.
   *
   * The strict version was a live bug: the deployment the runbook recommends
   * terminates TLS at Caddy and proxies to Node over plain HTTP, so
   * `c.req.url` is `http://…` and the cookie shipped WITHOUT Secure unless
   * FNB_TRUST_PROXY happened to be set as well. That is precisely the H-1
   * failure — one signal saying production, another not — reintroduced by its
   * own fix.
   */
  if (c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() === "https") return true;

  /** Last-resort override for a topology neither test recognises. */
  return process.env.FNB_FORCE_SECURE_COOKIES === "1";
}

// ─────────────────────────────── Rate limiting ───────────────────────────────

/**
 * Fixed-window counters in process memory.
 *
 * In-memory is not a shortcut here, it is the correct scope: this server owns a
 * single SQLite file and runs as a single process (see db.ts — WAL plus one
 * writer). A shared Redis counter would add an external dependency and a new
 * failure mode to coordinate state that only ever has one owner. If the app is
 * ever fronted by more than one instance, this must move — docs/security.md §9
 * records that as the upgrade path.
 *
 * ponytail: fixed window, not sliding. A determined caller can land 2× the limit
 * across a window boundary. That is irrelevant against the threats this exists
 * for (credential stuffing, scrypt CPU amplification, scripted scraping) and a
 * sliding log costs memory proportional to traffic. Swap it if a real abuse
 * pattern ever needs the precision.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/**
 * Hard ceiling on distinct keys.
 *
 * With FNB_TRUST_PROXY=1 the bucket key comes from a header, so any request
 * that reaches the app WITHOUT traversing the proxy (a misconfigured firewall,
 * a container on the same network) can mint unlimited distinct keys and grow
 * this map without bound. The sweep only removes entries that have already
 * expired, which is no help against a caller creating new ones faster.
 */
const MAX_BUCKETS = 20_000;

/** Drop expired entries so a long-running process can't accumulate them. */
function sweep(now: number): void {
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
  // Still oversized after dropping the dead ones: evict oldest-inserted first.
  // A Map iterates in insertion order, so this sheds the least recently created
  // keys. Evicting a live counter is a real (small) loss of enforcement, which
  // is why the ceiling is far above any plausible legitimate client count —
  // reaching it at all means something abnormal is happening.
  if (buckets.size <= MAX_BUCKETS) return;
  const excess = buckets.size - MAX_BUCKETS;
  let dropped = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    if (++dropped >= excess) break;
  }
  console.warn(`[security] rate-limit table exceeded ${MAX_BUCKETS} keys; evicted ${dropped}`);
}
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

export type RateLimitOptions = {
  /** Namespace, so two limiters never share a counter for the same IP. */
  id: string;
  limit: number;
  windowMs: number;
  /** Human wording for the 429 body. */
  message: string;
  /**
   * Count only the requests that failed in an interesting way. The login
   * limiter passes `(status) => status === 401 || status === 423`, so a busy bar
   * behind one NAT address never trips it by signing in successfully — only an
   * attacker guessing passwords does.
   */
  countOnly?: (status: number) => boolean;
};

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const now = Date.now();
    if (now - lastSweep > SWEEP_INTERVAL_MS) {
      lastSweep = now;
      sweep(now);
    }

    const key = `${opts.id}:${clientIp(c)}`;
    const bucket = buckets.get(key);
    const live = bucket && bucket.resetAt > now ? bucket : undefined;

    if (live && live.count >= opts.limit) {
      const retryAfter = Math.max(1, Math.ceil((live.resetAt - now) / 1000));
      c.header("Retry-After", String(retryAfter));
      throw new AppError(429, opts.message, "RATE_LIMITED");
    }

    /**
     * ALWAYS reserve the slot before the handler runs, then refund it if the
     * outcome turned out not to count.
     *
     * Incrementing after `next()` resolved was a complete bypass: concurrent
     * requests all read count=0 before any of them finished, so the ceiling
     * only ever applied to a caller polite enough to wait for each response.
     * Measured before this change: 60 concurrent bad sign-ins against a limit
     * of 10 produced 60 × 401 and 0 × 429 — every one of them burning a full
     * scrypt derivation. That silently invalidated the brute-force bound for
     * passwords, PINs and 6-digit TOTP codes alike.
     *
     * Reserve-then-refund keeps the "only failures count" property that lets a
     * whole bar sign in from one NAT address, while making the limit hold under
     * concurrency: at most `limit` requests can ever be in flight, and a
     * successful one gives its slot straight back.
     */
    const b = live ?? { count: 0, resetAt: now + opts.windowMs };
    b.count += 1;
    buckets.set(key, b);

    if (!opts.countOnly) {
      await next();
      return;
    }

    try {
      await next();
    } catch (err) {
      // An AppError thrown by the handler (401/423 from the login route) is the
      // countable case — keep the reservation and let it propagate.
      const status = (err as { status?: number })?.status;
      if (typeof status === "number" && !opts.countOnly(status)) refund(key, b);
      throw err;
    }

    if (!opts.countOnly(c.res.status)) refund(key, b);
  };
}

/**
 * Give back a reserved slot. Guarded on identity and on the count still being
 * positive, so a refund can never resurrect a window that has already rolled
 * over or push a counter below zero.
 */
function refund(key: string, reserved: Bucket): void {
  const current = buckets.get(key);
  if (current === reserved && current.count > 0) current.count -= 1;
}

/** Test seam — lets verify:security reset counters between cases. */
export function resetRateLimits(): void {
  buckets.clear();
}

// ─────────────────────────────── Response headers ────────────────────────────

/**
 * Inline `<style>` ELEMENTS are now refused; inline `style=` ATTRIBUTES are not.
 *
 * CSP3 splits these: `style-src-elem` governs `<style>` and stylesheet links,
 * `style-src-attr` governs the `style="…"` attribute. React writes hundreds of
 * the latter and cannot stop, but the app produced exactly ONE of the former —
 * shadcn's chart primitive, which built a `<style>` block for its colour
 * variables. Rewriting it to emit those same variables as an inline style
 * object (apps/web/src/components/ui/chart.tsx) removed the last one, which is
 * what makes `style-src-elem 'self'` possible.
 *
 * That is a real tightening rather than a cosmetic one: an attacker who managed
 * to inject markup can no longer bring a `<style>` block with it, which closes
 * the CSS-exfiltration trick where attribute selectors leak field contents by
 * requesting a different background image per character.
 *
 * `style-src` is kept as the fallback for browsers that do not implement the
 * -elem/-attr split; they get the old, laxer behaviour rather than a broken app.
 * `script-src` has never had an escape hatch, and that remains the half that
 * actually stops injected JavaScript.
 */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  const handler = secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // Fallback for browsers without the CSP3 -elem/-attr split.
      styleSrc: ["'self'", "'unsafe-inline'"],
      // The app emits no inline <style> elements any more — see the note above.
      styleSrcElem: ["'self'"],
      // React's style= props. Unavoidable, and a far smaller surface than
      // arbitrary <style> blocks.
      styleSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:"],
      // The SPA only ever talks to its own origin (apps/web/src/api/http.ts uses
      // relative paths with same-origin credentials). Anything else is exfil.
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    // Only over TLS. Sending HSTS from the plain-HTTP desktop server would pin
    // localhost to https in the operator's browser and lock them out of it.
    strictTransportSecurity: isSecureRequest(c)
      ? "max-age=31536000; includeSubDomains"
      : false,
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "same-origin",
    crossOriginOpenerPolicy: "same-origin",
    // Reports and exports are same-origin downloads; nothing embeds this app.
    crossOriginResourcePolicy: "same-origin",
    xDnsPrefetchControl: "off",
    xPermittedCrossDomainPolicies: "none",
  });
  return handler(c, next);
};
