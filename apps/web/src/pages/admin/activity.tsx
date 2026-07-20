import { useState } from "react";
import { Activity as ActivityIcon } from "lucide-react";
import { useActivity, type ActivityFilters } from "@/api/activity";
import { useCurrentClient } from "@/api/location";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, ToolbarField, ToolbarSearch } from "@/components/table-surface";
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

/** Audit-log timestamps match the project's YYYY-MM-DD business-date convention. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AdminActivityPage() {
  const client = useCurrentClient();
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState<ActivityFilters>({});

  const filters: ActivityFilters = { ...applied, clientId: client?.id };
  const activity = useActivity(filters);

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
            {(applied.search || applied.from || applied.to) && (
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
        {activity.isPending ? (
          <TableLoading rows={10} />
        ) : (activity.data?.rows ?? []).length === 0 ? (
          !applied.search && !applied.from && !applied.to ? (
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
              {activity.data!.rows.map((r) => (
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
                  <TableCell className="text-sm">{r.summary}</TableCell>
                </TableRow>
              ))}
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
