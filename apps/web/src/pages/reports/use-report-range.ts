import { useState } from "react";
import { useSearchParams } from "react-router";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Seeds a from/to date range — URL search params first (so deep links like
 * Stocky's citations land on the cited range), then the location's committed
 * count dates (first → last), then a trailing 30-day window. Once the user
 * edits either field, their choice sticks.
 */
export function useReportRange(countDates?: string[]): [string, string, (v: string) => void, (v: string) => void] {
  const [params] = useSearchParams();
  const [override, setOverride] = useState<{ from?: string; to?: string }>({});

  const paramFrom = params.get("from");
  const paramTo = params.get("to");
  const urlFrom = paramFrom && DATE_RE.test(paramFrom) ? paramFrom : undefined;
  const urlTo = paramTo && DATE_RE.test(paramTo) ? paramTo : undefined;

  const seededFrom = countDates?.[0];
  const seededTo = countDates?.at(-1);
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const from = override.from ?? urlFrom ?? seededFrom ?? monthAgo;
  const to = override.to ?? urlTo ?? seededTo ?? today;

  return [
    from,
    to,
    (v: string) => setOverride((o) => ({ ...o, from: v })),
    (v: string) => setOverride((o) => ({ ...o, to: v })),
  ];
}
