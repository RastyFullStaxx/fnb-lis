/**
 * Env-gated analytics & error reporting. With no keys set, every function is a
 * no-op — nothing loads, nothing sends. When keys ARE present the SDKs are
 * loaded lazily at runtime (kept out of the bundle via @vite-ignore) so the
 * default build stays lean.
 *
 * Privacy (per AGENTS.md): we NEVER send inventory quantities, prices,
 * variances, item names, or user PII. Events carry only a name and a small set
 * of non-sensitive dimensions (route pattern, report type, role).
 */

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "https://us.i.posthog.com";
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

type Props = Record<string, string | number | boolean>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let posthog: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sentry: any = null;

export const analyticsEnabled = Boolean(POSTHOG_KEY);
export const errorReportingEnabled = Boolean(SENTRY_DSN);

export async function initAnalytics(): Promise<void> {
  if (POSTHOG_KEY) {
    try {
      // Indirect specifier: keeps the optional SDK out of the build/type graph.
      const spec = "posthog-js";
      const mod = await import(/* @vite-ignore */ spec);
      posthog = mod.default ?? mod;
      posthog.init(POSTHOG_KEY, { api_host: POSTHOG_HOST, capture_pageview: false, autocapture: false });
    } catch {
      // SDK not installed / failed to load — stay disabled.
    }
  }
  if (SENTRY_DSN) {
    try {
      const spec = "@sentry/react";
      sentry = await import(/* @vite-ignore */ spec);
      sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 0.1 });
    } catch {
      // stay disabled
    }
  }
}

/** Track a product event. Only non-sensitive dimensions — never inventory data. */
export function track(event: string, props?: Props): void {
  posthog?.capture(event, props);
}

/** Report a caught error, if error reporting is configured. */
export function captureError(error: unknown, context?: Props): void {
  if (sentry) sentry.captureException(error, context ? { extra: context } : undefined);
}
