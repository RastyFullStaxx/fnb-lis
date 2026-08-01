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
export function clientIp(c: Context): string {
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
  if (TRUST_PROXY && c.req.header("x-forwarded-proto") === "https") return true;
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
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

/** Drop expired entries so a long-running process can't accumulate them. */
function sweep(now: number): void {
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
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

    // Reserve the slot BEFORE the handler runs when every request counts —
    // otherwise a flood of concurrent requests all pass the check together.
    if (!opts.countOnly) {
      const b = live ?? { count: 0, resetAt: now + opts.windowMs };
      b.count += 1;
      buckets.set(key, b);
      await next();
      return;
    }

    await next();

    if (opts.countOnly(c.res.status)) {
      const after = buckets.get(key);
      const b = after && after.resetAt > now ? after : { count: 0, resetAt: now + opts.windowMs };
      b.count += 1;
      buckets.set(key, b);
    }
  };
}

/** Test seam — lets verify:security reset counters between cases. */
export function resetRateLimits(): void {
  buckets.clear();
}

// ─────────────────────────────── Response headers ────────────────────────────

/**
 * `style-src` carries 'unsafe-inline' deliberately and cannot currently drop it:
 * shadcn's chart primitive renders a `<style>` block for its colour variables
 * (apps/web/src/components/ui/chart.tsx) and React writes `style=` props inline
 * throughout. Neither is an injection sink — both are developer-authored — but
 * both are inline styles, so a nonce would have to be threaded through the SPA
 * build to remove it. `script-src` has NO such escape hatch, which is the half
 * that actually stops injected JavaScript.
 */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  const handler = secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
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
