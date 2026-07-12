import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ClipboardList, Plus } from "lucide-react";
import { toast } from "sonner";
import { useLocationId } from "@/api/location";
import { useCountMutations, useCountSessions } from "@/api/ops";
import { ApiError } from "@/api/http";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, ToolbarSearch } from "@/components/table-surface";
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

const STATUS_BADGE: Record<string, "secondary" | "default" | "outline"> = {
  OPEN: "default",
  COMMITTED: "secondary",
  VOID: "outline",
};

export function CountsPage() {
  const sessions = useCountSessions();
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
  });

  return (
    <div>
      <PageHeader
        title="Counts"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Start a count
          </Button>
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarSearch value={search} onChange={setSearch} placeholder="Search date or encoder…" />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="OPEN">Counting</SelectItem>
                <SelectItem value="COMMITTED">Committed</SelectItem>
                <SelectItem value="VOID">Void</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      >
        {sessions.isPending ? (
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
              (sessions.data ?? []).length === 0 && (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" /> Start a count
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Count date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead>Encoded by</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.id} className={s.status === "VOID" ? "opacity-50" : undefined}>
                  <TableCell className="tnum font-medium">{s.countDate}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[s.status] ?? "outline"}>
                      {s.status === "OPEN" ? "Counting" : s.status === "COMMITTED" ? "Committed" : "Void"}
                    </Badge>
                    {s.voidReason && (
                      <span className="ml-2 text-xs text-muted-foreground">{s.voidReason}</span>
                    )}
                  </TableCell>
                  <TableCell className="tnum text-right">{s._count?.lines ?? 0}</TableCell>
                  <TableCell className="text-muted-foreground">{s.createdByName}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/l/${locationId}/counts/${s.id}`}>
                        {s.status === "OPEN" ? "Continue" : "View"}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableSurface>

      <NewCountDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function NewCountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
          <DialogTitle>Start a count</DialogTitle>
          <DialogDescription>
            The count date anchors reports: activity from this date onward belongs to the new period.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="count-date">Count date</Label>
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
            {createSession.isPending ? "Starting…" : "Start counting"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
