import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one wrapper for a chart sitting above a report's table.
 *
 * It is deliberately a normal child of the scrolling body, never a `shrink-0`
 * sibling of it. Pinned above the scroller, a chart permanently spends 150–200px
 * of height that the table needs — on a 13" laptop that is most of the visible
 * rows, and the table is the thing people came for. Inside the scroller the
 * chart is there on arrival and scrolls away the moment you reach for rows,
 * while the sticky table header takes over the top edge.
 *
 * Charts are screen-only: exports and print carry the numbers themselves.
 */
export function ChartBlock({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  /** Right-aligned context — a total, a caveat, a unit. */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b bg-muted/20 px-4 py-3 print:hidden", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        {hint ? <p className="text-xs text-muted-foreground/80">{hint}</p> : null}
      </div>
      <div className="mt-2 min-w-0">{children}</div>
    </div>
  );
}
