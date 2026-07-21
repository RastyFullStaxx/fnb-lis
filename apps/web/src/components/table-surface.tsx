import type { ComponentType, ReactNode } from "react";
import { RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The one data surface used on every list and report page: a bordered, rounded
 * card whose toolbar — filters / search / tabs on the left, contextual actions
 * (apply, clear, export) on the right — is fused to the top of the table instead
 * of floating above it. The surface stays in the same on-screen position on every
 * page; only its contents change. See DESIGN.md "Page skeleton & uniformity".
 */
export function TableSurface({
  filters,
  actions,
  children,
  className,
  bodyClassName,
}: {
  filters?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Padding/layout for the body — pass e.g. "p-4" for a form/workspace body so it isn't flush like a table. */
  bodyClassName?: string;
}) {
  const hasToolbar = Boolean(filters || actions);
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border", className)}>
      {hasToolbar && (
        // items-end, not items-center: every control is the same height, so
        // aligning bottoms puts the BOXES on one line whether or not a given
        // control carries a stacked label above it.
        <div className="flex shrink-0 flex-wrap items-end gap-x-3 gap-y-2 border-b bg-muted/30 px-3 py-2.5 print:hidden">
          {filters && <div className="flex min-w-0 flex-1 flex-wrap items-end gap-x-3 gap-y-2">{filters}</div>}
          {actions && <div className="ml-auto flex shrink-0 items-end gap-2">{actions}</div>}
        </div>
      )}
      {/* The body is the only thing that scrolls: the table header sticks so column
          labels stay while rows scroll, and the page chrome above never moves. */}
      <div
        className={cn(
          "scrollbar-thin min-h-0 flex-1 overflow-auto",
          // The inner shadcn table wrapper is its own scroll container, which would
          // trap the sticky header — flatten it so this body is the only scroller.
          "[&_[data-slot=table-container]]:overflow-visible",
          // Opaque header background is part of the sticky guarantee — without
          // it, rows bleed through the pinned labels while scrolling.
          "[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-muted",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * One labelled slot in a toolbar: caption above, control beneath.
 *
 * Labels used to sit INLINE before their control, which made the strip so long
 * it wrapped to two or three rows and ate the height the table needs. Stacking
 * the caption over its control roughly halves the row's width, and the parent's
 * `items-end` keeps every box on one line regardless.
 */
export function ToolbarField({
  label,
  htmlFor,
  grow = false,
  className,
  children,
}: {
  /** The stacked caption. Pass for every slot — even tabs and toggle groups —
      so the whole strip reads on one baseline; only truly self-evident lone
      controls omit it. */
  label?: string;
  /** The id of a single labelable control beneath (a Select/Input trigger).
      Omit for groups (tabs, several buttons): the caption then renders as a
      plain span, since a <label for> pointing at nothing is invalid. */
  htmlFor?: string;
  /** Take the row's leftover width — the search field, normally. */
  grow?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const captionClass = "text-[11px] leading-none font-medium text-muted-foreground";
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", grow && "flex-1", className)}>
      {label &&
        (htmlFor ? (
          <Label htmlFor={htmlFor} className={captionClass}>
            {label}
          </Label>
        ) : (
          <span className={captionClass}>{label}</span>
        ))}
      {children}
    </div>
  );
}

/**
 * The one search box used in every table toolbar — identical affordance across
 * pages. It grows into whatever the row's fixed controls leave behind rather
 * than sitting at a fixed width with dead space beside it.
 */
export function ToolbarSearch({
  value,
  onChange,
  placeholder = "Search…",
  label,
  className,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Stacked caption, matching ToolbarField. Omit to run captionless. */
  label?: string;
  className?: string;
  onEnter?: () => void;
}) {
  const id = `search-${placeholder.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    // 9rem floor, measured not guessed: Full Audit's five fixed controls plus
    // gaps leave ~184px of a 909px strip, and an 11rem (198px at this app's
    // 18px root) minimum tipped the search onto a second row — the exact
    // wrapping the stacked captions existed to remove. Below the floor it
    // wraps deliberately rather than shrinking to a useless sliver.
    <ToolbarField label={label} htmlFor={id} grow className={cn("min-w-[9rem]", className)}>
      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          aria-label={placeholder}
          placeholder={placeholder}
          className="bg-background pl-8"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onEnter ? (e) => e.key === "Enter" && onEnter() : undefined}
        />
      </div>
    </ToolbarField>
  );
}

/** Loading fill for inside a TableSurface — keeps the toolbar in place while rows load. */
export function TableLoading({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3">
          <Skeleton className="h-5 w-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * Error fill for inside a TableSurface — a load failure must never render as
 * an empty state ("No sales in this range" when the service is down misleads
 * on an audit-grade tool). Says what happened and offers the way forward.
 */
export function TableError({
  title = "Couldn't load this report",
  description = "Check your connection and try again.",
  onRetry,
  retrying = false,
}: {
  title?: string;
  description?: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      <Button size="sm" variant="outline" className="mt-2" onClick={onRetry} disabled={retrying}>
        <RefreshCw className={cn("size-4", retrying && "animate-spin")} />
        {retrying ? "Retrying…" : "Try again"}
      </Button>
    </div>
  );
}

/** Empty fill for inside a TableSurface — no second border, so the surface reads as one card. */
export function TableEmpty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {Icon && <Icon className="size-8 text-muted-foreground/50" />}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
