import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A filter chip with a clear on/off state, sized to sit level with the Inputs
 * and Selects beside it (h-9). Active is the brand primary — a filled tint,
 * primary border and a leading check — so "this filter is on" reads at a glance
 * instead of the old flat amount of amber that looked like a warning, not a
 * toggle. Inactive matches the neutral control chrome.
 */
export function Toggle({
  pressed,
  onPressedChange,
  children,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors",
        pressed
          ? "border-primary bg-primary/10 text-primary hover:bg-primary/15"
          : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Check className={cn("size-3.5 transition-all", pressed ? "opacity-100" : "-ml-1 w-0 opacity-0")} />
      {children}
    </button>
  );
}
