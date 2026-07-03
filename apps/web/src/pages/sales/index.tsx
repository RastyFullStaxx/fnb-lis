import { forwardRef, useRef, useState } from "react";
import { ChevronsUpDown, Martini, Receipt } from "lucide-react";
import { toast } from "sonner";
import { can, NON_REVENUE_REASONS, type Role, type SaleKind } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useLocationItems } from "@/api/location";
import { useMenus, type MenuSummary } from "@/api/menus";
import { useSaleMutations, useSales } from "@/api/ops";
import { variantLabel, type LocationItem, type SaleRecord } from "@/api/types";
import { ApiError } from "@/api/http";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
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

const KIND_COPY: Record<SaleKind, { title: string; hint: string; button: string }> = {
  SALE: {
    title: "Record a sale",
    hint: "Revenue sales — price prefills from the item's retail.",
    button: "Save sale",
  },
  NON_REVENUE: {
    title: "Record non-revenue use",
    hint: "Comps, spillage, staff use… consumed but not sold. For a partial pour, enter the content amount per unit.",
    button: "Save non-revenue",
  },
  PRODUCTION: {
    title: "Record production use",
    hint: "Ingredients consumed by prep/production — counted as usage, no revenue.",
    button: "Save production",
  },
};

const REASON_LABELS: Record<string, string> = {
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

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Sales"
        description="What left the shelves — sales, non-revenue use, and production. Every entry commits immediately; fixes are void + re-entry."
      />

      <Tabs value={kind} onValueChange={(v) => setKind(v as SaleKind)}>
        <TabsList>
          <TabsTrigger value="SALE">Sales</TabsTrigger>
          <TabsTrigger value="NON_REVENUE">Non-revenue</TabsTrigger>
          <TabsTrigger value="PRODUCTION">Production</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <QuickEntry kind={kind} />

        <div className="rounded-lg border">
          <div className="border-b bg-muted px-4 py-2 text-sm font-medium">Recent entries</div>
          <div className="max-h-[30rem] divide-y overflow-y-auto">
            {sales.isPending ? (
              <Skeleton className="m-4 h-24" />
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
                  <div key={sale.id} className={cn("flex items-center gap-3 px-4 py-2.5", voided && "opacity-50")}>
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-sm font-medium", voided && "line-through")}>{name}</p>
                      <p className="tnum text-xs text-muted-foreground">
                        {sale.saleDate} · ×{sale.qty}
                        {sale.kind === "SALE" && ` @ ${formatMoney(sale.unitPrice)}`}
                        {sale.discountPct > 0 && ` · ${sale.discountPct}% off`}
                        {sale.contentOverride && ` · ${sale.contentOverride}/unit content`}
                        {sale.reason && ` · ${REASON_LABELS[sale.reason] ?? sale.reason}`}
                        {sale.correctionOfId && " · correction"}
                        {voided && sale.voidReason && ` · void: ${sale.voidReason}`}
                      </p>
                    </div>
                    {sale.kind === "SALE" && !voided && (
                      <Badge variant="outline" className="tnum shrink-0">
                        {formatMoney(sale.unitPrice * sale.qty)}
                      </Badge>
                    )}
                    {canVoid && !voided && (
                      <Button variant="ghost" size="sm" onClick={() => setVoiding(sale)}>
                        Void
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <VoidDialog
        open={voiding !== null}
        onOpenChange={(open) => !open && setVoiding(null)}
        title="Void this entry?"
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
  const [reason, setReason] = useState<string>("OTHER");
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
      toast.success("Saved");
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
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="font-medium">{copy.title}</h3>
        <p className="text-sm text-muted-foreground">{copy.hint}</p>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div className="space-y-2">
          <Label>Item or menu</Label>
          <SaleTargetCombobox ref={comboRef} value={target} onSelect={pickTarget} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="s-date">Date</Label>
          <Input id="s-date" type="date" className="tnum" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-2">
          <Label htmlFor="s-qty">Quantity</Label>
          <Input
            id="s-qty"
            type="number"
            step="any"
            min="0"
            className="tnum"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </div>
        {kind === "SALE" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="s-price">Price</Label>
              <Input
                id="s-price"
                type="number"
                step="any"
                min="0"
                className="tnum"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-disc">Discount %</Label>
              <Input
                id="s-disc"
                type="number"
                step="any"
                min="0"
                max="100"
                className="tnum"
                placeholder="0"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
            </div>
          </>
        )}
        {kind === "NON_REVENUE" && (
          <>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NON_REVENUE_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {REASON_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {target?.type !== "menu" && (
              <div className="space-y-2">
                <Label htmlFor="s-content">Content per unit</Label>
                <Input
                  id="s-content"
                  type="number"
                  step="any"
                  min="0"
                  className="tnum"
                  placeholder={item?.itemVariant.contentTracked ? `e.g. 350 ${item.itemVariant.unit.name}` : "whole units"}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && save()}
                />
              </div>
            )}
          </>
        )}
      </div>

      {kind === "NON_REVENUE" && item?.itemVariant.contentTracked && (
        <p className="text-xs text-muted-foreground">
          Leave "content per unit" empty when whole {variantLabel(item.itemVariant)} units were used; fill it
          for partial pours — e.g. 350 means each unit used 350 of {variantLabel(item.itemVariant)}.
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={save} disabled={!item || mutations.create.isPending}>
          {mutations.create.isPending ? "Saving…" : copy.button}
        </Button>
      </div>
    </div>
  );
}

const SaleTargetCombobox = forwardRef<
  HTMLButtonElement,
  { value: SaleTarget | null; onSelect: (target: SaleTarget) => void }
>(function SaleTargetCombobox({ value, onSelect }, ref) {
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
        <Button ref={ref} variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          {label ? (
            <span className="truncate">
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
