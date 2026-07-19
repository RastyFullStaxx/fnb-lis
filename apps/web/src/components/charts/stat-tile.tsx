import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * KPI stat tile (dataviz figure contract): label · value · optional signed
 * delta vs a named period · optional 12-point sparkline. The value uses the
 * font's proportional figures — tabular-nums at display sizes reads loose —
 * and the sparkline runs in the de-emphasis hue with the current period
 * marked in the accent.
 */

export interface StatTileDelta {
  /** Preformatted, signed: "+₱12.4K", "−3.2%". */
  text: string;
  /** Direction of the change, independent of whether it's good. */
  direction: "up" | "down" | "flat";
  /** Whether this movement is good news — colors the delta. */
  good: boolean | null;
  /** What it's measured against: "vs prior period". */
  vs?: string;
}

export function StatTile({
  label,
  value,
  detail,
  delta,
  spark,
  valueClassName,
}: {
  label: string;
  value: string;
  detail?: string;
  delta?: StatTileDelta;
  /** Up to ~12 points, oldest → newest. Needs ≥ 2 points to draw. */
  spark?: number[];
  valueClassName?: string;
}) {
  const DeltaIcon = delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : Minus;
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <p className={cn("truncate text-xl font-semibold tracking-tight", valueClassName)} title={value}>
          {value}
        </p>
        {spark && spark.length >= 2 ? <Sparkline points={spark} /> : null}
      </div>
      {delta ? (
        <p className="mt-0.5 flex items-center gap-1 text-xs">
          <span
            className={cn(
              "flex items-center gap-0.5 font-medium",
              delta.good === null ? "text-muted-foreground" : delta.good ? "text-success" : "text-destructive",
            )}
          >
            <DeltaIcon className="size-3" aria-hidden="true" />
            {delta.text}
          </span>
          {delta.vs ? <span className="text-muted-foreground">{delta.vs}</span> : null}
        </p>
      ) : detail ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );
}

/** Hand-rolled 12-point sparkline: 2px de-emphasis line, accent end-dot. */
function Sparkline({ points }: { points: number[] }) {
  const W = 64;
  const H = 24;
  const PAD = 3; // keeps the end-dot ring inside the viewBox
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = (W - PAD * 2) / (points.length - 1);
  const x = (i: number) => PAD + i * step;
  const y = (v: number) => PAD + (H - PAD * 2) * (1 - (v - min) / span);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = points.length - 1;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className="shrink-0"
      aria-hidden="true"
      role="presentation"
    >
      <path d={path} fill="none" stroke="var(--color-chart-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Surface ring keeps the dot legible where it crosses the line. */}
      <circle cx={x(last)} cy={y(points[last]!)} r="4" fill="var(--color-background)" />
      <circle cx={x(last)} cy={y(points[last]!)} r="2.5" fill="var(--color-primary)" />
    </svg>
  );
}
