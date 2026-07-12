import { useState } from "react";
import { Activity as ActivityIcon, Search } from "lucide-react";
import { useActivity, type ActivityFilters } from "@/api/activity";
import { useCurrentClient } from "@/api/location";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty } from "@/components/table-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search activity"
                className="w-56 bg-background pl-8"
                placeholder="Summary contains…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && apply()}
              />
            </div>
            <Label htmlFor="act-from" className="text-xs text-muted-foreground">
              From
            </Label>
            <Input id="act-from" type="date" className="w-40 bg-background" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Label htmlFor="act-to" className="text-xs text-muted-foreground">
              To
            </Label>
            <Input id="act-to" type="date" className="w-40 bg-background" value={to} onChange={(e) => setTo(e.target.value)} />
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
          <TableEmpty
            icon={ActivityIcon}
            title="No activity found"
            description="Nothing matches these filters yet. Widen the date range or clear the search."
          />
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
                    {new Date(r.ts).toLocaleString()}
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
            </TableBody>
          </Table>
        )}
      </TableSurface>
    </div>
  );
}
