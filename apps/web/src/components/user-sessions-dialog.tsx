import { useState } from "react";
import { toast } from "sonner";
import { History, MonitorSmartphone } from "lucide-react";
import {
  useUserSessions,
  useRevokeUserSession,
  type UserActiveSession,
  type UserSessionHistoryEntry,
} from "@/api/admin";
import { ApiError } from "@/api/http";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VoidDialog } from "@/components/void-dialog";

/** Full date + time, since login/logout events carry a moment, not just a day. */
const DATETIME = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatDateTime(iso: string): string {
  return DATETIME.format(new Date(iso));
}

/** Combines active + history into one reverse-chronological row list for the table. */
interface SessionRow {
  key: string;
  device: string;
  ip: string | null;
  loggedIn: string;
  loggedOut: string | null;
  status: "active" | "ended" | "auto-logout";
  sessionId: string | null; // present + revokable only when status === "active"
}

function buildRows(active: UserActiveSession[], history: UserSessionHistoryEntry[]): SessionRow[] {
  const activeRows: SessionRow[] = active.map((s) => ({
    key: `active:${s.id}`,
    device: s.device,
    ip: s.ip,
    loggedIn: s.loginAt,
    loggedOut: null,
    status: "active",
    sessionId: s.id,
  }));

  // History only carries login/logout/autoLogout *events*, not paired
  // sessions — pair each login with the next chronological logout-family
  // event for the same device+ip so each row reads as one session, not two
  // disconnected log lines.
  const logins = history.filter((e) => e.action === "auth.login").sort((a, b) => a.ts.localeCompare(b.ts));
  const closers = history
    .filter((e) => e.action === "auth.logout" || e.action === "auth.autoLogout")
    .sort((a, b) => a.ts.localeCompare(b.ts));
  const usedClosers = new Set<string>();

  const pastRows: SessionRow[] = logins.map((login) => {
    const closer = closers.find(
      (c) => !usedClosers.has(c.id) && c.ts >= login.ts && c.device === login.device && c.ip === login.ip,
    );
    if (closer) usedClosers.add(closer.id);
    // Still-open login with no closer and no matching active row means the
    // session ended some other way (expiry) — treat as ended, no time known.
    return {
      key: `hist:${login.id}`,
      device: login.device,
      ip: login.ip,
      loggedIn: login.ts,
      loggedOut: closer?.ts ?? null,
      status: closer?.action === "auth.autoLogout" ? "auto-logout" : "ended",
      sessionId: null,
    };
  });

  return [...activeRows, ...pastRows].sort((a, b) => b.loggedIn.localeCompare(a.loggedIn));
}

function StatusBadge({ status }: { status: SessionRow["status"] }) {
  if (status === "active") return <Badge variant="success">Active</Badge>;
  if (status === "auto-logout") return <Badge variant="outline">Auto Signed Out</Badge>;
  return <Badge variant="secondary">Ended</Badge>;
}

export function UserSessionsDialog({
  userId,
  userLabel,
  onClose,
}: {
  userId: string | null;
  userLabel: string;
  onClose: () => void;
}) {
  const sessions = useUserSessions(userId);
  const revoke = useRevokeUserSession(userId);
  const [revoking, setRevoking] = useState<SessionRow | null>(null);
  // Rows the sweep has already fired for — kept tinted+struck locally rather
  // than waiting on refetch, so the "Row void" motion actually plays.
  const [justRevoked, setJustRevoked] = useState<Set<string>>(new Set());

  const rows = sessions.data ? buildRows(sessions.data.active, sessions.data.history) : [];

  return (
    <>
      <Dialog open={!!userId} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Login History — {userLabel}</DialogTitle>
            <DialogDescription>
              Every device this account has logged in from, most recent first.
            </DialogDescription>
          </DialogHeader>

          {sessions.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-center">
              <History className="mx-auto mb-2 size-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No logins recorded yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead>Device</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Logged In</TableHead>
                  <TableHead>Logged Out</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const struck = justRevoked.has(row.key);
                  return (
                    <TableRow key={row.key} className={cn(struck && "opacity-50")}>
                      <TableCell className={cn("flex items-center gap-1.5", struck && "line-through")}>
                        <MonitorSmartphone className="size-3.5 shrink-0 text-muted-foreground" />
                        {row.device}
                      </TableCell>
                      <TableCell className={cn("tabular-nums text-right", struck && "line-through")}>
                        {row.ip ?? "—"}
                      </TableCell>
                      <TableCell className={cn("tabular-nums", struck && "line-through")}>
                        {formatDateTime(row.loggedIn)}
                      </TableCell>
                      <TableCell className={cn("tabular-nums", struck && "line-through")}>
                        {row.loggedOut ? formatDateTime(row.loggedOut) : "still active"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={struck ? "ended" : row.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {row.status === "active" && !struck && (
                          <Button variant="destructive" size="xs" onClick={() => setRevoking(row)}>
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
        </DialogContent>
      </Dialog>

      <VoidDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke this session?"
        description="The device is signed out immediately and its next request will be sent back to login."
        pending={revoke.isPending}
        onConfirm={async (reason) => {
          if (!revoking?.sessionId) return;
          try {
            await revoke.mutateAsync({ sessionId: revoking.sessionId, reason });
            setJustRevoked((prev) => new Set(prev).add(revoking.key));
            toast.success("Session revoked");
            setRevoking(null);
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : "Could not revoke the session");
          }
        }}
      />
    </>
  );
}
