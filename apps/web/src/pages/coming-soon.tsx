import { Hammer } from "lucide-react";

/** Placeholder for routes whose build phase hasn't landed yet. */
export function ComingSoonPage({ title, phase }: { title: string; phase: number }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-sm text-center">
        <Hammer className="mx-auto mb-3 size-8 text-muted-foreground/50" />
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This module arrives in build phase {phase}. The navigation is already wired so the app's
          shape is real from day one.
        </p>
      </div>
    </div>
  );
}
