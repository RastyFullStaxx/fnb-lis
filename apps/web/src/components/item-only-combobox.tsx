import { forwardRef, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useItems } from "@/api/master";
import type { Item } from "@/api/types";
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

/**
 * Searchable picker over the catalog's Items (not variants/LocationItems).
 * The per-item display-unit tables key on item + client / user + item, so
 * this picks a bare Item — see ItemCombobox for the variant-level equivalent
 * used by count-entry forms.
 */
export const ItemOnlyCombobox = forwardRef<
  HTMLButtonElement,
  {
    value: Item | null;
    onSelect: (item: Item) => void;
    placeholder?: string;
    /** Items already in the list below — excluded so the same item can't be added twice. */
    exclude?: string[];
    id?: string;
  }
>(function ItemOnlyCombobox({ value, onSelect, placeholder = "Pick an item…", exclude = [], id }, ref) {
  const [open, setOpen] = useState(false);
  const items = useItems({});

  const excludeSet = useMemo(() => new Set(exclude), [exclude]);
  const selectable = useMemo(
    () => (items.data ?? []).filter((i) => !excludeSet.has(i.id)),
    [items.data, excludeSet],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          ref={ref}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal sm:w-72"
        >
          {value ? (
            <span className="truncate">{value.name}</span>
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
            <CommandEmpty>{items.isPending ? "Loading…" : "No matching item."}</CommandEmpty>
            <CommandGroup>
              {selectable.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.name}
                  onSelect={() => {
                    onSelect(item);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", value?.id === item.id ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{item.name}</span>
                  <span className="text-xs text-muted-foreground">{item.category.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
