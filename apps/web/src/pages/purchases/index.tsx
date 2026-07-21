import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Plus, ShoppingCart, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { can, type Role } from "@fnb/core";
import { statusVariant } from "@/lib/status";
import { useMe } from "@/api/auth";
import { useLocationId, useSuppliers } from "@/api/location";
import { useForfeitMutations, useForfeits, usePurchaseMutations, usePurchases } from "@/api/ops";
import { variantLabel, type Forfeit, type LocationItem } from "@/api/types";
import { ApiError } from "@/api/http";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, ToolbarField, ToolbarSearch } from "@/components/table-surface";
import { EntryFact, EntryFacts } from "@/components/entry-fact";
import { ItemCombobox } from "@/components/item-combobox";
import { VoidDialog } from "@/components/void-dialog";
import { useWeighPreview, WeighPreviewStrip } from "@/components/weigh-calculator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuantityInput } from "@/components/quantity-input";
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
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");

  const clearFilters = () => {
    setSearch("");
    setStatus("ALL");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Purchases"
        actions={
          tab === "purchases" ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Receive Delivery
            </Button>
          ) : (
            // Stable-height placeholder so the title row never jumps when the action leaves.
            <div aria-hidden="true" className="h-9" />
          )
        }
      />
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TableSurface
          filters={
            <>
              <ToolbarField label="View">
                <TabsList>
                  <TabsTrigger value="purchases">Deliveries</TabsTrigger>
                  <TabsTrigger value="forfeits">Returned Bottles</TabsTrigger>
                </TabsList>
              </ToolbarField>
              {tab === "purchases" && (
                <>
                  <ToolbarSearch
                    label="Search"
                    value={search}
                    onChange={setSearch}
                    placeholder="Search date, supplier, or ref…"
                  />
                  <ToolbarField label="Status" htmlFor="pu-status">
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger id="pu-status" className="w-40 bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Statuses</SelectItem>
                        <SelectItem value="DRAFT">Draft</SelectItem>
                        <SelectItem value="COMMITTED">Committed</SelectItem>
                        <SelectItem value="VOID">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </ToolbarField>
                </>
              )}
            </>
          }
        >
          <TabsContent value="purchases" className="m-0">
            <PurchasesTab
              createOpen={createOpen}
              setCreateOpen={setCreateOpen}
              search={search}
              status={status}
              onClearFilters={clearFilters}
            />
          </TabsContent>
          {/* h-full + overflow-hidden: the pane fills the surface and never
              scrolls as a whole, so only its Recent Returns list gets a bar —
              no stacked scrollbars. (Radix unmounts the inactive Deliveries
              table, so the shared body still scrolls normally for that tab.) */}
          <TabsContent value="forfeits" className="m-0 h-full overflow-hidden p-4">
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
  search,
  status,
  onClearFilters,
}: {
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  search: string;
  status: string;
  onClearFilters: () => void;
}) {
  const purchases = usePurchases();
  const locationId = useLocationId();

  const q = search.trim().toLowerCase();
  const filtered = (purchases.data ?? []).filter((p) => {
    const matchesStatus = status === "ALL" || p.status === status;
    const matchesSearch =
      !q ||
      p.purchaseDate.includes(q) ||
      (p.supplier?.name ?? "").toLowerCase().includes(q) ||
      (p.refNo ?? "").toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  return (
    <>
      {purchases.isPending ? (
        <TableLoading />
      ) : filtered.length === 0 ? (
        <TableEmpty
          icon={ShoppingCart}
          title={
            (purchases.data ?? []).length === 0 ? "No purchases yet" : "Nothing matches the current filter"
          }
          description={
            (purchases.data ?? []).length === 0
              ? "Record deliveries here — committed purchases add into the period's stock pool."
              : "Clear the search or status filter to see everything."
          }
          action={
            (purchases.data ?? []).length === 0 ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" /> Receive Delivery
              </Button>
            ) : (
              <Button variant="outline" onClick={onClearFilters}>
                Clear Filters
              </Button>
            )
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
            {filtered.map((p) => (
              <TableRow key={p.id} className={p.status === "VOID" ? "opacity-50" : undefined}>
                <TableCell className="tnum font-medium">{p.purchaseDate}</TableCell>
                <TableCell className="max-w-[22rem] break-words text-muted-foreground">
                  {p.supplier?.name ?? "—"}
                  {p.refNo && <span className="ml-2 text-xs">({p.refNo})</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(p.status)}>
                    {p.status === "DRAFT" ? "Draft" : p.status === "COMMITTED" ? "Committed" : "Cancelled"}
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
          <DialogTitle>Receive a Delivery</DialogTitle>
          <DialogDescription>Starts a draft — add lines, then commit when the delivery checks out.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="p-date">Delivery Date</Label>
            <Input id="p-date" type="date" className="tnum" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-supplier">Supplier (optional)</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger id="p-supplier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No Supplier</SelectItem>
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
  const weighable = (item?.itemVariant.contentTracked || item?.itemVariant.weighMode === "NET") ?? false;
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
          densityFactor: preview.density ?? undefined,
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
    <div className="grid gap-6 lg:h-full lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:grid-rows-1 lg:overflow-hidden">
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div className="space-y-2">
            <Label htmlFor="f-item">Item</Label>
            <ItemCombobox id="f-item" value={item} onSelect={setItem} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="f-date">Date</Label>
            <Input id="f-date" type="date" className="tnum" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        {weighable ? (
          <div className="space-y-2">
            <Label htmlFor="f-scale">Scale reading{preview?.ready ? ` (${preview.unit})` : ""}</Label>
            <QuantityInput
              id="f-scale"
              className="tnum h-11 text-lg"
              placeholder="Put the bottle on the scale"
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
              <Label htmlFor="f-qty">Quantity Returned</Label>
              <QuantityInput
                id="f-qty"
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

      <div className="flex min-h-0 flex-col lg:border-l lg:pl-6">
        <div className="mb-2 shrink-0 text-sm font-medium">Recent Returns</div>
        <div aria-live="polite" className="min-h-0 flex-1 divide-y overflow-y-auto max-lg:max-h-[28rem]">
          {forfeits.isPending ? (
            <div className="divide-y">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-1.5 px-4 py-2.5">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              ))}
            </div>
          ) : (forfeits.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No returned bottles yet — when a customer leaves an unfinished bottle, weigh it here and its
              content returns to the period's stock pool.
            </p>
          ) : (
            forfeits.data!.map((f) => {
              const variant = f.locationItem.itemVariant;
              const voided = f.status === "VOID";
              return (
                <div key={f.id} className={cn("flex flex-col gap-1 px-4 py-2.5", voided && "opacity-50")}>
                  {/* Name on its own full-width line so it uses the whole panel
                      before wrapping; the variant label never splits (700 / ml). */}
                  <p className={cn("text-sm font-medium", voided && "line-through")}>
                    {variant.item.name}
                    <span className="ml-1.5 whitespace-nowrap font-normal text-muted-foreground">
                      {variantLabel(variant)}
                    </span>
                  </p>
                  {/* Facts left, action bottom-right on the last fact's line. */}
                  <div className="flex items-end justify-between gap-3">
                    <EntryFacts>
                      <EntryFact label="Date" value={f.forfeitDate} />
                      <EntryFact
                        label="Returned"
                        value={
                          f.remainingContent > 0
                            ? `${f.remainingContent} ${variant.unit.name} (back to stock)`
                            : `${f.qty} unit(s)`
                        }
                      />
                      {voided && f.voidReason && <EntryFact label="Cancelled" value={f.voidReason} />}
                    </EntryFacts>
                    {canVoid && !voided && (
                      <Button variant="destructive" size="xs" className="shrink-0" onClick={() => setVoiding(f)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <VoidDialog
        open={voiding !== null}
        onOpenChange={(open) => !open && setVoiding(null)}
        title="Cancel this return?"
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
