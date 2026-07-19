/**
 * Custom Recharts bar shape: 4px rounded corners on the DATA END only, square
 * at the baseline (dataviz mark spec) — including negative values, where the
 * data end flips below/left of the baseline. Recharts' built-in `radius`
 * rounds a fixed pair of corners, which puts the rounding at the baseline on
 * negative bars.
 */

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  value?: number | [number, number];
  fillOpacity?: number;
}

const R = 4;

function endValue(value: BarShapeProps["value"]): number {
  return Array.isArray(value) ? (value[1] ?? 0) - (value[0] ?? 0) : (value ?? 0);
}

/** Vertical columns: positive grows up (round the top), negative down (round the bottom). */
export function ColumnShape(props: unknown) {
  let { y = 0, height = 0 } = props as BarShapeProps;
  const { x = 0, width = 0, fill, fillOpacity, value } = props as BarShapeProps;
  // Recharts hands below-baseline bars a negative height anchored at the baseline.
  if (height < 0) {
    y += height;
    height = -height;
  }
  if (width <= 0 || height <= 0) return <g />;
  const r = Math.min(R, width / 2, height);
  const negative = endValue(value) < 0;
  const d = negative
    ? // top edge = baseline (square); bottom corners rounded
      `M${x},${y} H${x + width} V${y + height - r} Q${x + width},${y + height} ${x + width - r},${y + height} H${x + r} Q${x},${y + height} ${x},${y + height - r} Z`
    : // bottom edge = baseline (square); top corners rounded
      `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`;
  return <path d={d} fill={fill} fillOpacity={fillOpacity} />;
}

/** Horizontal bars: positive grows right (round the right end), negative left. */
export function BarShape(props: unknown) {
  let { x = 0, width = 0 } = props as BarShapeProps;
  const { y = 0, height = 0, fill, fillOpacity, value } = props as BarShapeProps;
  // Recharts hands left-of-baseline bars a negative width anchored at the baseline.
  if (width < 0) {
    x += width;
    width = -width;
  }
  if (width <= 0 || height <= 0) return <g />;
  const r = Math.min(R, height / 2, width);
  const negative = endValue(value) < 0;
  const d = negative
    ? // right edge = baseline (square); left corners rounded
      `M${x + width},${y} V${y + height} H${x + r} Q${x},${y + height} ${x},${y + height - r} V${y + r} Q${x},${y} ${x + r},${y} Z`
    : // left edge = baseline (square); right corners rounded
      `M${x},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height - r} Q${x + width},${y + height} ${x + width - r},${y + height} H${x} Z`;
  return <path d={d} fill={fill} fillOpacity={fillOpacity} />;
}
