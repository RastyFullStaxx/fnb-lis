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
      // overflow-hidden: a stale ResponsiveContainer measurement must clip,
      // never widen the page (min-width feedback loops are real).
      className={cn("aspect-auto w-full min-w-0 overflow-hidden", className)}
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
          tick={<CategoryTick width={labelWidth} />}
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

/**
 * Value at the bar's data end — outside the mark when the bar is short,
 * inside it when the bar is long.
 *
 * A bar that spans most of the plot leaves no room beyond its data end, so an
 * always-outside label lands on top of the category axis and the two overprint
 * ("Tequila" over "−₱267"). The flip is self-correcting: a bar only runs out
 * of outside room by being long, and a long bar has room within itself.
 */
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
  const text = formatter(value);
  const negative = value < 0;
  // Recharts hands negative bars their RAW geometry: x = the zero line and a
  // NEGATIVE width — the data end is x + width, not x.
  const end = x + width;
  // ~6.6px per glyph at 12px tabular figures: enough to choose a side, not to
  // typeset. Erring toward "too wide" just keeps the label outside, which is
  // the safe placement.
  const needed = text.length * 6.6 + 14;
  const inside = Math.abs(width) >= needed;
  return (
    <text
      x={inside === negative ? end + 6 : end - 6}
      y={y + height / 2}
      textAnchor={inside === negative ? "start" : "end"}
      dominantBaseline="central"
      className="tnum"
      fill={inside ? "var(--color-primary-foreground)" : "var(--color-muted-foreground)"}
      fontSize={12}
    >
      {text}
    </text>
  );
}

/**
 * Category label that truncates to the axis gutter instead of overflowing it.
 * Recharts renders ticks at full length regardless of the axis `width`, so a
 * long category name runs under its own bars without this.
 */
function CategoryTick({
  x,
  y,
  payload,
  width,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
  width?: number;
}) {
  const full = String(payload?.value ?? "");
  if (x === undefined || y === undefined) return null;
  const max = Math.max(4, Math.floor(((width ?? 120) - 10) / 6.6));
  const shown = full.length > max ? `${full.slice(0, max - 1)}…` : full;
  return (
    <text
      x={x - 4}
      y={y}
      textAnchor="end"
      dominantBaseline="central"
      fill={TICK.fill}
      fontSize={TICK.fontSize}
    >
      {shown}
      {shown !== full ? <title>{full}</title> : null}
    </text>
  );
}
