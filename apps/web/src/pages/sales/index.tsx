import { forwardRef, useEffect, useRef, useState } from "react";
import { ChevronsUpDown, Martini, Receipt } from "lucide-react";
import { toast } from "sonner";
import { can, NON_REVENUE_GROUP_LABELS, NON_REVENUE_GROUPS, NON_REVENUE_REASONS, type Role, type SaleKind } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useLocationItems } from "@/api/location";
import { useMenus, type MenuSummary } from "@/api/menus";
import { useSaleMutations, useSales } from "@/api/ops";
import { variantLabel, type LocationItem, type SaleRecord } from "@/api/types";
import { ApiError } from "@/api/http";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, ToolbarField } from "@/components/table-surface";
import { VoidDialog } from "@/components/void-dialog";
import { EntryFact, EntryFacts } from "@/components/entry-fact";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuantityInput } from "@/components/quantity-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const KIND_COPY: Record<SaleKind, { title: string; button: string; saved: string }> = {
  SALE: {
    title: "Record a Sale",
    button: "Save Sale",
    saved: "Sale recorded",
  },
  NON_REVENUE: {
    title: "Record Non-Revenue Use",
    button: "Save Non-Revenue",
    saved: "Non-revenue use recorded",
  },
  PRODUCTION: {
    title: "Record Production Use",
    button: "Save Production",
    saved: "Production use recorded",
  },
};

/** Labels for every stored reason — canonical buckets plus legacy codes on
    historical rows (the entry select offers only the canonical three). */
const REASON_LABELS: Record<string, string> = {
  SPOILAGE_SPILLAGE: "Spoilage & Spillages",
  TRIMMING: "Trimming",
  MARKETING_OTH: "Marketing & OTH",
  COMPLIMENTARY: "Complimentary",
  SPILLAGE: "Spillage",
  STAFF_USE: "Staff use",
  SPOILAGE: "Spoilage",
  BREAKAGE: "Breakage",
  TASTING: "Tasting",
  INTERNAL_USE: "Internal use",
  OTHER: "Other",
};

export function SalesPage() {
  const me = useMe();
  const [kind, setKind] = useState<SaleKind>("SALE");
  const sales = useSales({ kind });
  const mutations = useSaleMutations();
  const [voiding, setVoiding] = useState<SaleRecord | null>(null);
  const [editing, setEditing] = useState<SaleRecord | null>(null);

  const role = (me.data?.user.role ?? "READONLY") as Role;
  const canVoid = can(role, "entries.void");
  // Editing voids the original and creates a replacement, so it needs both.
  const canEdit = canVoid && can(role, "entries.create");

  // rows is the displayed page (≤300); totalCount and netTotal come from the
  // server and cover every non-void entry, so the footer never quietly
  // under-reports once a busy location scrolls past the cap.
  const rows = sales.data?.rows ?? [];
  const totalCount = sales.data?.totalCount ?? 0;
  const netTotal = sales.data?.netTotal ?? 0;
  const capped = rows.length < totalCount;

  return (
    // Fill the viewport like every other list page: the surface takes the
    // remaining height and only the Recent Entries list scrolls, so the page
    // itself never gains a scrollbar.
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Sales" />

      <Tabs value={kind} onValueChange={(v) => setKind(v as SaleKind)} className="flex min-h-0 flex-1 flex-col">
        <TableSurface
          filters={
            <ToolbarField label="Record">
              <TabsList>
                <TabsTrigger value="SALE">Sales</TabsTrigger>
                <TabsTrigger value="NON_REVENUE">Non-revenue</TabsTrigger>
                <TabsTrigger value="PRODUCTION">Production</TabsTrigger>
              </TabsList>
            </ToolbarField>
          }
          // On lg the body is a fixed-height two-column grid that never scrolls
          // as a whole (lg:overflow-hidden); each pane manages its own overflow.
          // Below lg it stacks and scrolls normally.
          bodyClassName="grid gap-6 p-4 lg:min-h-0 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:grid-rows-1 lg:overflow-hidden"
        >
          <QuickEntry kind={kind} />

          <div className="flex min-h-0 flex-col lg:border-l lg:pl-6">
            <div className="mb-2 shrink-0 text-sm font-medium">Recent Entries</div>
            <div aria-live="polite" className="min-h-0 flex-1 divide-y overflow-y-auto max-lg:max-h-[28rem]">
            {sales.isPending ? (
              <div className="divide-y">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="space-y-1.5 px-4 py-2.5">
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-3 w-2/5" />
                  </div>
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="p-6 text-center">
                <Receipt className="mx-auto mb-2 size-6 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Nothing recorded yet for this tab.</p>
              </div>
            ) : (
              rows.map((sale) => {
                const voided = sale.status === "VOID";
                // Split name and size so the size ("750 ml") can stay unbroken.
                const itemName = sale.locationItem
                  ? sale.locationItem.itemVariant.item.name
                  : (sale.menuItem?.name ?? "—");
                const sizeSuffix = sale.locationItem
                  ? variantLabel(sale.locationItem.itemVariant)
                  : "";
                return (
                  <div key={sale.id} className={cn("flex flex-col gap-1 px-4 py-2.5", voided && "opacity-50")}>
                    {/* Name on its own full-width line so it uses the whole
                        panel before wrapping; the size never splits (750 / ml). */}
                    <p className={cn("text-sm font-medium", voided && "line-through")}>
                      {itemName}
                      {sizeSuffix && (
                        <span className="ml-1.5 whitespace-nowrap font-normal text-muted-foreground">
                          {sizeSuffix}
                        </span>
                      )}
                    </p>
                    {/* Facts left; total + actions on the right, actions dropped
                        to the bottom (mt-auto) to line up with the last fact. */}
                    <div className="flex items-stretch justify-between gap-3">
                      {/* Labels stay bare here — the entry form carries the
                          "each"/"whole sale" qualifiers, so this list reads as
                          data rather than instruction. */}
                      <EntryFacts>
                        <EntryFact label="Date" value={sale.saleDate} />
                        <EntryFact label="Quantity" value={sale.qty} />
                        {sale.kind === "SALE" && (
                          <EntryFact label="Price" value={formatMoney(sale.unitPrice)} />
                        )}
                        {/* Always shown on a sale, even at 0% — the client
                            reads discount as a fact of every sale, and a row
                            that omits it looks like data went missing. */}
                        {sale.kind === "SALE" && (
                          <EntryFact
                            label="Discount"
                            value={
                              sale.discountPct > 0
                                ? `${sale.discountPct}% (−${formatMoney(
                                    sale.unitPrice * sale.qty * (sale.discountPct / 100),
                                  )})`
                                : "None"
                            }
                          />
                        )}
                        {sale.contentOverride && (
                          <EntryFact label="Content per unit" value={sale.contentOverride} />
                        )}
                        {sale.reason && (
                          <EntryFact label="Reason" value={REASON_LABELS[sale.reason] ?? sale.reason} />
                        )}
                        {sale.correctionOfId && <EntryFact label="Type" value="Correction" />}
                        {voided && sale.voidReason && (
                          <EntryFact label="Cancelled" value={sale.voidReason} />
                        )}
                      </EntryFacts>
                      {/* Right column inside the facts row: total at the top,
                          actions pushed to the bottom (mt-auto) so they line up
                          with the last fact rather than floating by the total. */}
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {sale.kind === "SALE" && !voided && (() => {
                          const gross = sale.unitPrice * sale.qty;
                          const net = gross * (1 - sale.discountPct / 100);
                          const hasDiscount = sale.discountPct > 0;
                          return (
                            <Badge variant="outline" className="tnum flex-col items-end gap-0 py-1 leading-tight">
                              {hasDiscount && (
                                <span className="text-muted-foreground line-through">{formatMoney(gross)}</span>
                              )}
                              <span className={hasDiscount ? "font-medium" : undefined}>{formatMoney(net)}</span>
                            </Badge>
                          );
                        })()}
                        {!voided && (canVoid || canEdit) && (
                          <div className="mt-auto flex gap-1">
                            {canVoid && (
                              <Button variant="destructive" size="xs" onClick={() => setVoiding(sale)}>
                                Cancel
                              </Button>
                            )}
                            {canEdit && (
                              <Button variant="outline" size="xs" onClick={() => setEditing(sale)}>
                                Edit
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {!sales.isPending && totalCount > 0 && (
            <div className="tnum shrink-0 border-t px-4 py-2 text-sm text-muted-foreground">
              {totalCount} {totalCount === 1 ? "entry" : "entries"}
              {kind === "SALE" && ` · ${formatMoney(netTotal)} net`}
              {/* Say so when the list is a window onto a larger set — the count
                  and net above are the true totals, but only 300 rows render. */}
              {capped && ` · showing latest ${rows.length}`}
            </div>
          )}
          </div>
        </TableSurface>
      </Tabs>

      <VoidDialog
        open={voiding !== null}
        onOpenChange={(open) => !open && setVoiding(null)}
        title="Cancel this entry?"
        pending={mutations.voidSale.isPending}
        onConfirm={async (reason) => {
          try {
            await mutations.voidSale.mutateAsync({ id: voiding!.id, reason });
            toast.success("Entry voided — reports updated");
            setVoiding(null);
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : "Could not void");
          }
        }}
      />

      <EditSaleDialog sale={editing} onOpenChange={(open) => !open && setEditing(null)} />
    </div>
  );
}

/**
 * Edit a committed entry. The item/menu is fixed — you're correcting the
 * numbers of an entry, not changing what it was for (to reassign, cancel and
 * re-enter). Saving voids the original and writes a linked replacement, so the
 * audit trail is identical to any other correction; a reason is required, the
 * same way a cancel requires one.
 */
function EditSaleDialog({
  sale,
  onOpenChange,
}: {
  sale: SaleRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const mutations = useSaleMutations();
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [discount, setDiscount] = useState("");
  const [content, setContent] = useState("");
  const [reason, setReason] = useState<string>("SPOILAGE_SPILLAGE");
  const [date, setDate] = useState("");
  const [changeReason, setChangeReason] = useState("");

  // Re-seed every field when a different entry opens the dialog.
  useEffect(() => {
    if (!sale) return;
    setQty(String(sale.qty));
    setPrice(sale.unitPrice ? String(sale.unitPrice) : "");
    setDiscount(sale.discountPct ? String(sale.discountPct) : "");
    setContent(sale.contentOverride ? String(sale.contentOverride) : "");
    setReason(sale.reason ?? "SPOILAGE_SPILLAGE");
    setDate(sale.saleDate);
    setChangeReason("");
  }, [sale]);

  if (!sale) return null;
  const kind = sale.kind;
  const name = sale.locationItem
    ? `${sale.locationItem.itemVariant.item.name} ${variantLabel(sale.locationItem.itemVariant)}`
    : (sale.menuItem?.name ?? "—");
  const isItem = Boolean(sale.locationItem);
  const contentTracked = sale.locationItem?.itemVariant.contentTracked ?? false;

  const submit = async () => {
    const q = Number(qty);
    if (!q || q <= 0) return toast.error("Enter a quantity");
    if (kind === "SALE" && price.trim() === "")
      return toast.error("Enter the unit price");
    if (changeReason.trim().length < 3) return toast.error("Add a reason for the change");
    try {
      await mutations.correct.mutateAsync({
        id: sale.id,
        body: {
          saleDate: date,
          kind,
          locationItemId: sale.locationItem?.id,
          menuItemId: sale.menuItem?.id,
          qty: q,
          unitPrice: kind === "SALE" ? Number(price) || 0 : 0,
          discountPct: kind === "SALE" ? Number(discount) || 0 : 0,
          contentOverride:
            kind === "NON_REVENUE" && isItem && content !== "" ? Number(content) : undefined,
          reason: kind === "NON_REVENUE" ? (reason as (typeof NON_REVENUE_REASONS)[number]) : undefined,
          voidReason: changeReason.trim(),
        },
      });
      toast.success("Entry updated — the original is kept, marked corrected");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the change");
    }
  };

  return (
    <Dialog open={sale !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Entry</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="e-date">Date</Label>
              <Input id="e-date" type="date" className="tnum" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="e-qty">Quantity</Label>
              <QuantityInput id="e-qty" className="tnum" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
          </div>

          {kind === "SALE" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="e-price">Price</Label>
                <QuantityInput id="e-price" className="tnum" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="e-disc">Sale Discount %</Label>
                <QuantityInput id="e-disc" className="tnum" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </div>
            </div>
          )}

          {kind === "NON_REVENUE" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="e-reason">Reason</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger id="e-reason">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NON_REVENUE_GROUPS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {NON_REVENUE_GROUP_LABELS[r]}
                      </SelectItem>
                    ))}
                    <SelectItem value="OTHER">Other / Unspecified</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {isItem && (
                <div className="space-y-2">
                  <Label htmlFor="e-content">Content per Unit</Label>
                  <QuantityInput
                    id="e-content"
                    className="tnum"
                    placeholder={contentTracked ? "Whole units, or e.g. 350" : "Whole units"}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="e-change">Reason for change</Label>
            <Input
              id="e-change"
              placeholder="e.g. Wrong quantity entered"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mutations.correct.isPending}>
            {mutations.correct.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type SaleTarget = { type: "item"; item: LocationItem } | { type: "menu"; menu: MenuSummary };

function QuickEntry({ kind }: { kind: SaleKind }) {
  const mutations = useSaleMutations();
  const [target, setTarget] = useState<SaleTarget | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [discount, setDiscount] = useState("");
  const [content, setContent] = useState("");
  const [reason, setReason] = useState<string>("SPOILAGE_SPILLAGE");
  const comboRef = useRef<HTMLButtonElement>(null);
  const copy = KIND_COPY[kind];

  const item = target?.type === "item" ? target.item : null;

  const pickTarget = (t: SaleTarget) => {
    setTarget(t);
    if (kind === "SALE") {
      setPrice(t.type === "item" ? String(t.item.retail || "") : String(t.menu.current?.srp || ""));
    }
  };

  const save = async () => {
    if (!target) return;
    const q = Number(qty);
    if (!q || q <= 0) return toast.error("Enter a quantity");
    // An empty price would silently record ₱0.00 revenue — block it; an explicitly typed 0 is allowed.
    if (kind === "SALE" && price.trim() === "")
      return toast.error("Enter the unit price — use the Non-revenue tab for comps");
    try {
      await mutations.create.mutateAsync({
        saleDate: date,
        kind,
        locationItemId: target.type === "item" ? target.item.id : undefined,
        menuItemId: target.type === "menu" ? target.menu.id : undefined,
        qty: q,
        unitPrice: kind === "SALE" ? Number(price) || 0 : 0,
        discountPct: kind === "SALE" ? Number(discount) || 0 : 0,
        contentOverride:
          kind === "NON_REVENUE" && target.type === "item" && content !== "" ? Number(content) : undefined,
        reason: kind === "NON_REVENUE" ? (reason as (typeof NON_REVENUE_REASONS)[number]) : undefined,
      });
      toast.success(copy.saved);
      setTarget(null);
      setQty("1");
      setPrice("");
      setDiscount("");
      setContent("");
      comboRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save");
    }
  };

  return (
    // Container, not viewport: this form sits in one half of a two-pane card,
    // so its width is ~429px on a 13" laptop no matter how wide the window is.
    // `lg:` and friends would report "plenty of room" and lay out three columns
    // into 145px each. `@`-breakpoints measure the pane that actually holds it.
    //
    // Mind the scale when picking one: this app ships an 18px root font (client
    // req #1, "larger readable fonts"), and Tailwind's container breakpoints are
    // rem-based — @sm is 24rem, which is 432px here, not 384px. That put it 3px
    // above this very pane and silently kept the form stacked. Prefer a step
    // you've measured against the real pane at the real root size.
    <div className="@container space-y-5">
      <h3 className="font-medium">{copy.title}</h3>

      <div className="grid gap-3 @xs:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-2">
          <Label htmlFor="s-target">Item or Menu</Label>
          <SaleTargetCombobox id="s-target" ref={comboRef} value={target} onSelect={pickTarget} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="s-date">Date</Label>
          <Input id="s-date" type="date" className="tnum" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {/* The two kinds have genuinely different field widths, so they get their
          own tracks rather than being forced through one `grid-cols-3`.
          Quantity is always a short number; what sits beside it is not.
          items-end keeps the three inputs on one baseline even when a label
          wraps to two lines ("Whole Sale Discount %") — otherwise that
          column's field drops below its neighbours. */}
      {kind === "SALE" && (
        <div className="grid items-end gap-3 grid-cols-2 @xs:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <Label htmlFor="s-qty">Quantity</Label>
            <QuantityInput
              id="s-qty"
              className="tnum"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-price">Price</Label>
            <QuantityInput
              id="s-price"
              className="tnum"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </div>
          <div className="space-y-2">
            {/* The qualifier lives here, on the field that sets the value —
                the percentage applies to the line total, not per unit. */}
            <Label htmlFor="s-disc">Sale Discount %</Label>
            <QuantityInput
              id="s-disc"
              className="tnum"
              placeholder="0"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </div>
        </div>
      )}

      {kind !== "SALE" && (
        // Reason carries "Spoilage & Spillages" and Content per Unit carries a
        // worked example, so they only share a row once the pane can actually
        // hold three columns; below that Content takes a full row of its own.
        <div className="grid gap-3 @xs:grid-cols-[7rem_minmax(0,1fr)] @2xl:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <Label htmlFor="s-qty">Quantity</Label>
            <QuantityInput
              id="s-qty"
              className="tnum"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </div>
          {kind === "NON_REVENUE" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="s-reason">Reason</Label>
                {/* The three canonical buckets, each of which drives its own
                    report, plus "Other / Unspecified" — the plain input the
                    client asked for (2026-07-21) when the user doesn't want to
                    classify. Legacy reasons stay readable on historical rows
                    but can no longer be entered. */}
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger id="s-reason">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NON_REVENUE_GROUPS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {NON_REVENUE_GROUP_LABELS[r]}
                      </SelectItem>
                    ))}
                    <SelectItem value="OTHER">Other / Unspecified</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {target?.type !== "menu" && (
                <div className="space-y-2 @xs:col-span-2 @2xl:col-span-1">
                  <Label htmlFor="s-content">Content per Unit</Label>
                  <QuantityInput
                    id="s-content"
                    className="tnum"
                    // Empty means whole units — say so in the field itself rather
                    // than in a paragraph underneath it.
                    placeholder={
                      item?.itemVariant.contentTracked
                        ? `Whole units, or e.g. 350 ${item.itemVariant.unit.name}`
                        : "Whole units"
                    }
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && save()}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={save} disabled={!target || mutations.create.isPending}>
          {mutations.create.isPending ? "Saving…" : copy.button}
        </Button>
      </div>
    </div>
  );
}

const SaleTargetCombobox = forwardRef<
  HTMLButtonElement,
  { value: SaleTarget | null; onSelect: (target: SaleTarget) => void; id?: string }
>(function SaleTargetCombobox({ value, onSelect, id }, ref) {
  const [open, setOpen] = useState(false);
  const items = useLocationItems();
  const menus = useMenus();
  const readyMenus = (menus.data ?? []).filter((m) => m.isActive && m.current);

  const label =
    value?.type === "item"
      ? `${value.item.itemVariant.item.name} ${variantLabel(value.item.itemVariant)}`
      : value?.type === "menu"
        ? value.menu.name
        : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} ref={ref} variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          {label ? (
            <span className="truncate" title={label}>
              {value?.type === "menu" && <Martini className="mr-1.5 inline size-3.5 text-primary" />}
              {label}
            </span>
          ) : (
            <span className="text-muted-foreground">Pick an item or menu…</span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Type to search…" autoFocus />
          <CommandList>
            <CommandEmpty>{items.isPending ? "Loading…" : "Nothing matches."}</CommandEmpty>
            {readyMenus.length > 0 && (
              <CommandGroup heading="Menus">
                {readyMenus.map((menu) => (
                  <CommandItem
                    key={menu.id}
                    value={`menu ${menu.name}`}
                    onSelect={() => {
                      onSelect({ type: "menu", menu });
                      setOpen(false);
                    }}
                  >
                    <Martini className="size-4 text-primary" />
                    <span className="flex-1 truncate">{menu.name}</span>
                    <span className="tnum text-xs text-muted-foreground">v{menu.current!.versionNo}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading="Items">
              {(items.data ?? []).map((li) => (
                <CommandItem
                  key={li.id}
                  value={`item ${li.itemVariant.item.name} ${variantLabel(li.itemVariant)}`}
                  onSelect={() => {
                    onSelect({ type: "item", item: li });
                    setOpen(false);
                  }}
                >
                  <span className="flex-1 truncate">
                    {li.itemVariant.item.name}
                    <span className="ml-1.5 text-muted-foreground">{variantLabel(li.itemVariant)}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{li.itemVariant.item.category.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
