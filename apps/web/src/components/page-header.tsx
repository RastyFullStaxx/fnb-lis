import type { ReactNode } from "react";

/**
 * The single page header used on every route: a title on the left, optional
 * primary actions on the right — no subtitle. Every page opens at the same
 * vertical position so navigating between them only swaps content, never shifts
 * the layout. See DESIGN.md "Page skeleton & uniformity".
 */
export function PageHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
