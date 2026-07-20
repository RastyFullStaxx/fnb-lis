import { Bar, BarChart, Cell, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { BAR_MAX, SERIES, TICK, pesoCompact, pesoFull } from "./chart-kit";
import { BarShape } from "./rounded-bar";

export interface MagnitudeBarsDatum {
  label: string;
  value: number;
}

const ROW_HEIGHT = 34;

/**
 * Horizontal bars for magnitude by category (one hue) or signed variance by
 * category (`diverging`: shortage red left, surplus blue right of a zero
 * line). Every bar carries its value at the data end, so the chart runs
 * without gridlines or a value axis — direct labels before gridlines.
 */
export function MagnitudeBars({
  data,
  name,
  diverging = false,
  formatter = pesoFull,
  endLabelFormatter = pesoCompact,
  className,
}: {
  data: MagnitudeBarsDatum[];
  name: string;
  diverging?: boolean;
  formatter?: (value: number) => string;
  endLabelFormatter?: (value: number) => string;
  className?: string;
}) {
  if (data.length === 0) return null;
  const height = data.length * ROW_HEIGHT + 12;
  const labelWidth = Math.min(168, Math.max(...data.map((d) => d.label.length)) * 7.2 + 16);
  return (
    <ChartContainer
      config={{ value: { label: name, color: SERIES.primary } }}
      className={cn("aspect-auto w-full", className)}
      style={{ height }}
    >
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 56, bottom: 0, left: diverging ? 56 : 0 }}
      >
        {/* The zero baseline must always be in the domain — with all-negative
            data, dataMax would become the baseline and bars grow from the
            wrong edge (the smallest bar vanishes entirely). */}
        <XAxis
          type="number"
          hide
          domain={[(dataMin: number) => Math.min(0, dataMin), (dataMax: number) => Math.max(0, dataMax)]}
        />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={TICK}
          width={labelWidth}
          interval={0}
        />
        {diverging ? <ReferenceLine x={0} stroke="var(--color-border)" strokeWidth={1} /> : null}
        <ChartTooltip
          cursor={{ fill: "var(--color-muted)", fillOpacity: 0.5 }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) =>
                (payload?.[0]?.payload as MagnitudeBarsDatum | undefined)?.label ?? ""
              }
              formatter={(value, itemName) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground">{itemName}</span>
                  <span className="tnum font-medium">{formatter(Number(value))}</span>
                </div>
              )}
            />
          }
        />
        <Bar dataKey="value" fill={SERIES.primary} shape={BarShape} maxBarSize={BAR_MAX} isAnimationActive={false}>
          {diverging
            ? data.map((d, i) => (
                <Cell key={i} fill={d.value < 0 ? SERIES.negative : SERIES.primary} />
              ))
            : null}
          <LabelList dataKey="value" content={<EndLabel formatter={endLabelFormatter} />} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** Value at the bar's data end — outside the mark, on the side it grows toward. */
function EndLabel({
  x,
  y,
  width,
  height,
  value,
  formatter,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  value?: number;
  formatter: (value: number) => string;
}) {
  if (x === undefined || y === undefined || width === undefined || height === undefined || value === undefined) {
    return null;
  }
  const negative = value < 0;
  return (
    <text
      x={negative ? x - 6 : x + width + 6}
      y={y + height / 2}
      textAnchor={negative ? "end" : "start"}
      dominantBaseline="central"
      className="tnum"
      fill="var(--color-muted-foreground)"
      fontSize={12}
    >
      {formatter(value)}
    </text>
  );
}
