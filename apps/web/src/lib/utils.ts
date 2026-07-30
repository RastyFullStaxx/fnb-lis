import { round2 } from "@fnb/core";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const PESO = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

/**
 * Snap float dust to a clean zero before formatting.
 *
 * Reconciliation sums produce values like -5.5e-13, which `hasVariance()`
 * already treats as zero — but Intl kept the sign and printed "-₱0.00" in the
 * Full Audit. A minus sign on a zero reads as a rounding error in the one
 * report the client trusts most. Anything under half a centavo can only render
 * as 0.00 anyway, so this changes the sign and nothing else.
 */
export function formatMoney(value: number): string {
  return PESO.format(Math.abs(value) < 0.005 ? 0 : value);
}

const DATE = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const PESO_UNIT = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  // Legacy stores unit prices as decimal(11,3) and the client's own screenshot
  // shows "1.000" — an item sold by the gram costs a fraction of a peso, so two
  // decimals rounds a real price to ₱0.00 and it reads as unpriced.
  maximumFractionDigits: 3,
});

/**
 * A UNIT price — cost or retail for one gram/ml/piece — which legitimately
 * carries centavo fractions.
 *
 * Deliberately NOT the same formatter as money totals: widening `formatMoney`
 * would put three decimals on every figure in the Full Audit, and that report's
 * presentation must not move. Storage was never the problem — `cost`/`retail`
 * are doubles and 2.705 round-trips exactly; only the display was truncating.
 */
export function formatUnitPrice(value: number): string {
  return PESO_UNIT.format(Math.abs(value) < 0.0005 ? 0 : value);
}

/**
 * A business date (`YYYY-MM-DD` TEXT) as people read it: "Jul 20, 2026".
 *
 * The app was showing three formats at once — this one on the dashboard, raw
 * ISO in the Counts/Transfers tables, and raw ISO again in report headers. Same
 * date looking like two different things is exactly the sort of thing that
 * makes an auditor stop and re-check.
 *
 * Parsed at local midnight, never `new Date("2026-07-20")` — that is UTC and
 * lands on the 19th anywhere west of Greenwich.
 *
 * Accepts null/undefined and renders an em dash: several of these dates are
 * genuinely absent (a location with no count yet), and forcing every caller to
 * write `?? ""` is how raw ISO strings leaked back onto the screen last time.
 */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  return DATE.format(new Date(`${date}T00:00:00`));
}

/**
 * Two-decimal number for report cells — the same dust rule as formatMoney.
 * Was copy-pasted as a local `n2` into eleven report pages; one copy means the
 * fix lands everywhere instead of wherever someone remembers to apply it.
 */
export function formatNumber(value: number): string {
  return (Math.abs(value) < 0.005 ? 0 : round2(value)).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}
