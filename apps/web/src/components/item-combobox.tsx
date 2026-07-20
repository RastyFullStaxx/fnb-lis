import { forwardRef, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useLocationItems } from "@/api/location";
import { variantLabel, type LocationItem } from "@/api/types";
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

  const searchable = useMemo(
    () =>
      (items.data ?? []).map((li) => ({
        li,
        label: `${li.itemVariant.item.name} ${variantLabel(li.itemVariant)}`,
      })),
    [items.data],
  );

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
            <span className="truncate" title={`${value.itemVariant.item.name} ${variantLabel(value.itemVariant)}`}>
              {value.itemVariant.item.name}
              <span className="ml-1.5 text-muted-foreground">{variantLabel(value.itemVariant)}</span>
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
              {searchable.map(({ li, label }) => (
                <CommandItem
                  key={li.id}
                  value={label}
                  onSelect={() => {
                    onSelect(li);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", value?.id === li.id ? "opacity-100" : "opacity-0")} />
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
