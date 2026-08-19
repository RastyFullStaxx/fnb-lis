import { forwardRef, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useLocationItems } from "@/api/location";
import { displayVariantLabel, variantLabel, type LocationItem } from "@/api/types";
import { useItemDisplayUnit } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Searchable picker over this location's catalog — the heart of every rapid-entry form. */
export const ItemCombobox = forwardRef<
  HTMLButtonElement,
  {
    value: LocationItem | null;
    onSelect: (item: LocationItem) => void;
    placeholder?: string;
    autoFocus?: boolean;
    /** Forwarded to the trigger button so a <Label htmlFor> can name it. */
    id?: string;
  }
>(function ItemCombobox({ value, onSelect, placeholder = "Pick an item…", autoFocus, id }, ref) {
  const [open, setOpen] = useState(false);
  const items = useLocationItems();

  // Client req 2026-07-31 (docs/per-user-per-item-uom-plan.md): the size
  // shown next to each item here should honor the same resolved display
  // unit as the rest of the app (staff override, then admin default, then
  // general preference, then the item's own unit), not always the item's
  // raw stored unit. This is the shared picker behind Sales, Purchases,
  // Transfers, Imports, and Counts, so fixing it here covers all of them at
  // once rather than duplicating the resolve call in each page.
  const allItemIds = useMemo(() => (items.data ?? []).map((li) => li.itemVariant.item.id), [items.data]);
  const { resolve: resolveDisplay } = useItemDisplayUnit(allItemIds);

  const searchable = useMemo(
    () =>
      (items.data ?? []).map((li) => {
        const resolvedLabel = displayVariantLabel(li.itemVariant, resolveDisplay(li.itemVariant.item.id, li.itemVariant.unit));
        // Search value includes both the resolved and the item's own raw
        // unit text, so a person searching "700" or "0.7" both find this
        // row regardless of which unit is currently on screen. Shown text
        // (below) uses only the resolved label.
        const rawLabel = variantLabel(li.itemVariant);
        return {
          li,
          resolvedLabel,
          searchValue:
            resolvedLabel === rawLabel
              ? `${li.itemVariant.item.name} ${rawLabel}`
              : `${li.itemVariant.item.name} ${resolvedLabel} ${rawLabel}`,
        };
      }),
    [items.data, resolveDisplay],
  );

  const selectedLabel = value ? displayVariantLabel(value.itemVariant, resolveDisplay(value.itemVariant.item.id, value.itemVariant.unit)) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          ref={ref}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          autoFocus={autoFocus}
          className="w-full justify-between font-normal"
        >
          {value ? (
            <span className="truncate" title={`${value.itemVariant.item.name} ${selectedLabel}`}>
              {value.itemVariant.item.name}
              <span className="ml-1.5 text-muted-foreground">{selectedLabel}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Type to search…" autoFocus />
          <CommandList>
            <CommandEmpty>{items.isPending ? "Loading…" : "No matching item in this catalog."}</CommandEmpty>
            <CommandGroup>
              {searchable.map(({ li, resolvedLabel, searchValue }) => (
                <CommandItem
                  key={li.id}
                  value={searchValue}
                  onSelect={() => {
                    onSelect(li);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", value?.id === li.id ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">
                    {li.itemVariant.item.name}
                    <span className="ml-1.5 text-muted-foreground">{resolvedLabel}</span>
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
