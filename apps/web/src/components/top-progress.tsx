import { useEffect, useRef, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";

/**
 * Slim royal-blue progress bar pinned to the top of the viewport. It rides React
 * Query's global fetching count, so any in-flight page or data load shows it and
 * it clears the moment the data lands — the "frictionless speed" cue on every
 * navigation. Indeterminate slide while running; when the last fetch settles it
 * sweeps to full width and fades — every load ends with a visible completion
 * moment instead of an abrupt cut. Decorative only (in-place skeletons carry
 * the accessible loading state), so it stays out of the accessibility tree.
 */
export function TopProgress() {
  const active = useIsFetching() > 0;
  const [stage, setStage] = useState<"idle" | "running" | "finish">("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (active) {
      setStage("running");
    } else if (stage === "running") {
      setStage("finish");
      timer.current = window.setTimeout(() => setStage("idle"), 450);
    }
    return () => window.clearTimeout(timer.current);
  }, [active, stage]);

  if (stage === "idle") return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden print:hidden"
      aria-hidden="true"
    >
      {stage === "running" ? (
        <div className="animate-progress-slide h-full w-2/5 rounded-full bg-primary" />
      ) : (
        <div className="animate-progress-finish h-full w-full bg-primary" />
      )}
    </div>
  );
}
