import { Hammer } from "lucide-react";

/** Placeholder for routes that haven't shipped yet. `phase` is internal build
 * sequencing — accepted from callers but never shown to users. */
export function ComingSoonPage({ title }: { title: string; phase?: number }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-sm text-center">
        <Hammer className="mx-auto mb-3 size-8 text-muted-foreground/50" />
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {title} isn't available yet — it's on the roadmap.
        </p>
      </div>
    </div>
  );
}
