import { useState } from "react";
import { Laptop, Link2Off } from "lucide-react";
import { toast } from "sonner";
import {
  useAdminClients,
  useAdminDevices,
  useRevokeDevice,
  useUpdateDevice,
  type AdminDevice,
} from "@/api/admin";
import { ApiError } from "@/api/http";
import { PageHeader } from "@/components/page-header";
import { TableEmpty, TableFailure, TableLoading, TableSurface, queryFailed } from "@/components/table-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * Registered offline desktops.
 *
 * This page is the counterweight that makes a year-long device session
 * acceptable (docs/sync-and-data-lifecycle.md §5). Without somewhere to see and
 * revoke a machine, that token would be an un-revocable credential sitting on a
 * computer in a bar.
 *
 * Registration deliberately does NOT happen here — a machine registers itself
 * on first login, because nobody can read a fingerprint off a computer before
 * installing the software that computes it.
 */

/** "6 hours ago" — how long a machine has been holding work the server hasn't seen. */
function sinceLabel(iso: string | null): string {
  if (!iso) return "Never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** No push within a shift. A report built right now may be missing its work. */
const STALE_MS = 6 * 60 * 60 * 1000;
function isStale(d: AdminDevice): boolean {
  return d.status === "ACTIVE" && (!d.lastSyncAt || Date.now() - new Date(d.lastSyncAt).getTime() > STALE_MS);
}

export function AdminDevicesPage() {
  const devices = useAdminDevices();
  const clients = useAdminClients();
  const revoke = useRevokeDevice();
  const update = useUpdateDevice();
  const [revoking, setRevoking] = useState<AdminDevice | null>(null);
  const [reason, setReason] = useState("");

  const rows = devices.data ?? [];

  const submitRevoke = async () => {
    if (!revoking) return;
    if (reason.trim().length < 3) return toast.error("Say why you're revoking it");
    try {
      await revoke.mutateAsync({ id: revoking.id, reason: reason.trim() });
      toast.success(`${revoking.name} can no longer sync`);
      setRevoking(null);
      setReason("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not revoke the device");
    }
  };

  const assign = async (device: AdminDevice, locationId: string) => {
    try {
      await update.mutateAsync({ id: device.id, locationId: locationId || null });
      toast.success("Device location updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update the device");
    }
  };

  return (
    <div>
      <PageHeader title="Offline Computers" />
      <p className="mb-4 max-w-prose text-sm text-muted-foreground">
        Computers running the desktop app. Each one holds a copy of its location's records and can
        work without internet. Revoking a computer cuts it off the next time it reaches the server.
      </p>

      <TableSurface>
        {queryFailed(devices) ? (
          <TableFailure query={devices} title="Couldn't load computers" />
        ) : devices.isPending ? (
          <TableLoading />
        ) : rows.length === 0 ? (
          <TableEmpty
            icon={Laptop}
            title="No computers registered"
            description="A computer registers itself the first time an owner signs in on the desktop app."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Computer</TableHead>
                <TableHead>Establishment</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Last sync</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => {
                const locations = clients.data?.find((c) => c.id === d.client.id)?.locations ?? [];
                return (
                  <TableRow key={d.id} className={d.status === "REVOKED" ? "opacity-50" : undefined}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="text-muted-foreground">{d.client.name}</TableCell>
                    <TableCell>
                      {d.status === "REVOKED" ? (
                        <span className="text-muted-foreground">{d.location?.name ?? "—"}</span>
                      ) : (
                        <Select value={d.location?.id ?? ""} onValueChange={(v) => void assign(d, v)}>
                          <SelectTrigger className="w-44">
                            <SelectValue placeholder="Not assigned" />
                          </SelectTrigger>
                          <SelectContent>
                            {locations.map((l) => (
                              <SelectItem key={l.id} value={l.id}>
                                {l.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell className="tnum text-muted-foreground">{sinceLabel(d.lastSyncAt)}</TableCell>
                    <TableCell>
                      {d.status === "REVOKED" ? (
                        <Badge variant="destructive">Revoked</Badge>
                      ) : isStale(d) ? (
                        // The number an admin actually needs: how much work is
                        // stranded on a machine that has gone quiet.
                        <Badge variant="warning">Not synced recently</Badge>
                      ) : (
                        <Badge variant="success">Synced</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {d.status === "ACTIVE" && (
                        <Button variant="ghost" size="sm" onClick={() => setRevoking(d)}>
                          <Link2Off className="size-3.5" />
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableSurface>

      <Dialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke {revoking?.name}?</DialogTitle>
            <DialogDescription>
              It will be signed out and unable to sync the next time it reaches the server.
            </DialogDescription>
          </DialogHeader>

          {revoking && isStale(revoking) && (
            // Revoking a machine that hasn't pushed is how a night's counts get
            // lost — it can no longer upload what it is holding.
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              This computer last synced {sinceLabel(revoking.lastSyncAt).toLowerCase()}. Anything
              recorded on it since then has not reached the server, and revoking it now means it
              never will.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="revoke-reason">Reason</Label>
            <Textarea
              id="revoke-reason"
              rows={2}
              autoFocus
              placeholder="e.g. computer replaced"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevoking(null)}>
              Go Back
            </Button>
            <Button variant="destructive" onClick={() => void submitRevoke()} disabled={revoke.isPending}>
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
