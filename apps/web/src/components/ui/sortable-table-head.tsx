import type { ComponentProps } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { TableHead } from "@/components/ui/table";
import type { SortDirection } from "@/hooks/use-sort";

/**
 * A <TableHead> that renders a clickable label + chevron sort indicator,
 * matching the Amkor DataTable's sort UX:
 *   - unsorted            → ChevronsUpDown (muted)
 *   - active, ascending   → ChevronUp (primary color)
 *   - active, descending  → ChevronDown (primary color)
 * Clicking cycles none → asc → desc → none (handled by useSort's toggleSort).
 *
 * Usage:
 *   <SortableTableHead sortKey="name" activeKey={sortKey} direction={sortDirection} onSort={toggleSort}>
 *     Name
 *   </SortableTableHead>
 *
 * Pass `sortable={false}` (or omit sortKey) for columns that shouldn't sort,
 * e.g. an actions column — it renders as a plain TableHead in that case.
 */
export function SortableTableHead({
  sortKey,
  activeKey,
  direction,
  onSort,
  sortable = true,
  className,
  children,
  ...props
}: {
  /** The key this column sorts by; passed back to onSort/toggleSort. */
  sortKey?: string;
  /** The currently active sort key from useSort. */
  activeKey?: string | null;
  /** The currently active sort direction from useSort. */
  direction?: SortDirection;
  /** toggleSort from useSort. */
  onSort?: (key: string) => void;
  /** Set false to render a non-sortable header (e.g. an actions column). */
  sortable?: boolean;
} & Omit<ComponentProps<typeof TableHead>, "onClick" | "children">) {
  const isSortable = sortable && !!sortKey && !!onSort;
  const isActive = isSortable && activeKey === sortKey;

  if (!isSortable) {
    return (
      <TableHead className={className} {...props}>
        {children}
      </TableHead>
    );
  }

  return (
    <TableHead
      aria-sort={isActive ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn("select-none", className)}
      {...props}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${typeof children === "string" ? children : "column"}${
          isActive ? `, currently ${direction === "asc" ? "ascending" : "descending"}` : ""
        }`}
        className={cn(
          "inline-flex w-full items-center gap-1 bg-transparent p-0 font-inherit text-inherit",
          "cursor-pointer",
          isActive ? "text-primary" : "text-foreground",
        )}
      >
        {children}
        {isActive ? (
          direction === "asc" ? (
            <ChevronUp className="size-3 shrink-0" strokeWidth={2.75} />
          ) : (
            <ChevronDown className="size-3 shrink-0" strokeWidth={2.75} />
          )
        ) : (
          <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground" strokeWidth={2.75} />
        )}
      </button>
    </TableHead>
  );
}
