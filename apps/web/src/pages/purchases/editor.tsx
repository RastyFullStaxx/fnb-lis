import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { can, type Role } from "@fnb/core";
import { statusVariant } from "@/lib/status";
import { useMe } from "@/api/auth";
import { useLocationId } from "@/api/location";
import { usePurchase, usePurchaseMutations } from "@/api/ops";
import { variantLabel, type LocationItem, type PurchaseLine } from "@/api/types";
import { ApiError } from "@/api/http";
import { formatMoney } from "@/lib/utils";
import { ItemCombobox } from "@/components/item-combobox";
import { TableSurface } from "@/components/table-surface";
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

  const [item, setItem] = useState<LocationItem | null>(null);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [voidingLine, setVoidingLine] = useState<PurchaseLine | null>(null);
  const comboRef = useRef<HTMLButtonElement>(null);

  if (purchase.isPending) return <EditorSkeleton />;
  if (purchase.isError)
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-sm">Couldn't load this delivery — it may have been removed.</p>
        <Button asChild variant="outline" size="sm">
          <Link to={`/l/${locationId}/purchases`}>Back to Purchases</Link>
        </Button>
      </div>
    );

  const p = purchase.data;
  const isDraft = p.status === "DRAFT";
  const role = (me.data?.user.role ?? "READONLY") as Role;
  const canVoid = can(role, "entries.void") && p.status === "COMMITTED";
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
        <Button asChild variant="ghost" size="icon" aria-label="Back to Purchases">
          <Link to={`/l/${locationId}/purchases`}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-xl font-semibold tracking-tight tnum">Delivery · {p.purchaseDate}</h2>
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
                  <Label htmlFor="pl-qty">Qty</Label>
                  <QuantityInput id="pl-qty" className="tnum bg-background" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLine()} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pl-cost">Unit Cost</Label>
                  <QuantityInput id="pl-cost" className="tnum bg-background" value={cost} onChange={(e) => setCost(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLine()} />
                </div>
                <Button onClick={addLine} disabled={!item || mutations.addLine.isPending}>
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
              <TableHead className="w-16" />
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
                      ) : canVoid && !voided ? (
                        <Button variant="destructive" size="xs" onClick={() => setVoidingLine(line)}>
                          Cancel
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
    </div>
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
