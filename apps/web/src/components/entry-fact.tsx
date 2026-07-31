import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

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

export interface EntryAction {
  label: string;
  onClick: () => void;
  /** Voids, removes, cancels — anything that takes work off the record. */
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * The action cluster on a "Recent …" row. Callers pass DATA, not buttons.
 *
 * That is the point of the component. This cluster was hand-rolled in five
 * screens (Counts, Sales, Purchases ×2, Transfers) and each one ordered it
 * differently — Sales had Cancel then Edit, Transfers had Correct then Void,
 * the Purchases editor had Void then Edit. The same row, in the same product,
 * teaching three different muscle memories: whichever screen someone learned
 * first made them wrong on the other two. Taking markup as a prop would have
 * left that free to drift again, so the ordering lives here and callers cannot
 * express a different one.
 *
 * The rule that survived: **safe actions first, destructive last, everywhere.**
 * Consistent order costs nothing visually and is the part that was actually
 * broken.
 *
 * Sizing stays `xs` and the gap stays tight. An earlier pass enlarged these to
 * `sm` with 12px of separation, reasoning from Fitts's Law that distance guards
 * a destructive button. On screen that was wrong: these rows are dense fact
 * lists, and two chunky buttons held apart stopped reading as one row's
 * controls and started competing with the entry itself. Every action here is
 * already behind a confirm dialog, so the row does not need to carry the
 * safeguard as well — a mis-tap costs a dismissed dialog, not a lost line.
 * Density is the right trade at this size.
 */
export function EntryActions({ actions }: { actions: EntryAction[] }) {
  const live = actions.filter(Boolean);
  if (live.length === 0) return null;
  const safe = live.filter((a) => !a.destructive);
  const risky = live.filter((a) => a.destructive);

  const render = (a: EntryAction) => (
    <Button
      key={a.label}
      size="xs"
      variant={a.destructive ? "destructive" : "outline"}
      disabled={a.disabled}
      onClick={a.onClick}
    >
      {a.label}
    </Button>
  );

  return (
    <div className="mt-auto flex items-center gap-1">
      {safe.map(render)}
      {risky.map(render)}
    </div>
  );
}
