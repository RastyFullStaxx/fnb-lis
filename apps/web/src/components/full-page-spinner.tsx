import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** In-page fallback for detail loaders (purchase, transfer, import, count). */
export function FullPageSpinner({ error }: { error?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      {error ? (
        <div className="max-w-md text-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      ) : (
        <div className="h-6 w-6 animate-pulse rounded-full bg-primary/30" aria-label="Loading" />
      )}
    </div>
  );
}

/**
 * Boot state: paint the app frame instantly — deep-royal rail, topbar
 * hairline, content skeletons shaped like the dashboard — so the shell reads
 * as "already open" while /me resolves. Never a centered spinner (DESIGN.md).
 */
export function BootSkeleton() {
  return (
    <div className="flex min-h-dvh bg-background" aria-label="Loading" aria-busy="true">
      <div className="hidden w-64 shrink-0 bg-sidebar md:block" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <Skeleton className="size-7" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="space-y-6 p-4 sm:p-6">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-24 w-full rounded-none" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    </div>
  );
}

/** Boot failed: say what happened and what to do next, with a way to retry. */
export function BootError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <p className="text-sm leading-6 text-foreground">{message}</p>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}
