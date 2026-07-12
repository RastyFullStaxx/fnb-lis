import { useEffect, useRef, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";

/**
 * Slim royal-blue progress bar pinned to the top of the viewport. It rides React
 * Query's global fetching count, so any in-flight page or data load shows it and
 * it clears the moment the data lands — the "frictionless speed" cue on every
 * navigation. Indeterminate slide, no fake percentages. See DESIGN.md "Loading".
 */
export function TopProgress() {
  const active = useIsFetching() > 0;
  // Stay mounted briefly after idle so the fade-out can play to completion.
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (active) {
      window.clearTimeout(timer.current);
      setVisible(true);
    } else if (visible) {
      timer.current = window.setTimeout(() => setVisible(false), 250);
    }
    return () => window.clearTimeout(timer.current);
  }, [active, visible]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden print:hidden"
      role="progressbar"
      aria-hidden="true"
    >
      {active ? (
        <div className="animate-progress-slide h-full w-2/5 rounded-full bg-primary" />
      ) : (
        <div className="h-full w-full bg-primary opacity-0 transition-opacity duration-200" />
      )}
    </div>
  );
}
