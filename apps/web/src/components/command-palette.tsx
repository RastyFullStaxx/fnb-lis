import { useEffect, useMemo, useState } from "react";
import { can, type Role } from "@fnb/core";
import { useNavigate } from "react-router";
import { BarChart3, Martini, Package, Search, Truck } from "lucide-react";
import { useLocationItems, useSuppliers } from "@/api/location";
import { useMenus } from "@/api/menus";
import { useMe } from "@/api/auth";
import { displayVariantLabel, variantLabel } from "@/api/types";
import { useItemDisplayUnit } from "@/lib/preferences";
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
  { title: "Asset Breakage", path: "reports/asset-breakage" },
  { title: "Full Audit by Category", path: "reports/legacy-audit" },
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
  // The palette was the one place that handed a STAFF user a link to a screen
  // the sidebar deliberately hides — Menus and Suppliers both live behind
  // permissions they lack. Same gate as the nav, so search can't route someone
  // to a wall.
  const me = useMe();
  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;
  const canSeeMenus = can(role, "menus.write");
  const canSeeSuppliers = can(role, "master.write");

  // Client req 2026-07-31 (docs/per-user-per-item-uom-plan.md): show the
  // resolved display unit here too, same as every other item picker. Only
  // resolves for the (at most 200) items actually rendered below, and only
  // while this component is mounted, i.e. only while the palette is open,
  // same fetch-on-open shape as the rest of this component already has.
  const shownItems = (items.data ?? []).slice(0, 200);
  const shownItemIds = useMemo(() => shownItems.map((li) => li.itemVariant.item.id), [shownItems]);
  const { resolve: resolveDisplay } = useItemDisplayUnit(shownItemIds);

  return (
    <>
      {(items.data ?? []).length > 0 && (
        <CommandGroup heading="Items">
          {shownItems.map((li) => {
            const resolvedLabel = `${li.itemVariant.item.name} ${displayVariantLabel(li.itemVariant, resolveDisplay(li.itemVariant.item.id, li.itemVariant.unit))}`;
            // The Stock page's ?q= only ever matches item.name server-side
            // (see location-items.ts), so which unit text rides along in the
            // query string here has no effect on what that page finds —
            // safe to use the resolved label for both the shown text and
            // the deep link.
            return (
              <CommandItem
                key={li.id}
                value={`item ${resolvedLabel} ${variantLabel(li.itemVariant)}`}
                onSelect={() => onGo(`stock?q=${encodeURIComponent(resolvedLabel)}`)}
              >
                <Package className="size-4" />
                {resolvedLabel}
              </CommandItem>
            );
          })}
        </CommandGroup>
      )}
      {canSeeMenus && (menus.data ?? []).length > 0 && (
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
      {canSeeSuppliers && (suppliers.data ?? []).length > 0 && (
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
