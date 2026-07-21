import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A filter chip that reads on/off purely by COLOR, like the Top Sellers
 * segmented buttons: solid brand primary when on, neutral outline when off —
 * the same footprint in both states. An earlier version animated a check icon
 * in on press, which widened the chip and tipped the toolbar onto a second row
 * the moment a filter was switched on. Colour-only means the strip never
 * reflows. Sized h-9 to sit level with the Selects and date Inputs beside it.
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
        "inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium whitespace-nowrap transition-colors",
        pressed
          ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
          : "border-input bg-background text-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
