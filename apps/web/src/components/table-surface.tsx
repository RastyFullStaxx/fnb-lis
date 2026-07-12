import type { ComponentType, ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
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
    <div className={cn("overflow-hidden rounded-lg border", className)}>
      {hasToolbar && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2.5 print:hidden">
          {filters && <div className="flex flex-1 flex-wrap items-center gap-2">{filters}</div>}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {bodyClassName ? <div className={bodyClassName}>{children}</div> : children}
    </div>
  );
}

/** The one search box used in every table toolbar — identical affordance across pages. */
export function ToolbarSearch({
  value,
  onChange,
  placeholder = "Search…",
  className,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  onEnter?: () => void;
}) {
  return (
    <div className={cn("relative w-64", className)}>
      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label={placeholder}
        placeholder={placeholder}
        className="bg-background pl-8"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onEnter ? (e) => e.key === "Enter" && onEnter() : undefined}
      />
    </div>
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
