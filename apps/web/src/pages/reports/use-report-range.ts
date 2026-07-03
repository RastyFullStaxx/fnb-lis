import { useState } from "react";

/**
 * Seeds a from/to date range from the location's committed count dates
 * (first → last), falling back to a trailing 30-day window. Once the user
 * edits either field, their choice sticks.
 */
export function useReportRange(countDates?: string[]): [string, string, (v: string) => void, (v: string) => void] {
  const [override, setOverride] = useState<{ from?: string; to?: string }>({});

  const seededFrom = countDates?.[0];
  const seededTo = countDates?.at(-1);
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const from = override.from ?? seededFrom ?? monthAgo;
  const to = override.to ?? seededTo ?? today;

  return [
    from,
    to,
    (v: string) => setOverride((o) => ({ ...o, from: v })),
    (v: string) => setOverride((o) => ({ ...o, to: v })),
  ];
}
