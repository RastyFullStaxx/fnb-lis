import { useState } from "react";
import { formatDate } from "@/lib/utils";
import { Link, useNavigate } from "react-router";
import { ClipboardList, Plus } from "lucide-react";
import { toast } from "sonner";
import { statusVariant } from "@/lib/status";
import { can, type Role } from "@fnb/core";
import { useLocationId } from "@/api/location";
import { useMe } from "@/api/auth";
import { useCountMutations, useCountSessions } from "@/api/ops";
import { useDeviceNames } from "@/api/sync";
import { ApiError } from "@/api/http";
import { PageHeader } from "@/components/page-header";
import { ReleaseDraftButton } from "@/components/release-draft-button";
import { TableEmpty, TableFailure, TableLoading, TableSurface, ToolbarField, ToolbarSearch, queryFailed } from "@/components/table-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";


export function CountsPage() {
  const sessions = useCountSessions();
  const deviceName = useDeviceNames();
  const me = useMe();
  // Same permission the server enforces on the release route.
  const canRelease = can((me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role, "devices.manage");
  const locationId = useLocationId();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");

  const q = search.trim().toLowerCase();
  const filtered = (sessions.data ?? []).filter((s) => {
    const matchesStatus = status === "ALL" || s.status === status;
    const matchesSearch =
      !q || s.countDate.includes(q) || (s.createdByName ?? "").toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  })
    // Unfinished work first. A count you can still act on was landing below
    // seven committed ones purely because it was older — the dashboard sends
    // you here and then makes you hunt for the row it just named.
    .sort((a, b) => Number(b.status === "OPEN") - Number(a.status === "OPEN"));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Counts"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Start a Count
          </Button>
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarSearch
              label="Search"
              value={search}
              onChange={setSearch}
              placeholder="Search date or encoder…"
            />
            <ToolbarField label="Status" htmlFor="counts-status">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="counts-status" className="w-40 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="OPEN">Counting</SelectItem>
                  <SelectItem value="COMMITTED">Committed</SelectItem>
                  <SelectItem value="VOID">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </ToolbarField>
          </>
        }
      >
        {queryFailed(sessions) ? (
          <TableFailure query={sessions} title="Couldn't load counts" />
        ) : sessions.isPending ? (
          <TableLoading />
        ) : filtered.length === 0 ? (
          <TableEmpty
            icon={ClipboardList}
            title={
              (sessions.data ?? []).length === 0 ? "No counts yet" : "Nothing matches the current filter"
            }
            description={
              (sessions.data ?? []).length === 0
                ? "Start your first count — it becomes the beginning inventory of your first audit period."
                : "Clear the search or status filter to see everything."
            }
            action={
              (sessions.data ?? []).length === 0 ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" /> Start a Count
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setStatus("ALL");
                  }}
                >
                  Clear Filters
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Count Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead>Encoded By</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.id} className={s.status === "VOID" ? "opacity-50" : undefined}>
                  <TableCell className="tnum font-medium">{formatDate(s.countDate)}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(s.status)}>
                      {s.status === "OPEN" ? "Counting" : s.status === "COMMITTED" ? "Committed" : "Cancelled"}
                    </Badge>
                    {/* An open count started on a bar PC can't be edited here —
                        say so on the row, rather than letting someone open it
                        and meet a 409 after typing. */}
                    {s.status === "OPEN" && s.originDeviceId && (
                      <Badge variant="outline" className="ml-2 font-normal">
                        On {deviceName(s.originDeviceId)}
                      </Badge>
                    )}
                    {s.voidReason && (
                      <span className="ml-2 text-xs text-muted-foreground">{s.voidReason}</span>
                    )}
                  </TableCell>
                  <TableCell className="tnum text-right">{s._count?.lines ?? 0}</TableCell>
                  <TableCell className="text-muted-foreground">{s.createdByName}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {s.status === "OPEN" && s.originDeviceId && canRelease && (
                        <ReleaseDraftButton entity="CountSession" id={s.id} machine={deviceName(s.originDeviceId)} />
                      )}
                      <Button asChild variant="ghost" size="sm">
                        <Link to={`/l/${locationId}/counts/${s.id}`}>
                          {s.status === "OPEN" && !s.originDeviceId ? "Continue" : "View"}
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableSurface>

      <NewCountDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        openSessions={(sessions.data ?? []).filter((s) => s.status === "OPEN")}
      />
    </div>
  );
}

function NewCountDialog({
  open,
  onOpenChange,
  openSessions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Counts already in progress here — see the note in the dialog body. */
  openSessions: Array<{ id: string; countDate: string }>;
}) {
  const navigate = useNavigate();
  const locationId = useLocationId();
  const { createSession } = useCountMutations();
  const [countDate, setCountDate] = useState(() => new Date().toISOString().slice(0, 10));

  const start = async () => {
    try {
      const session = await createSession.mutateAsync({ countDate });
      navigate(`/l/${locationId}/counts/${session.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not start the count");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Start a Count</DialogTitle>
          <DialogDescription>
            The count date anchors reports: activity from this date onward belongs to the new period.
          </DialogDescription>
        </DialogHeader>
        {openSessions.length > 0 && (
          // Starting a second count while one is unfinished is allowed — two
          // dates can legitimately be mid-count — but doing it BY ACCIDENT is
          // the common case, and nothing here used to mention it. Neither count
          // reaches a report until it is committed, so the cost of the mistake
          // is a half-finished count nobody notices.
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
            <p>
              {openSessions.length === 1
                ? `A count for ${formatDate(openSessions[0]!.countDate)} is still unfinished.`
                : `${openSessions.length} counts are still unfinished.`}{" "}
              Continue that one instead of starting another, unless this really is a different day.
            </p>
            {openSessions.length === 1 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => navigate(`/l/${locationId}/counts/${openSessions[0]!.id}`)}
              >
                Continue {formatDate(openSessions[0]!.countDate)}
              </Button>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="count-date">Count Date</Label>
          <Input
            id="count-date"
            type="date"
            className="tnum"
            value={countDate}
            onChange={(e) => setCountDate(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button onClick={start} disabled={!countDate || createSession.isPending}>
            {createSession.isPending ? "Starting…" : "Start Counting"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
