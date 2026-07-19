/**
 * Subscription billing-state derivation (compute-on-load; no background job).
 *
 * Single source of truth shared by the server (routes/admin.ts) and the web
 * client (api/admin.ts) — the two used to carry hand-mirrored copies of this
 * logic, which is exactly how the double-credit bug shipped in both at once.
 *
 * Pure module: `now` is always injected by the caller — core never reads the
 * wall clock itself, and `startDate` (a business date, TEXT YYYY-MM-DD) is
 * parsed numerically, never via `new Date(string)`.
 *
 * Period model
 * ------------
 * A MONTHLY subscription anchored on startDate's day-of-month has a due date
 * every month: the anchor day pinned into that month, rolling over to the 1st
 * of the following month when the month is shorter (started the 31st, now in
 * February → due Mar 1). Due dates delimit half-open billing periods:
 *
 *     [due N, due N+1)
 *
 * A payment (`lastPaidAt`) counts for exactly the period its timestamp falls
 * in — never the one after. This is the fix for the double-credit bug: the
 * old window spanned [previous due, next due end-of-day] (~2 months), so one
 * payment on/after a due date showed the following month as paid too.
 */

export type AccessState = "ACTIVE" | "GRACE" | "VIEW_ONLY";

/** Days past a due date before an unpaid MONTHLY sub drops to view-only. */
export const BILLING_GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BillingPeriod {
  /** Due date that opens the current period (inclusive). */
  start: Date;
  /** Next due date (exclusive). */
  end: Date;
}

/** Parses a YYYY-MM-DD business date to a UTC-midnight Date, numerically. */
function parseBusinessDate(date: string): Date {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * The due date the anchor day produces for a given (year, month) slot: the
 * anchor day pinned into that month, or the 1st of the following month when
 * the month is shorter. `month0` may be out of [0,11] — Date.UTC normalizes.
 */
function pinnedDue(anchorDay: number, year: number, month0: number): Date {
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  if (anchorDay <= daysInMonth) return new Date(Date.UTC(year, month0, anchorDay));
  return new Date(Date.UTC(year, month0 + 1, 1));
}

/**
 * The billing period containing `now`: [latest due ≤ now, next due).
 * Before the subscription starts, returns the first period
 * [startDate, first due after startDate).
 */
export function currentPeriod(startDate: string, now: Date): BillingPeriod {
  const anchor = parseBusinessDate(startDate);
  const anchorDay = anchor.getUTCDate();

  // Candidate due dates from the months surrounding `now` (rollover can push
  // a slot's due into the following month, so scan a generous window), plus
  // the subscription's own start, which acts as due #0.
  const times = new Set<number>([anchor.getTime()]);
  for (let off = -2; off <= 2; off++) {
    const due = pinnedDue(anchorDay, now.getUTCFullYear(), now.getUTCMonth() + off);
    if (due.getTime() >= anchor.getTime()) times.add(due.getTime());
  }
  const dues = [...times].sort((a, b) => a - b);

  // The anchor itself is always in the set and is its minimum, so `start`
  // begins defined even when every pinned due is in the future.
  let start = anchor.getTime();
  for (const t of dues) {
    if (t <= now.getTime()) start = t;
    else break;
  }
  const end = dues.find((t) => t > start);
  // `end` always exists for any real `now` (the scan covers now's month +2);
  // fall back to one pinned slot ahead of the start just in case.
  const startOfPeriod = new Date(start);
  return {
    start: startOfPeriod,
    end:
      end !== undefined
        ? new Date(end)
        : pinnedDue(anchorDay, startOfPeriod.getUTCFullYear(), startOfPeriod.getUTCMonth() + 1),
  };
}

export interface BillingSubscriptionInput {
  billingCycle: string;
  paid: boolean;
  /** Server rows carry a Date; web rows carry the serialized ISO string. */
  lastPaidAt: Date | string | null;
  /** Business date, TEXT YYYY-MM-DD. */
  startDate: string;
}

/**
 * Derived effective access state. Callers check `status` first —
 * CANCELLED / SUSPENDED / TRIAL override this.
 *
 * "GRACE"     = unpaid, but within BILLING_GRACE_DAYS of the current due date
 * "VIEW_ONLY" = unpaid and past the grace window
 *
 * Non-MONTHLY (STANDALONE) subs: pay once — ACTIVE if paid, GRACE otherwise.
 */
export function deriveAccessState(sub: BillingSubscriptionInput, now: Date): AccessState {
  if (sub.billingCycle !== "MONTHLY") {
    return sub.paid ? "ACTIVE" : "GRACE";
  }

  const period = currentPeriod(sub.startDate, now);
  const lastPaid =
    sub.lastPaidAt === null ? null : typeof sub.lastPaidAt === "string" ? new Date(sub.lastPaidAt) : sub.lastPaidAt;

  // A payment counts for the period its timestamp falls in. The first period
  // additionally accepts earlier timestamps (paid at signup, days before the
  // start date) — there is no prior period they could belong to.
  const isFirstPeriod = period.start.getTime() === parseBusinessDate(sub.startDate).getTime();
  const paidInPeriod =
    sub.paid &&
    lastPaid !== null &&
    lastPaid.getTime() < period.end.getTime() &&
    (lastPaid.getTime() >= period.start.getTime() || isFirstPeriod);

  if (paidInPeriod) return "ACTIVE";

  // Unpaid: the payment for this period was due at period.start.
  const daysOverdue = (now.getTime() - period.start.getTime()) / DAY_MS;
  if (daysOverdue <= BILLING_GRACE_DAYS) return "GRACE";
  return "VIEW_ONLY";
}

/**
 * Signed whole days between `now` and the due date governing the current
 * period: positive = the subscription hasn't started yet (due upcoming),
 * negative/zero = days since the current period's due date passed.
 * Display helper for unpaid MONTHLY subs ("Due in 3d" / "Overdue 5d").
 */
export function daysUntilDue(startDate: string, now: Date): number {
  const period = currentPeriod(startDate, now);
  if (now.getTime() < period.start.getTime()) {
    return Math.ceil((period.start.getTime() - now.getTime()) / DAY_MS);
  }
  // Deliberate Math.floor, not phpRound — this is a whole-days display count,
  // not money math.
  return -Math.floor((now.getTime() - period.start.getTime()) / DAY_MS);
}
