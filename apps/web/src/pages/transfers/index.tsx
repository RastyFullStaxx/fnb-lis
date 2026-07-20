import { useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { ArrowLeftRight, Inbox, Plus } from "lucide-react";
import { toast } from "sonner";
import { LOCATION_KIND_LABELS, can, type LocationKind, type Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useLocationId } from "@/api/location";
import { useTransfer, useTransferMutations, useTransfers } from "@/api/ops";
import { variantLabel, type Transfer } from "@/api/types";
import { ApiError } from "@/api/http";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty } from "@/components/table-surface";
import { QuantityInput } from "@/components/quantity-input";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function kindLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return LOCATION_KIND_LABELS[kind as LocationKind] ?? kind;
}

function StatusBadge({ transfer }: { transfer: Transfer }) {
  if (transfer.status === "DRAFT") return <Badge>Draft</Badge>;
  if (transfer.status === "VOID") return <Badge variant="destructive">Cancelled</Badge>;
  const received = transfer.receivedCount ?? 0;
  const lines = transfer.lineCount ?? 0;
  if (lines > 0 && received >= lines) {
    return (
      <Badge variant="success">
        Received
      </Badge>
    );
  }
  return (
    <Badge variant="warning">
      {received > 0 ? `${received}/${lines} received` : "Awaiting receipt"}
    </Badge>
  );
}

/** Row-level keyboard access for click-to-open table rows (Enter/Space opens). */
function rowLinkProps(open: () => void) {
  return {
    tabIndex: 0,
    role: "link" as const,
    onClick: open,
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        open();
      }
    },
  };
}

export function TransfersPage() {
  const [tab, setTab] = useState("out");
  const [createOpen, setCreateOpen] = useState(false);
  const me = useMe();
  const role = (me.data?.user.role ?? "READONLY") as Role;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Transfers"
        actions={
          tab === "out" && can(role, "entries.create") ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> New Transfer
            </Button>
          ) : undefined
        }
      />
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TableSurface
          filters={
            <TabsList>
              <TabsTrigger value="out">Outgoing</TabsTrigger>
              <TabsTrigger value="in">Incoming</TabsTrigger>
            </TabsList>
          }
        >
          <TabsContent value="out" className="m-0">
            <OutgoingTab createOpen={createOpen} setCreateOpen={setCreateOpen} />
          </TabsContent>
          <TabsContent value="in" className="m-0">
            <IncomingTab />
          </TabsContent>
        </TableSurface>
      </Tabs>
    </div>
  );
}

// ── Outgoing: this location dispatches stock ──

function OutgoingTab({ createOpen, setCreateOpen }: { createOpen: boolean; setCreateOpen: (o: boolean) => void }) {
  const transfers = useTransfers("out");
  const locationId = useLocationId();
  const navigate = useNavigate();

  return (
    <>
      {transfers.isPending ? (
        <TableLoading />
      ) : (transfers.data ?? []).length === 0 ? (
        <TableEmpty
          icon={ArrowLeftRight}
          title="No outgoing transfers"
          description="Send stock to another of this client's locations — the destination confirms what arrives."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> New Transfer
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead>Date</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">At Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transfers.data!.map((t) => (
              <TableRow
                key={t.id}
                className={cn(
                  "cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                  t.status === "VOID" && "opacity-50",
                )}
                {...rowLinkProps(() => navigate(`/l/${locationId}/transfers/${t.id}`))}
              >
                <TableCell className="tnum">{t.businessDate}</TableCell>
                <TableCell>
                  <span className="font-medium">{t.toLocation?.name}</span>
                  {kindLabel(t.toLocation?.kind) && (
                    <span className="ml-1.5 text-xs text-muted-foreground">{kindLabel(t.toLocation?.kind)}</span>
                  )}
                </TableCell>
                <TableCell><StatusBadge transfer={t} /></TableCell>
                <TableCell className="tnum text-right">{t.lineCount}</TableCell>
                <TableCell className="tnum text-right">{formatMoney(t.total ?? 0)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <CreateTransferDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function CreateTransferDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useMe();
  const locationId = useLocationId();
  const navigate = useNavigate();
  const mutations = useTransferMutations();
  const [toLocationId, setToLocationId] = useState("");
  const [businessDate, setBusinessDate] = useState(today());

  // Destinations: the same client's OTHER locations.
  const destinations = useMemo(() => {
    const client = me.data?.clients.find((c) => c.locations.some((l) => l.id === locationId));
    return (client?.locations ?? []).filter((l) => l.id !== locationId);
  }, [me.data, locationId]);

  const create = async () => {
    if (!toLocationId) return toast.error("Pick a destination location");
    try {
      const t = await mutations.create.mutateAsync({ toLocationId, businessDate });
      onOpenChange(false);
      navigate(`/l/${locationId}/transfers/${t.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not start the transfer");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Transfer</DialogTitle>
          <DialogDescription>
            Stock moves out of this location on the transfer date; the destination confirms what arrives.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Destination</Label>
            <Select value={toLocationId} onValueChange={setToLocationId}>
              <SelectTrigger>
                <SelectValue placeholder={destinations.length ? "Choose a location" : "No other locations for this client"} />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                    {kindLabel(l.kind) ? ` · ${kindLabel(l.kind)}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="t-date">Transfer Date</Label>
            <Input id="t-date" type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={create} disabled={!toLocationId || mutations.create.isPending}>
            Start Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Incoming: committed transfers headed to this location ──

function IncomingTab() {
  const transfers = useTransfers("in");
  const locationId = useLocationId();
  const navigate = useNavigate();
  const [receivingId, setReceivingId] = useState<string | null>(null);

  return (
    <>
      {transfers.isPending ? (
        <TableLoading />
      ) : (transfers.data ?? []).length === 0 ? (
        <TableEmpty
          icon={Inbox}
          title="No incoming transfers"
          description="Committed transfers from this client's other locations appear here for receiving."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead>Sent On</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">At Cost</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {transfers.data!.map((t) => {
              const outstanding = t.status === "COMMITTED" && (t.receivedCount ?? 0) < (t.lineCount ?? 0);
              return (
                <TableRow
                  key={t.id}
                  className={cn(
                    "cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                    t.status === "VOID" && "opacity-50",
                  )}
                  {...rowLinkProps(() => navigate(`/l/${locationId}/transfers/${t.id}`))}
                >
                  <TableCell className="tnum">{t.businessDate}</TableCell>
                  <TableCell>
                    <span className="font-medium">{t.fromLocation?.name}</span>
                    {kindLabel(t.fromLocation?.kind) && (
                      <span className="ml-1.5 text-xs text-muted-foreground">{kindLabel(t.fromLocation?.kind)}</span>
                    )}
                  </TableCell>
                  <TableCell><StatusBadge transfer={t} /></TableCell>
                  <TableCell className="tnum text-right">{t.lineCount}</TableCell>
                  <TableCell className="tnum text-right">{formatMoney(t.total ?? 0)}</TableCell>
                  <TableCell className="text-right">
                    {outstanding && (
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setReceivingId(t.id);
                        }}
                      >
                        Receive
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {receivingId && <ReceiveDialog transferId={receivingId} onClose={() => setReceivingId(null)} />}
    </>
  );
}

function ReceiveDialog({ transferId, onClose }: { transferId: string; onClose: () => void }) {
  const transfer = useTransfer(transferId);
  const mutations = useTransferMutations(transferId);
  const [receiptDate, setReceiptDate] = useState(today());
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const pending = (transfer.data?.lines ?? []).filter((l) => l.status === "ACTIVE" && l.receipts.length === 0);

  const receive = async () => {
    // A CLEARED field is invalid, not "receive everything" — the row styles
    // '' as 0 and silently recording the full sent qty would contradict it.
    if (
      pending.some((l) => {
        const raw = quantities[l.id];
        return raw !== undefined && raw.trim() === "";
      })
    ) {
      return toast.error("Enter a received quantity for every line (0 = nothing arrived)");
    }
    const lines = pending.map((l) => ({
      transferLineId: l.id,
      qtyReceived: quantities[l.id] === undefined ? l.qty : Number(quantities[l.id]),
      note: notes[l.id]?.trim() || undefined,
    }));
    if (lines.some((l) => !Number.isFinite(l.qtyReceived) || l.qtyReceived < 0)) {
      return toast.error("Received quantities must be zero or more");
    }
    const missingNote = pending.some((line, i) => {
      const entry = lines[i];
      return entry !== undefined && entry.qtyReceived !== line.qty && !entry.note;
    });
    if (missingNote) {
      return toast.error("Add a note to every line where the received amount differs from what was sent");
    }
    try {
      await mutations.receive.mutateAsync({ id: transferId, receiptDate, lines });
      toast.success("Receipt recorded — this location's stock pool updated");
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not record the receipt");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Receive transfer · {transfer.data?.fromLocation?.name ?? "…"}</DialogTitle>
          <DialogDescription>
            Confirm what actually arrived. A received amount that differs from the sent amount is kept as audit
            signal — explain it in the note.
          </DialogDescription>
        </DialogHeader>

        {transfer.isPending ? (
          <TableLoading />
        ) : pending.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Every line is already received.</p>
        ) : (
          <div className="space-y-4">
            <div className="w-44 space-y-2">
              <Label htmlFor="r-date">Receipt Date</Label>
              <Input id="r-date" type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
            </div>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead>Item</TableHead>
                    <TableHead className="w-20 text-right">Sent</TableHead>
                    <TableHead className="w-28">Received</TableHead>
                    <TableHead>Note (required when short)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((line) => {
                    const value = quantities[line.id] ?? String(line.qty);
                    const differs = Number(value) !== line.qty;
                    return (
                      <TableRow key={line.id}>
                        <TableCell>
                          <span className="font-medium">{line.locationItem.itemVariant.item.name}</span>
                          <span className="ml-1.5 text-sm text-muted-foreground">
                            {variantLabel(line.locationItem.itemVariant)}
                          </span>
                        </TableCell>
                        <TableCell className="tnum text-right">{line.qty}</TableCell>
                        <TableCell>
                          <QuantityInput
                            className={cn("tnum h-8", differs && "border-warning")}
                            value={value}
                            onChange={(e) => setQuantities((q) => ({ ...q, [line.id]: e.target.value }))}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8"
                            placeholder={differs ? "e.g. broken in transit" : ""}
                            value={notes[line.id] ?? ""}
                            onChange={(e) => setNotes((n) => ({ ...n, [line.id]: e.target.value }))}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={receive} disabled={pending.length === 0 || mutations.receive.isPending}>
            Confirm Receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
