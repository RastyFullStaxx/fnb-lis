import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { BarChart3, Martini, Package, Search, Truck } from "lucide-react";
import { useLocationItems, useSuppliers } from "@/api/location";
import { useMenus } from "@/api/menus";
import { variantLabel } from "@/api/types";
import type { NavItem } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface Current {
  id: string;
}

const REPORTS = [
  { title: "Full Audit", path: "reports/full-audit" },
  { title: "Sales Report", path: "reports/sales" },
  { title: "Purchases Report", path: "reports/purchases" },
  { title: "Non-Revenue Report", path: "reports/non-revenue" },
  { title: "Inventory on Hand", path: "reports/on-hand" },
  { title: "Par Level", path: "reports/par-level" },
  { title: "Non-Moving Items", path: "reports/non-moving" },
];

// Computed once — the handler accepts metaKey too, so macOS shows its own chord.
const IS_MAC = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

export function CommandPalette({ current, navItems }: { current: Current; navItems: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    navigate(`/l/${current.id}/${path}`);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Search className="size-3.5" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="pointer-events-none rounded border bg-muted px-1.5 font-mono text-[10px]">
          {IS_MAC ? "⌘K" : "Ctrl K"}
        </kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search items, suppliers, menus, or jump to a page…" />
        <CommandList>
          <CommandEmpty>Nothing found.</CommandEmpty>
          <CommandGroup heading="Navigate">
            {navItems.map((item) => (
              <CommandItem key={item.path} value={`nav ${item.title}`} onSelect={() => go(item.path)}>
                <item.icon className="size-4" />
                {item.title}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Reports">
            {REPORTS.map((r) => (
              <CommandItem key={r.path} value={`report ${r.title}`} onSelect={() => go(r.path)}>
                <BarChart3 className="size-4" />
                {r.title}
              </CommandItem>
            ))}
          </CommandGroup>
          {open && <EntityResults onGo={go} />}
        </CommandList>
      </CommandDialog>
    </>
  );
}

/** Only mounts (and thus fetches) while the palette is open. */
function EntityResults({ onGo }: { onGo: (path: string) => void }) {
  const items = useLocationItems();
  const suppliers = useSuppliers();
  const menus = useMenus();

  return (
    <>
      {(items.data ?? []).length > 0 && (
        <CommandGroup heading="Items">
          {items.data!.slice(0, 200).map((li) => {
            const label = `${li.itemVariant.item.name} ${variantLabel(li.itemVariant)}`;
            return (
              <CommandItem
                key={li.id}
                value={`item ${label}`}
                onSelect={() => onGo(`stock?q=${encodeURIComponent(label)}`)}
              >
                <Package className="size-4" />
                {label}
              </CommandItem>
            );
          })}
        </CommandGroup>
      )}
      {(menus.data ?? []).length > 0 && (
        <CommandGroup heading="Menus">
          {menus.data!.map((m) => (
            <CommandItem
              key={m.id}
              value={`menu ${m.name}`}
              onSelect={() => onGo(`recipes?q=${encodeURIComponent(m.name)}`)}
            >
              <Martini className="size-4" />
              {m.name}
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {(suppliers.data ?? []).length > 0 && (
        <CommandGroup heading="Suppliers">
          {suppliers.data!.map((s) => (
            <CommandItem
              key={s.id}
              value={`supplier ${s.name}`}
              onSelect={() => onGo(`suppliers?q=${encodeURIComponent(s.name)}`)}
            >
              <Truck className="size-4" />
              {s.name}
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </>
  );
}
