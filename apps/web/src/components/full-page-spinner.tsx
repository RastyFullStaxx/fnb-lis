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
