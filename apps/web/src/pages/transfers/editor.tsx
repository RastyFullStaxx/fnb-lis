import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { can, type Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useLocationId } from "@/api/location";
import { useTransfer, useTransferMutations } from "@/api/ops";
import { variantLabel, type LocationItem, type TransferLine } from "@/api/types";
import { ApiError } from "@/api/http";
import { formatMoney } from "@/lib/utils";
import { ItemCombobox } from "@/components/item-combobox";
import { VoidDialog } from "@/components/void-dialog";
import { TableSurface, TableLoading } from "@/components/table-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuantityInput } from "@/components/quantity-input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function TransferEditorPage() {
  const { transferId } = useParams();
  const transfer = useTransfer(transferId!);
  const me = useMe();
  const mutations = useTransferMutations(transferId);
  const locationId = useLocationId();

  const [item, setItem] = useState<LocationItem | null>(null);
  const [qty, setQty] = useState("");
  const [voidingLine, setVoidingLine] = useState<TransferLine | null>(null);
  const [voidingTransfer, setVoidingTransfer] = useState(false);
  const [voidingReceipt, setVoidingReceipt] = useState<{ receiptId: string; label: string } | null>(null);
  const comboRef = useRef<HTMLButtonElement>(null);

  if (transfer.isPending) {
    // Skeleton shaped like the final layout: back-button header + lines surface.
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label="Back to transfers">
            <Link to={`/l/${locationId}/transfers`}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <TableSurface>
          <TableLoading rows={6} />
        </TableSurface>
      </div>
    );
  }
  if (transfer.isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <p className="text-sm text-foreground">
            This transfer couldn't be found — it may have been removed, or the link is out of date.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to={`/l/${locationId}/transfers`}>Back to transfers</Link>
          </Button>
        </div>
      </div>
    );
  }

  const t = transfer.data;
  const isSource = t.fromLocationId === locationId;
  const isDraft = t.status === "DRAFT";
  const role = (me.data?.user.role ?? "READONLY") as Role;
  const canVoid = isSource && can(role, "entries.void") && t.status === "COMMITTED";
  // Discarding one's own draft is entry-level work (the server agrees);
  // voiding a committed document stays a manager action.
  const canDiscard = isSource && isDraft && can(role, "entries.create");
  // The destination owns its receipts — voiding one re-opens the line for a
  // corrected receive, and is the required FIRST step before the source can
  // void anything (receipt-first ordering).
  const canVoidReceipt = !isSource && can(role, "entries.void");
  const activeLines = t.lines.filter((l) => l.status === "ACTIVE");
  const total = activeLines.reduce((s, l) => s + l.lineTotal, 0);

  const addLine = async () => {
    if (!item) return;
    const q = Number(qty);
    if (!q || q <= 0) return toast.error("Enter the quantity to send");
    try {
      await mutations.addLine.mutateAsync({ locationItemId: item.id, qty: q });
      setItem(null);
      setQty("");
      comboRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add the line");
    }
  };

  const commit = async () => {
    try {
      await mutations.commit.mutateAsync();
      toast.success("Transfer committed — awaiting the destination's receipt");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not commit");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to transfers">
          <Link to={`/l/${locationId}/transfers`}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-xl font-semibold tracking-tight tnum">
            Transfer · {t.businessDate}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t.fromLocation?.name} → {t.toLocation?.name}
            {t.status === "VOID" && ` · void: ${t.voidReason}`}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {(canVoid || canDiscard) && (
            <Button variant="outline" size="sm" onClick={() => setVoidingTransfer(true)}>
              {isDraft ? "Discard draft" : "Void transfer"}
            </Button>
          )}
          {isDraft && isSource && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" disabled={activeLines.length === 0}>
                  <Check className="size-4" /> Commit transfer
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Commit this transfer?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {activeLines.length} line{activeLines.length === 1 ? "" : "s"}, {formatMoney(total)} at cost, to{" "}
                    {t.toLocation?.name}. Committed transfers leave this location's stock pool on {t.businessDate}; the
                    destination then confirms what arrived.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep drafting</AlertDialogCancel>
                  <AlertDialogAction onClick={commit}>Commit</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Badge variant={isDraft ? "default" : "secondary"}>
            {isDraft ? "Draft" : t.status === "COMMITTED" ? "Committed" : "Void"}
          </Badge>
        </div>
      </div>

      <TableSurface
        filters={
          isDraft && isSource ? (
            <div className="grid w-full grid-cols-[minmax(0,1fr)_7rem_auto] items-end gap-2">
              <div className="space-y-2">
                <Label>Item (from this location's catalog)</Label>
                <ItemCombobox ref={comboRef} value={item} onSelect={setItem} autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tl-qty">Qty</Label>
                <QuantityInput id="tl-qty" className="tnum" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLine()} />
              </div>
              <Button onClick={addLine} disabled={!item || mutations.addLine.isPending}>
                Add
              </Button>
            </div>
          ) : undefined
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Sent</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Unit cost</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No lines yet — add the items to send above.
                </TableCell>
              </TableRow>
            ) : (
              t.lines.map((line) => {
                const voided = line.status === "VOID";
                const receipt = line.receipts[0];
                const short = receipt !== undefined && receipt.qtyReceived < line.qty;
                return (
                  <TableRow key={line.id} className={cn(voided && "opacity-50")}>
                    <TableCell className={cn(voided && "line-through")}>
                      <span className="font-medium">{line.locationItem.itemVariant.item.name}</span>
                      <span className="ml-1.5 text-sm text-muted-foreground">
                        {variantLabel(line.locationItem.itemVariant)}
                      </span>
                      {voided && line.voidReason && (
                        <span className="ml-2 text-xs text-muted-foreground">void: {line.voidReason}</span>
                      )}
                    </TableCell>
                    <TableCell className="tnum text-right">{line.qty}</TableCell>
                    <TableCell className={cn("tnum text-right", short && "font-medium text-destructive")}>
                      {voided ? "—" : receipt ? receipt.qtyReceived : <span className="text-muted-foreground">pending</span>}
                    </TableCell>
                    <TableCell className="tnum text-right">{formatMoney(line.unitCost)}</TableCell>
                    <TableCell className="tnum text-right">{formatMoney(line.lineTotal)}</TableCell>
                    <TableCell className="text-right">
                      {isDraft && isSource ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove line"
                          onClick={() =>
                            mutations.removeLine
                              .mutateAsync(line.id)
                              .catch((err) => toast.error(err instanceof ApiError ? err.message : "Could not remove"))
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : canVoid && !voided ? (
                        <Button variant="ghost" size="sm" onClick={() => setVoidingLine(line)}>
                          Void
                        </Button>
                      ) : canVoidReceipt && !voided && receipt ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setVoidingReceipt({
                              receiptId: receipt.id,
                              label: `${line.locationItem.itemVariant.item.name} — ${receipt.qtyReceived} received`,
                            })
                          }
                        >
                          Void receipt
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
          {activeLines.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">Total</TableCell>
                <TableCell className="tnum text-right font-medium">
                  {activeLines.reduce((s, l) => s + l.qty, 0)}
                </TableCell>
                <TableCell className="tnum text-right font-medium">
                  {activeLines.some((l) => l.receipts[0])
                    ? activeLines.reduce((s, l) => s + (l.receipts[0]?.qtyReceived ?? 0), 0)
                    : "—"}
                </TableCell>
                <TableCell />
                <TableCell className="tnum text-right font-semibold">{formatMoney(total)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </TableSurface>

      <VoidDialog
        open={voidingLine !== null}
        onOpenChange={(open) => !open && setVoidingLine(null)}
        title="Void this transfer line?"
        pending={mutations.voidLine.isPending}
        onConfirm={async (reason) => {
          try {
            await mutations.voidLine.mutateAsync({ lineId: voidingLine!.id, reason });
            toast.success("Line voided — reports updated");
            setVoidingLine(null);
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : "Could not void");
          }
        }}
      />
      <VoidDialog
        open={voidingTransfer}
        onOpenChange={setVoidingTransfer}
        title={isDraft ? "Discard this draft transfer?" : "Void this whole transfer?"}
        pending={mutations.voidTransfer.isPending}
        onConfirm={async (reason) => {
          try {
            await mutations.voidTransfer.mutateAsync(reason);
            toast.success(isDraft ? "Draft discarded" : "Transfer voided");
            setVoidingTransfer(false);
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : "Could not void");
          }
        }}
      />
      <VoidDialog
        open={voidingReceipt !== null}
        onOpenChange={(open) => !open && setVoidingReceipt(null)}
        title={`Void this receipt? (${voidingReceipt?.label ?? ""})`}
        pending={mutations.voidReceipt.isPending}
        onConfirm={async (reason) => {
          try {
            await mutations.voidReceipt.mutateAsync({ id: t.id, receiptId: voidingReceipt!.receiptId, reason });
            toast.success("Receipt voided — the line can be received again");
            setVoidingReceipt(null);
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : "Could not void the receipt");
          }
        }}
      />
    </div>
  );
}
