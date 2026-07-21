/**
 * One labelled fact in a "Recent …" panel row: "Quantity: 3". Every two-pane
 * quick-entry screen (Sales, Purchases returns, …) renders its recent list
 * with these so the subtexts read the same everywhere — a stacked label:value
 * list rather than a run-on dot-separated string.
 *
 * Values wrap at word boundaries and never mid-token: `break-words` let
 * "−₱728.00" shatter one character per line once the column got narrow, which
 * is worse than either truncating or wrapping. Amounts stay whole; a long value
 * simply continues on the next line.
 */
export function EntryFact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0">{label}:</dt>
      <dd className="tnum min-w-0 text-foreground/80">{value}</dd>
    </div>
  );
}

/** Wrapper for a row's fact list — the muted stacked-label block under a name. */
export function EntryFacts({ children }: { children: React.ReactNode }) {
  return <dl className="mt-0.5 space-y-px text-xs text-muted-foreground">{children}</dl>;
}
