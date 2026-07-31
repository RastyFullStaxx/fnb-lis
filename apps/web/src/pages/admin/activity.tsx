import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { formatDate } from "@/lib/utils";
import { Activity as ActivityIcon } from "lucide-react";
import { useActivity, type ActivityFilters, type ActivityRow } from "@/api/activity";
import { useCurrentClient } from "@/api/location";
import { usePreferencesContext } from "@/lib/preferences";
import { PageHeader } from "@/components/page-header";
import { TableEmpty, TableFailure, TableLoading, TableSurface, ToolbarField, ToolbarSearch, queryFailed } from "@/components/table-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// The server caps a page at this many rows (apps/server/src/routes/activity.ts).
const PAGE_LIMIT = 200;

/**
 * Client req 2026-07-31: show the old and new cost on a price change row.
 * `locationItem.priceChange` is a FALLBACK tag on the server — it also
 * covers retail/parLevel/isActive-only edits where cost was never touched,
 * since `new` there is the raw request body, not a full record. Keying the
 * display off the action tag alone would show a diff on rows where the
 * price never actually changed. Only render when cost is both present and
 * actually different.
 */
function priceChangeText(row: ActivityRow): string | null {
  if (row.action !== "locationItem.priceChange" || !row.details) return null;
  try {
    const parsed = JSON.parse(row.details) as { old?: { cost?: number }; new?: { cost?: number } };
    const oldCost = parsed.old?.cost;
    const newCost = parsed.new?.cost;
    if (oldCost === undefined || newCost === undefined || oldCost === newCost) return null;
    return `cost ${oldCost.toFixed(2)} to ${newCost.toFixed(2)}`;
  } catch {
    return null;
  }
}

/**
 * Audit-log timestamps. The date half now matches the rest of the app ("Jul 20,
 * 2026") — it previously rendered raw ISO, which read as a different system to
 * the Dashboard formatting the very same records two clicks away. The clock time
 * stays, because "who did what, when" is what this screen is for.
 */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${formatDate(day)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AdminActivityPage() {
  const client = useCurrentClient();
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Phase 46.4.3: the bell links here as `activity?action=locationItem.priceChange`
  // — same deep-link-into-the-filter pattern stock/index.tsx already uses for
  // `?missingPrices=1`/`?needsWeight=1`. Landing on 200 unfiltered rows and
  // being told "3 price changes" is a search task, not a fix.
  const [params] = useSearchParams();
  const [applied, setApplied] = useState<ActivityFilters>({ action: params.get("action") ?? undefined });

  const filters: ActivityFilters = { ...applied, clientId: client?.id };
  const activity = useActivity(filters);

  /**
   * Phase 46.4.2: mark price changes "seen" by recording that this user
   * opened Activity, so the bell (46.4.3) can count `locationItem.priceChange`
   * rows since this moment. `PUT /settings/preferences` replaces the whole
   * per-user row (no partial-update path anywhere in this codebase — see
   * routes/settings.ts), so this reads the full current object out of
   * context and writes it back with only activityViewedAt changed, same
   * as every other preference edit in pages/settings.tsx.
   *
   * Fires once per mount, not on every refetch: an admin sitting on this
   * page for the auto-refresh interval shouldn't keep re-writing the same
   * preference row on a timer. Deliberately does not depend on
   * `preferences` itself — that would re-run this effect every time
   * fontSize/unitSystem changes elsewhere, which is not "opening Activity."
   */
  const { preferences, setPreferences } = usePreferencesContext();
  useEffect(() => {
    setPreferences({ ...preferences, activityViewedAt: new Date().toISOString() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = () =>
    setApplied({
      search: search.trim() || undefined,
      from: from || undefined,
      to: to || undefined,
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Activity" />

      <TableSurface
        filters={
          <>
            <ToolbarSearch label="Search" value={search} onChange={setSearch} onEnter={apply} placeholder="Summary contains…" />
            <ToolbarField label="From" htmlFor="act-from">
              <Input id="act-from" type="date" className="tnum w-40 bg-background" value={from} onChange={(e) => setFrom(e.target.value)} />
            </ToolbarField>
            <ToolbarField label="To" htmlFor="act-to">
              <Input id="act-to" type="date" className="tnum w-40 bg-background" value={to} onChange={(e) => setTo(e.target.value)} />
            </ToolbarField>
          </>
        }
        actions={
          <>
            <Button onClick={apply} variant="secondary" size="sm">
              Apply
            </Button>
            {(applied.search || applied.from || applied.to || applied.action) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setFrom("");
                  setTo("");
                  setApplied({});
                }}
              >
                Clear
              </Button>
            )}
          </>
        }
      >
        {queryFailed(activity) ? (
          <TableFailure query={activity} title="Couldn't load the activity log" />
        ) : activity.isPending ? (
          <TableLoading rows={10} />
        ) : (activity.data?.rows ?? []).length === 0 ? (
          !applied.search && !applied.from && !applied.to && !applied.action ? (
            <TableEmpty
              icon={ActivityIcon}
              title="No activity yet"
              description="Actions appear here as your team works."
            />
          ) : (
            <TableEmpty
              icon={ActivityIcon}
              title="No activity found"
              description="Nothing matches these filters yet. Widen the date range or clear the search."
            />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead className="w-44">When</TableHead>
                <TableHead className="w-36">Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activity.data!.rows.map((r) => {
                const priceChange = priceChangeText(r);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="tnum whitespace-nowrap text-xs text-muted-foreground">
                      {formatTimestamp(r.ts)}
                    </TableCell>
                    <TableCell className="text-sm">{r.userName ?? "System"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {r.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.summary}
                      {priceChange && <div className="tnum text-xs text-muted-foreground">{priceChange}</div>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {activity.data!.rows.length === PAGE_LIMIT && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-3 text-center text-xs text-muted-foreground">
                    Showing the latest {PAGE_LIMIT} entries — narrow the date range to see older activity.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </TableSurface>
    </div>
  );
}
