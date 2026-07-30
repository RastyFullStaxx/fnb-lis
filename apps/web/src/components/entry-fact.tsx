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
 * Two rules, both about the destructive button:
 *
 * - **Safe actions first, destructive last.** One order everywhere.
 * - **A real gap before it.** Fitts's Law is usually about making targets
 *   easier to hit; for a button that cancels someone's count line it runs the
 *   other way, and distance is the safeguard. The old cluster left 4px between
 *   Edit and Remove.
 *
 * Size is `sm` (32px) rather than `xs` (24px) — a third more target for a
 * control people reach for one-handed, mid-count, often on a touchscreen. Still
 * short of the 44px ideal, which would visibly inflate every row in a list
 * whose whole job is density; the gap does the safety work that the extra
 * height would have.
 */
export function EntryActions({ actions }: { actions: EntryAction[] }) {
  const live = actions.filter(Boolean);
  if (live.length === 0) return null;
  const safe = live.filter((a) => !a.destructive);
  const risky = live.filter((a) => a.destructive);

  const render = (a: EntryAction) => (
    <Button
      key={a.label}
      size="sm"
      variant={a.destructive ? "destructive" : "outline"}
      disabled={a.disabled}
      onClick={a.onClick}
    >
      {a.label}
    </Button>
  );

  return (
    <div className="mt-auto flex items-center gap-1.5">
      {safe.map(render)}
      {safe.length > 0 && risky.length > 0 && (
        // The separation, stated once. `ml-1.5` on top of the flex gap puts
        // 12px between the safe cluster and the destructive one — enough that a
        // thumb aiming at Edit does not land on Cancel.
        <span aria-hidden="true" className="ml-1.5" />
      )}
      {risky.map(render)}
    </div>
  );
}
