import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Plus, ShoppingCart, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { can, type Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useLocationId, useSuppliers } from "@/api/location";
import { useForfeitMutations, useForfeits, usePurchaseMutations, usePurchases } from "@/api/ops";
import { variantLabel, type Forfeit, type LocationItem } from "@/api/types";
import { ApiError } from "@/api/http";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty } from "@/components/table-surface";
import { ItemCombobox } from "@/components/item-combobox";
import { VoidDialog } from "@/components/void-dialog";
import { useWeighPreview, WeighPreviewStrip } from "@/components/weigh-calculator";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const NONE = "__none__";

export function PurchasesPage() {
  const [tab, setTab] = useState("purchases");
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div>
      <PageHeader
        title="Purchases"
        actions={
          tab === "purchases" ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Receive delivery
            </Button>
          ) : undefined
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TableSurface
          filters={
            <TabsList>
              <TabsTrigger value="purchases">Deliveries</TabsTrigger>
              <TabsTrigger value="forfeits">Returned bottles</TabsTrigger>
            </TabsList>
          }
        >
          <TabsContent value="purchases" className="m-0">
            <PurchasesTab createOpen={createOpen} setCreateOpen={setCreateOpen} />
          </TabsContent>
          <TabsContent value="forfeits" className="m-0 p-4">
            <ForfeitsTab />
          </TabsContent>
        </TableSurface>
      </Tabs>
    </div>
  );
}

function PurchasesTab({
  createOpen,
  setCreateOpen,
}: {
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
}) {
  const purchases = usePurchases();
  const locationId = useLocationId();

  return (
    <>
      {purchases.isPending ? (
        <TableLoading />
      ) : (purchases.data ?? []).length === 0 ? (
        <TableEmpty
          icon={ShoppingCart}
          title="No purchases yet"
          description="Record deliveries here — committed purchases add into the period's stock pool."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Receive delivery
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead>Date</TableHead>
              <TableHead>Supplier / Ref</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {purchases.data!.map((p) => (
              <TableRow key={p.id} className={p.status === "VOID" ? "opacity-50" : undefined}>
                <TableCell className="tnum font-medium">{p.purchaseDate}</TableCell>
                <TableCell className="text-muted-foreground">
                  {p.supplier?.name ?? "—"}
                  {p.refNo && <span className="ml-2 text-xs">({p.refNo})</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={p.status === "DRAFT" ? "default" : p.status === "COMMITTED" ? "secondary" : "outline"}>
                    {p.status === "DRAFT" ? "Draft" : p.status === "COMMITTED" ? "Committed" : "Void"}
                  </Badge>
                </TableCell>
                <TableCell className="tnum text-right">{p.lineCount}</TableCell>
                <TableCell className="tnum text-right">{formatMoney(p.total ?? 0)}</TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="ghost" size="sm">
                    <Link to={`/l/${locationId}/purchases/${p.id}`}>
                      {p.status === "DRAFT" ? "Continue" : "View"}
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <NewPurchaseDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function NewPurchaseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const locationId = useLocationId();
  const suppliers = useSuppliers();
  const { create } = usePurchaseMutations();
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState(NONE);
  const [refNo, setRefNo] = useState("");

  const start = async () => {
    try {
      const purchase = await create.mutateAsync({
        purchaseDate,
        supplierId: supplierId === NONE ? null : supplierId,
        refNo: refNo || null,
      });
      navigate(`/l/${locationId}/purchases/${purchase.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not start the delivery");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Receive a delivery</DialogTitle>
          <DialogDescription>Starts a draft — add lines, then commit when the delivery checks out.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="p-date">Delivery date</Label>
            <Input id="p-date" type="date" className="tnum" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Supplier (optional)</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No supplier</SelectItem>
                {(suppliers.data ?? []).filter((s) => s.isActive).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-ref">Invoice / reference (optional)</Label>
            <Input id="p-ref" value={refNo} onChange={(e) => setRefNo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={start} disabled={!purchaseDate || create.isPending}>
            {create.isPending ? "Starting…" : "Start draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Returned bottles (legacy "forfeited") ──

function ForfeitsTab() {
  const me = useMe();
  const forfeits = useForfeits();
  const { create, voidForfeit } = useForfeitMutations();
  const [item, setItem] = useState<LocationItem | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [scale, setScale] = useState("");
  const [qty, setQty] = useState("");
  const [voiding, setVoiding] = useState<Forfeit | null>(null);

  const role = (me.data?.user.role ?? "READONLY") as Role;
  const canVoid = can(role, "entries.void");
  const weighable = item?.itemVariant.contentTracked ?? false;
  const preview = useWeighPreview(item, scale);

  const save = async () => {
    if (!item) return;
    try {
      if (weighable) {
        if (!preview || !preview.ready || !preview.entered || preview.blocking) {
          return toast.error("Fix the scale reading first");
        }
        await create.mutateAsync({
          forfeitDate: date,
          locationItemId: item.id,
          scaleWeight: preview.scale,
          scaleUnit: preview.unit as "g" | "oz",
          tareWeight: preview.tare,
          densityFactor: preview.density,
        });
      } else {
        const n = Number(qty);
        if (!n || n <= 0) return toast.error("Enter the returned quantity");
        await create.mutateAsync({ forfeitDate: date, locationItemId: item.id, qty: n });
      }
      toast.success("Returned stock recorded — it adds back into the period's pool");
      setItem(null);
      setScale("");
      setQty("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save");
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          A customer leaves an unfinished bottle — weigh it and its content returns to stock. This is the
          legacy "forfeited bottle": it <span className="font-medium text-foreground">adds into</span> the
          usage pool.
        </p>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div className="space-y-2">
            <Label>Item</Label>
            <ItemCombobox value={item} onSelect={setItem} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="f-date">Date</Label>
            <Input id="f-date" type="date" className="tnum" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        {weighable ? (
          <div className="space-y-2">
            <Label htmlFor="f-scale">Scale reading{preview?.ready ? ` (${preview.unit})` : ""}</Label>
            <Input
              id="f-scale"
              type="number"
              step="any"
              min="0"
              className="tnum h-11 text-lg"
              value={scale}
              onChange={(e) => setScale(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
            <WeighPreviewStrip
              preview={preview}
              size={item?.itemVariant.size ?? 0}
              contentUnit={item?.itemVariant.unit.name ?? "ml"}
            />
          </div>
        ) : (
          item && (
            <div className="space-y-2">
              <Label htmlFor="f-qty">Quantity returned</Label>
              <Input
                id="f-qty"
                type="number"
                step="any"
                min="0"
                className="tnum h-11 text-lg"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
            </div>
          )
        )}
        <div className="flex justify-end">
          <Button onClick={save} disabled={!item || create.isPending}>
            <Undo2 className="size-4" /> {create.isPending ? "Saving…" : "Record return"}
          </Button>
        </div>
      </div>

      <div className="lg:border-l lg:pl-6">
        <div className="mb-2 text-sm font-medium">Recent returns</div>
        <div className="max-h-[26rem] divide-y overflow-y-auto">
          {forfeits.isPending ? (
            <Skeleton className="m-4 h-24" />
          ) : (forfeits.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No returned bottles recorded.</p>
          ) : (
            forfeits.data!.map((f) => {
              const variant = f.locationItem.itemVariant;
              const voided = f.status === "VOID";
              return (
                <div key={f.id} className={cn("flex items-center gap-3 px-4 py-2.5", voided && "opacity-50")}>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium", voided && "line-through")}>
                      {variant.item.name}
                      <span className="ml-1.5 font-normal text-muted-foreground">{variantLabel(variant)}</span>
                    </p>
                    <p className="tnum text-xs text-muted-foreground">
                      {f.forfeitDate} ·{" "}
                      {f.remainingContent > 0
                        ? `${f.remainingContent} ${variant.unit.name} back to stock`
                        : `${f.qty} unit(s)`}
                      {voided && f.voidReason && ` · void: ${f.voidReason}`}
                    </p>
                  </div>
                  {canVoid && !voided && (
                    <Button variant="ghost" size="sm" onClick={() => setVoiding(f)}>
                      Void
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <VoidDialog
        open={voiding !== null}
        onOpenChange={(open) => !open && setVoiding(null)}
        title="Void this return?"
        pending={voidForfeit.isPending}
        onConfirm={async (reason) => {
          try {
            await voidForfeit.mutateAsync({ id: voiding!.id, reason });
            toast.success("Return voided");
            setVoiding(null);
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : "Could not void");
          }
        }}
      />
    </div>
  );
}
