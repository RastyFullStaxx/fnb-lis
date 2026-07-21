import type { ReactNode } from "react";

/**
 * One labelled fact in a "Recent …" panel row: "Quantity: 3". Every two-pane
 * quick-entry screen (Sales, Purchases returns, …) renders its recent list
 * with these so the subtexts read the same everywhere.
 *
 * Label and value flow as ONE inline run, so a value too wide for the column
 * wraps back to the left margin — under the label's first letter — instead of
 * hanging indented under the value. The indent wasted the left half of every
 * continuation line ("(back to / ⎵⎵⎵⎵⎵⎵stock)"); wrapping to the margin uses
 * the full width and costs fewer lines.
 */
export function EntryFact({ label, value }: { label: string; value: string | number }) {
  return (
    <p className="text-xs leading-snug">
      <span className="text-muted-foreground">{label}:</span>{" "}
      <span className="tnum text-foreground/80">{value}</span>
    </p>
  );
}

/** Wrapper for a row's fact list — the muted stacked block under a name. */
export function EntryFacts({ children }: { children: ReactNode }) {
  return <div className="mt-0.5 space-y-0.5">{children}</div>;
}
