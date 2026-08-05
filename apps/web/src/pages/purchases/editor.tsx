import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { can, lineTotal, type Role } from "@fnb/core";
import { statusVariant } from "@/lib/status";
import { useMe } from "@/api/auth";
import { useLocationId } from "@/api/location";
import { usePurchase, usePurchaseMutations } from "@/api/ops";
import { variantLabel, type LocationItem, type PurchaseLine } from "@/api/types";
import { ApiError } from "@/api/http";
import { formatMoney, formatDate } from "@/lib/utils";
import { EntryActions } from "@/components/entry-fact";
import { ItemCombobox } from "@/components/item-combobox";
import { TableFailure, TableSurface, queryPaused } from "@/components/table-surface";
import { VoidDialog } from "@/components/void-dialog";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

export function PurchaseEditorPage() {
  const { purchaseId } = useParams();
  const purchase = usePurchase(purchaseId!);
  const me = useMe();
  const mutations = usePurchaseMutations(purchaseId);
  const locationId = useLocationId();
  // Arriving here via Full Audit's drilldown (see full-audit.tsx's
  // fullAuditReturnUrl) stashes the exact report URL — filters, period, and
  // ?drill=<item> — in router state. "Back" should return there, not to the
  // plain Purchases list, or the user loses the report context they came from.
  const routerLocation = useLocation();
  const returnTo = (routerLocation.state as { returnTo?: string } | null)?.returnTo;
  const backHref = returnTo || `/l/${locationId}/purchases`;

  const [item, setItem] = useState<LocationItem | null>(null);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [voidingLine, setVoidingLine] = useState<PurchaseLine | null>(null);
  const [editingLine, setEditingLine] = useState<PurchaseLine | null>(null);
  const comboRef = useRef<HTMLButtonElement>(null);

  // Same split the Transfer editor makes: unreachable is not "removed", and a
  // paused query never leaves `isPending` — without this the editor sat on a
  // skeleton forever the moment the server went away.
  if (queryPaused(purchase))
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label="Back">
            <Link to={backHref}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
        </div>
        <TableSurface>
          <TableFailure query={purchase} title="Couldn't load this delivery" />
        </TableSurface>
      </div>
    );
  if (purchase.isPending) return <EditorSkeleton />;
  if (purchase.isError)
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-sm">Couldn't load this delivery — it may have been removed.</p>
        <Button asChild variant="outline" size="sm">
          <Link to={backHref}>Back to Purchases</Link>
        </Button>
      </div>
    );

  const p = purchase.data;
  const isDraft = p.status === "DRAFT";
  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;
  const canVoid = can(role, "entries.void") && p.status === "COMMITTED";
  // Editing voids the original and writes a replacement, so it needs both
  // rights — same rule as Sales.
  const canEdit = canVoid && can(role, "entries.create");
  const activeLines = p.lines.filter((l) => l.status === "ACTIVE");
  const total = activeLines.reduce((s, l) => s + l.lineTotal, 0);

  const pickItem = (li: LocationItem) => {
    setItem(li);
    if (cost === "") setCost(String(li.cost || ""));
  };

  const addLine = async () => {
    if (!item) return;
    const q = Number(qty);
    const c = Number(cost);
    if (!q || q <= 0) return toast.error("Enter the quantity received");
    if (!Number.isFinite(c) || c < 0) return toast.error("Enter the unit cost");
    try {
      await mutations.addLine.mutateAsync({ locationItemId: item.id, qty: q, unitCost: c });
      setItem(null);
      setQty("");
      setCost("");
      comboRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add the line");
    }
  };

  const commit = async () => {
    try {
      await mutations.commit.mutateAsync();
      toast.success("Delivery committed — stock pool updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not commit");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to={backHref}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Delivery · {formatDate(p.purchaseDate)}</h2>
          <p className="text-sm text-muted-foreground">
            {p.supplier?.name ?? "No supplier"}
            {p.refNo && ` · ${p.refNo}`}
            {p.status === "VOID" && ` · cancelled: ${p.voidReason}`}
          </p>
        </div>
        <Badge className="ml-auto" variant={statusVariant(p.status)}>
          {isDraft ? "Draft" : p.status === "COMMITTED" ? "Committed" : "Cancelled"}
        </Badge>
        {/* Commit lives in the fixed header so it never scrolls out of reach on long drafts. */}
        {isDraft && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={activeLines.length === 0}>
                <Check className="size-4" /> Commit Delivery
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Commit this delivery?</AlertDialogTitle>
                <AlertDialogDescription>
                  {activeLines.length} line{activeLines.length === 1 ? "" : "s"}, {formatMoney(total)} total.
                  Committed deliveries count into reports; fixes then go through void &amp; correct.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep Drafting</AlertDialogCancel>
                <AlertDialogAction onClick={commit}>Commit</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* One surface: the add-line strip is the table's toolbar, and only the rows scroll. */}
      <TableSurface
        filters={
          isDraft ? (
            // Four columns need ~34rem; below that the fixed Qty/Unit Cost
            // tracks and the Add button squeeze the Item combobox to nothing.
            // Stack until the strip genuinely has the room. The container is
            // the wrapper, not the grid — an element can't answer its own
            // container query.
            <div className="@container/strip w-full">
              <div className="grid gap-3 @2xl/strip:grid-cols-[minmax(0,1fr)_7rem_8rem_auto] @2xl/strip:items-end">
                <div className="space-y-2">
                  <Label htmlFor="pl-item">Item</Label>
                  <ItemCombobox id="pl-item" ref={comboRef} value={item} onSelect={pickItem} autoFocus />
                </div>
                <div className="space-y-2">
                  {/* A delivery is exactly where cases and bottles get
                      conflated — "12" of a 1 L Cola could be a dozen bottles or
                      a dozen cases, and the cost per unit below only makes sense
                      once that is settled. Naming the unit removes the guess. */}
                  <Label htmlFor="pl-qty">Qty{item ? ` (${variantLabel(item.itemVariant)})` : ""}</Label>
                  <QuantityInput id="pl-qty" className="tnum bg-background" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLine()} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pl-cost">Unit Cost</Label>
                  <QuantityInput id="pl-cost" className="tnum bg-background" value={cost} onChange={(e) => setCost(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLine()} />
                </div>
                <Button size="sm" onClick={addLine} disabled={!item || mutations.addLine.isPending}>
                  Add
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit Cost</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No lines yet — add the delivered items above.
                </TableCell>
              </TableRow>
            ) : (
              p.lines.map((line) => {
                const voided = line.status === "VOID";
                return (
                  <TableRow key={line.id} className={cn(voided && "opacity-50")}>
                    <TableCell className={cn(voided && "line-through")}>
                      <span className="font-medium">{line.locationItem.itemVariant.item.name}</span>
                      <span className="ml-1.5 text-sm text-muted-foreground">
                        {variantLabel(line.locationItem.itemVariant)}
                      </span>
                      {voided && line.voidReason && (
                        <span className="ml-2 text-xs text-muted-foreground">cancelled: {line.voidReason}</span>
                      )}
                      {/* The replacement half of a correction — named on the row
                          so the pair reads as one fix, not two unrelated lines. */}
                      {line.correctionOfId && !voided && (
                        <span className="ml-2 text-xs text-muted-foreground">correction</span>
                      )}
                    </TableCell>
                    <TableCell className="tnum text-right">{line.qty}</TableCell>
                    <TableCell className="tnum text-right">{formatMoney(line.unitCost)}</TableCell>
                    <TableCell className="tnum text-right">{formatMoney(line.lineTotal)}</TableCell>
                    <TableCell className="text-right">
                      {isDraft ? (
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
                      ) : !voided && (canVoid || canEdit) ? (
                        <div className="flex justify-end">
                          <EntryActions
                            actions={[
                              ...(canEdit ? [{ label: "Edit", onClick: () => setEditingLine(line) }] : []),
                              ...(canVoid
                                ? [{ label: "Cancel", destructive: true, onClick: () => setVoidingLine(line) }]
                                : []),
                            ]}
                          />
                        </div>
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
        title="Cancel this purchase line?"
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

      <EditLineDialog
        line={editingLine}
        purchaseId={purchaseId!}
        onOpenChange={(open) => !open && setEditingLine(null)}
      />
    </div>
  );
}

/**
 * Edit a committed delivery line. The item is fixed — you're correcting what
 * the invoice actually said, not what was delivered (for a missed item, record
 * a new delivery). Saving voids the original and writes a linked replacement
 * onto this same delivery, so the fix keeps the invoice's date and lands in the
 * report period the original did; a reason is required, same as a cancel.
 */
function EditLineDialog({
  line,
  purchaseId,
  onOpenChange,
}: {
  line: PurchaseLine | null;
  purchaseId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const mutations = usePurchaseMutations(purchaseId);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [changeReason, setChangeReason] = useState("");

  // Re-seed every field when a different line opens the dialog.
  useEffect(() => {
    if (!line) return;
    setQty(String(line.qty));
    setCost(String(line.unitCost));
    setChangeReason("");
  }, [line]);

  if (!line) return null;
  const variant = line.locationItem.itemVariant;
  const q = Number(qty);
  const c = Number(cost);

  const submit = async () => {
    if (qty === "" || !Number.isFinite(q) || q <= 0) return toast.error("Enter the quantity received");
    if (cost === "" || !Number.isFinite(c) || c < 0) return toast.error("Enter the unit cost");
    if (changeReason.trim().length < 3) return toast.error("Add a reason for the change");
    try {
      await mutations.correctLine.mutateAsync({
        lineId: line.id,
        qty: q,
        unitCost: c,
        reason: changeReason.trim(),
      });
      toast.success("Line updated — the original is kept, marked corrected");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the change");
    }
  };

  return (
    <Dialog open={line !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Line</DialogTitle>
          <DialogDescription>
            {variant.item.name} {variantLabel(variant)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="el-qty">Qty</Label>
              <QuantityInput id="el-qty" className="tnum" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="el-cost">Unit Cost</Label>
              <QuantityInput id="el-cost" className="tnum" value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
          </div>

          {/* The resulting line total, live — the number that reaches the
              report, shown before it is committed rather than after. */}
          {Number.isFinite(q) && Number.isFinite(c) && qty !== "" && cost !== "" && (
            <p className="tnum text-sm text-muted-foreground">
              {/* core lineTotal (phpRound), not q*c — the preview must never
                  disagree with the value the server stores. */}
              New line total <span className="font-semibold text-foreground">{formatMoney(lineTotal(q, c))}</span>
              {" · was "}
              {formatMoney(line.lineTotal)}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="el-change">Reason for change</Label>
            <Input
              id="el-change"
              placeholder="e.g. Invoice qty misread"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel Correction
          </Button>
          <Button onClick={submit} disabled={mutations.correctLine.isPending}>
            {mutations.correctLine.isPending ? "Saving…" : "Save Correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Skeleton shaped like the editor — header row, entry strip, then table rows. */
function EditorSkeleton() {
  return (
    <div aria-busy="true" className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="size-9" />
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="ml-auto h-6 w-20" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
        <div className="border-b bg-muted/30 px-3 py-2.5">
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-4 py-3">
              <Skeleton className="h-5 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
