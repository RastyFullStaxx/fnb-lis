/**
 * Legacy-parity rounding. The legacy system's numbers come from PHP, whose
 * round() is "half away from zero" — JS Math.round(-2.5) gives -2, PHP gives -3.
 * Negative variances are routine in audit reports, so this difference is
 * load-bearing. ALL rounding in domain code goes through phpRound.
 */
export function phpRound(value: number, precision = 0): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** precision;
  // Strip double-precision noise (e.g. 1.005 * 100 === 100.49999...) the way
  // PHP's pre-rounding correction does, then round half away from zero.
  const scaled = Number((value * factor).toPrecision(15));
  const rounded = scaled >= 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5);
  return rounded / factor;
}

export function round2(value: number): number {
  return phpRound(value, 2);
}
