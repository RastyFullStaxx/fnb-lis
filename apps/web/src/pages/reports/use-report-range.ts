import { useState } from "react";
import { useSearchParams } from "react-router";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Seeds a from/to date range — URL search params first (so deep links like
 * Stocky's citations land on the cited range), then the CURRENT OPEN PERIOD
 * (last committed count date through today) so the newest entries are always
 * on screen — a "to" pinned at the last count would hide everything recorded
 * since. Falls back to a trailing 30-day window before the first count.
 * Once the user edits either field, their choice sticks.
 */
export function useReportRange(countDates?: string[]): [string, string, (v: string) => void, (v: string) => void] {
  const [params] = useSearchParams();
  const [override, setOverride] = useState<{ from?: string; to?: string }>({});

  const paramFrom = params.get("from");
  const paramTo = params.get("to");
  const urlFrom = paramFrom && DATE_RE.test(paramFrom) ? paramFrom : undefined;
  const urlTo = paramTo && DATE_RE.test(paramTo) ? paramTo : undefined;

  // Local calendar dates — toISOString() is UTC and rolls back a day before
  // 8:00 AM in Manila, silently excluding today's entries. en-CA = YYYY-MM-DD.
  const today = new Date().toLocaleDateString("en-CA");
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString("en-CA");

  const lastCount = countDates?.at(-1);
  const seededFrom = lastCount;
  // A count committed "today" (or ahead of the clock) still needs to >= from.
  const seededTo = lastCount && lastCount > today ? lastCount : today;

  const from = override.from ?? urlFrom ?? seededFrom ?? monthAgo;
  const to = override.to ?? urlTo ?? seededTo ?? today;

  return [
    from,
    to,
    (v: string) => setOverride((o) => ({ ...o, from: v })),
    (v: string) => setOverride((o) => ({ ...o, to: v })),
  ];
}
