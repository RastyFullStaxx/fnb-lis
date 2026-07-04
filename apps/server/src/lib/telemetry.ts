/**
 * Env-gated server error reporting. No SENTRY_DSN → no-op, nothing loads.
 * The SDK is imported lazily so the default runtime carries no dependency.
 * We only send the error itself — never request bodies, which may contain
 * inventory figures or credentials.
 */
const SENTRY_DSN = process.env.SENTRY_DSN;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sentry: any = null;
let initialized = false;

async function ensureInit(): Promise<void> {
  if (initialized || !SENTRY_DSN) return;
  initialized = true;
  try {
    const spec = "@sentry/node";
    sentry = await import(spec);
    sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 0.1 });
  } catch {
    sentry = null; // SDK not installed — stay disabled
  }
}

export const errorReportingEnabled = Boolean(SENTRY_DSN);

/** Fire-and-forget capture of an unexpected server error. */
export function reportError(error: unknown): void {
  if (!SENTRY_DSN) return;
  void ensureInit().then(() => sentry?.captureException(error));
}
