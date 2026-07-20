/**
 * Shared chart vocabulary — one set of specs so every chart in the app reads
 * as the same instrument (DESIGN.md: blue main series, gray comparisons,
 * destructive red reserved for negative variance).
 *
 * Mark specs (dataviz): bars ≤ 24px with a 4px rounded data-end and a square
 * baseline; 2px lines; hairline SOLID gridlines one step off the surface;
 * axis text in muted ink, never the series color.
 */

export const SERIES = {
  /** Main series — royal blue. */
  primary: "var(--color-primary)",
  /** Comparison / de-emphasis series. */
  muted: "var(--color-chart-3)",
  /** Negative variance only — never decoration. */
  negative: "var(--color-destructive)",
} as const;

export const BAR_MAX = 24; // px — marks stay thin; the band's leftover is air
export const BAR_RADIUS_END = 4; // rounded data-end, square at the baseline

export const GRID = {
  stroke: "var(--color-border)",
  strokeWidth: 1,
} as const;

export const TICK = {
  fill: "var(--color-muted-foreground)",
  fontSize: 12,
} as const;

const PESO = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Full currency for tooltips and tables: ₱1,650.00 */
export function pesoFull(value: number): string {
  return PESO.format(value);
}

/** Compact currency for axis ticks and tiles: ₱12.5K / ₱1.2M / −₱950 */
export function pesoCompact(value: number): string {
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  // Tier by the ROUNDED value: 999,999 must read ₱1M, never ₱1000K.
  if (abs >= 999_950) return `${sign}₱${trimZero((abs / 1_000_000).toFixed(1))}M`;
  if (abs >= 10_000) return `${sign}₱${trimZero((abs / 1_000).toFixed(1))}K`;
  return `${sign}₱${abs.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function trimZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

const PERIOD_LABEL = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" });

/** "Jun 8" from a YYYY-MM-DD business date. */
export function shortDate(date: string): string {
  return PERIOD_LABEL.format(new Date(`${date}T00:00:00`));
}
