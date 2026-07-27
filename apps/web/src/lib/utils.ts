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
 */
export function formatDate(date: string): string {
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
