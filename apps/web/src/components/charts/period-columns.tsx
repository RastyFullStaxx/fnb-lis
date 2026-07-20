import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { BAR_MAX, GRID, SERIES, TICK, pesoCompact, pesoFull } from "./chart-kit";
import { ColumnShape } from "./rounded-bar";

export interface PeriodColumnsDatum {
  label: string;
  value: number;
  /** Richer tooltip heading than the axis label ("Jun 1 – Jun 8"). */
  tooltipLabel?: string;
}

/**
 * Vertical columns over an ordered axis (audit periods, business days).
 * Single series in the primary blue; `diverging` colors by sign instead —
 * negative in destructive red, positive in blue, with a zero baseline. The
 * sign is carried by position (above/below the line); color is redundant
 * reinforcement, so the red/blue pair stays CVD-safe by construction.
 */
export function PeriodColumns({
  data,
  name,
  diverging = false,
  height = 224,
  formatter = pesoFull,
  tickFormatter = pesoCompact,
  className,
}: {
  data: PeriodColumnsDatum[];
  name: string;
  diverging?: boolean;
  height?: number;
  formatter?: (value: number) => string;
  tickFormatter?: (value: number) => string;
  className?: string;
}) {
  if (data.length === 0) return null;
  return (
    <ChartContainer
      config={{ value: { label: name, color: SERIES.primary } }}
      className={cn("aspect-auto w-full", className)}
      style={{ height }}
    >
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
        <CartesianGrid vertical={false} stroke={GRID.stroke} strokeWidth={GRID.strokeWidth} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={TICK}
          tickMargin={8}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ ...TICK, className: "tnum" } as never}
          tickFormatter={tickFormatter}
          width={52}
          // Zero stays in the domain so the baseline is honest even when every
          // period lands on the same side of it.
          domain={[(dataMin: number) => Math.min(0, dataMin), (dataMax: number) => Math.max(0, dataMax)]}
        />
        {diverging ? <ReferenceLine y={0} stroke="var(--color-border)" strokeWidth={1} /> : null}
        <ChartTooltip
          cursor={{ fill: "var(--color-muted)", fillOpacity: 0.5 }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const datum = payload?.[0]?.payload as PeriodColumnsDatum | undefined;
                return datum?.tooltipLabel ?? datum?.label ?? "";
              }}
              formatter={(value, itemName) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground">{itemName}</span>
                  <span className="tnum font-medium">{formatter(Number(value))}</span>
                </div>
              )}
            />
          }
        />
        <Bar dataKey="value" fill={SERIES.primary} shape={ColumnShape} maxBarSize={BAR_MAX} isAnimationActive={false}>
          {diverging
            ? data.map((d, i) => (
                <Cell key={i} fill={d.value < 0 ? SERIES.negative : SERIES.primary} />
              ))
            : null}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
