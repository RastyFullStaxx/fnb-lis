import { useState } from "react";
import { Activity as ActivityIcon, Search } from "lucide-react";
import { useActivity, type ActivityFilters } from "@/api/activity";
import { useCurrentClient } from "@/api/location";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
    <div>
      <PageHeader
        title="Activity"
        description={`Every mutation is logged the moment it happens${client ? ` — showing ${client.name}` : ""}. Committed records are immutable; corrections and voids appear here.`}
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="act-search" className="text-xs">
            Search
          </Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="act-search"
              className="w-56 pl-8"
              placeholder="Summary contains…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && apply()}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="act-from" className="text-xs">
            From
          </Label>
          <Input id="act-from" type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="act-to" className="text-xs">
            To
          </Label>
          <Input id="act-to" type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button onClick={apply} variant="secondary">
          Apply
        </Button>
        {(applied.search || applied.from || applied.to) && (
          <Button
            variant="ghost"
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
      </div>

      {activity.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : (activity.data?.rows ?? []).length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="No activity found"
          description="Nothing matches these filters yet. Widen the date range or clear the search."
        />
      ) : (
        <div className="rounded-lg border">
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
        </div>
      )}
    </div>
  );
}
