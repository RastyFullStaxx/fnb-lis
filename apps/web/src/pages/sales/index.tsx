import { forwardRef, useRef, useState } from "react";
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
import { TableSurface } from "@/components/table-surface";
import { VoidDialog } from "@/components/void-dialog";
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

/** One labelled fact in a Recent Entries row: "Quantity: 3".
 *
 *  Values wrap at word boundaries and never mid-token: `break-words` here let
 *  "−₱728.00" shatter one character per line once the column got narrow, which
 *  is worse than either truncating or wrapping. Amounts stay whole; a long
 *  value simply continues on the next line. */
function EntryFact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0">{label}:</dt>
      <dd className="tnum min-w-0 text-foreground/80">{value}</dd>
    </div>
  );
}

/** Labels for every stored reason — canonical buckets plus legacy codes on
    historical rows (the entry select offers only the canonical three). */
const REASON_LABELS: Record<string, string> = {
  SPOILAGE_SPILLAGE: "Spoilage & Spillages",
  TRIMMING: "Trimming",
  MARKETING_OTH: "Marketing & OTH (On the House)",
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

  const role = (me.data?.user.role ?? "READONLY") as Role;
  const canVoid = can(role, "entries.void");

  const activeEntries = (sales.data ?? []).filter((s) => s.status !== "VOID");
  const netTotal = activeEntries.reduce(
    (sum, s) => sum + s.unitPrice * s.qty * (1 - s.discountPct / 100),
    0,
  );

  return (
    <div>
      <PageHeader title="Sales" />

      <Tabs value={kind} onValueChange={(v) => setKind(v as SaleKind)}>
        <TableSurface
          filters={
            <TabsList>
              <TabsTrigger value="SALE">Sales</TabsTrigger>
              <TabsTrigger value="NON_REVENUE">Non-revenue</TabsTrigger>
              <TabsTrigger value="PRODUCTION">Production</TabsTrigger>
            </TabsList>
          }
          bodyClassName="grid gap-6 p-4 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]"
        >
          <QuickEntry kind={kind} />

          <div className="lg:border-l lg:pl-6">
            <div className="mb-2 text-sm font-medium">Recent Entries</div>
            <div aria-live="polite" className="max-h-[28rem] divide-y overflow-y-auto">
            {sales.isPending ? (
              <div className="divide-y">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="space-y-1.5 px-4 py-2.5">
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-3 w-2/5" />
                  </div>
                ))}
              </div>
            ) : (sales.data ?? []).length === 0 ? (
              <div className="p-6 text-center">
                <Receipt className="mx-auto mb-2 size-6 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Nothing recorded yet for this tab.</p>
              </div>
            ) : (
              sales.data!.map((sale) => {
                const voided = sale.status === "VOID";
                const name = sale.locationItem
                  ? `${sale.locationItem.itemVariant.item.name} ${variantLabel(sale.locationItem.itemVariant)}`
                  : (sale.menuItem?.name ?? "—");
                return (
                  <div key={sale.id} className={cn("flex items-start gap-3 px-4 py-2.5", voided && "opacity-50")}>
                    <div className="min-w-0 flex-1">
                      {/* Wraps rather than truncates — the row is already
                          multi-line, so a second line is cheaper than hiding
                          which item the entry is for. */}
                      <p className={cn("text-sm font-medium", voided && "line-through")}>{name}</p>
                      {/* Labelled rows — an entry's numbers are read one at a
                          time (which price? what discount?), so each fact gets
                          its own line instead of a run-on dot-separated string. */}
                      {/* Labels stay bare here — the entry form carries the
                          "each"/"whole sale" qualifiers, so this list reads as
                          data rather than instruction. */}
                      <dl className="mt-0.5 space-y-px text-xs text-muted-foreground">
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
                      </dl>
                    </div>
                    {/* Total and action share one shrink-0 column. The total
                        stacks its struck gross above the net instead of sitting
                        beside it — side by side it was ~140px wide and starved
                        the fact list, which then broke mid-number. */}
                    <div className="flex shrink-0 items-center gap-2">
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
                      {canVoid && !voided && (
                        <Button variant="destructive" size="xs" onClick={() => setVoiding(sale)}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {!sales.isPending && activeEntries.length > 0 && (
            <div className="tnum border-t px-4 py-2 text-sm text-muted-foreground">
              {activeEntries.length} {activeEntries.length === 1 ? "entry" : "entries"}
              {kind === "SALE" && ` · ${formatMoney(netTotal)} net`}
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
    </div>
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
                {/* Client req (2026-07-20): exactly three encoding options —
                    each drives its own report; legacy reasons remain readable
                    on historical rows but can no longer be entered. */}
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
