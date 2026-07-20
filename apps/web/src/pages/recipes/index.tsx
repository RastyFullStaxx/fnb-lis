import { useState } from "react";
import { Martini, Plus } from "lucide-react";
import { useMenus, type MenuSummary } from "@/api/menus";
import { cn, formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, ToolbarSearch } from "@/components/table-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { RecipeBuilderSheet } from "./builder";
import { MenuDetailSheet } from "./detail";

export function RecipesPage() {
  const me = useMe();
  const menus = useMenus();
  const [building, setBuilding] = useState<MenuSummary | "new" | null>(null);
  const [viewing, setViewing] = useState<MenuSummary | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [search, setSearch] = useState("");

  const role = (me.data?.user.role ?? "READONLY") as Role;
  const canWrite = can(role, "menus.write");

  const q = search.trim().toLowerCase();
  const filtered = (menus.data ?? []).filter((m) => !q || m.name.toLowerCase().includes(q));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Recipes"
        actions={
          canWrite && (
            <>
              <Button variant="outline" onClick={() => setCopyOpen(true)}>
                <Copy className="size-4" /> Copy from location
              </Button>
              <Button onClick={() => setBuilding("new")}>
                <Plus className="size-4" /> New menu
              </Button>
            </>
          )
        }
      />

      <TableSurface filters={<ToolbarSearch value={search} onChange={setSearch} placeholder="Search menus…" />}>
        {menus.isPending ? (
          <TableLoading />
        ) : filtered.length === 0 ? (
          <TableEmpty
            icon={Martini}
            title={(menus.data ?? []).length === 0 ? "No menus yet" : "No menus match your search"}
            description={
              (menus.data ?? []).length === 0
                ? "Build your first cocktail or dish — its recipe links menu sales to ingredient stock."
                : "Try a different name."
            }
            action={
              (menus.data ?? []).length === 0 && (
                <Button onClick={() => setBuilding("new")}>
                  <Plus className="size-4" /> New menu
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Menu</TableHead>
                <TableHead className="text-right">Version</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">SRP</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Sales</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((menu) => {
                const cur = menu.current;
                const margin = cur && cur.srp > 0 ? ((cur.srp - cur.costAtPublish) / cur.srp) * 100 : null;
                return (
                  <TableRow key={menu.id}>
                    <TableCell>
                      <span className="font-medium">{menu.name}</span>
                      {!cur && (
                        <Badge variant="outline" className="ml-2">
                          no recipe yet
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="tnum text-right">{cur ? `v${cur.versionNo}` : "—"}</TableCell>
                    <TableCell className="tnum text-right">
                      {cur ? formatMoney(cur.costAtPublish) : "—"}
                    </TableCell>
                    <TableCell className="tnum text-right">{cur ? formatMoney(cur.srp) : "—"}</TableCell>
                    <TableCell
                      className={cn("tnum text-right", margin !== null && margin < 0 && "font-medium text-destructive")}
                    >
                      {margin === null ? "—" : `${margin.toFixed(0)}%`}
                    </TableCell>
                    <TableCell className="tnum text-right">{menu.salesCount}</TableCell>
                    <TableCell className="text-right">
                      {cur && (
                        <Button variant="ghost" size="sm" onClick={() => setViewing(menu)}>
                          History
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setBuilding(menu)}>
                        {cur ? "New version" : "Build recipe"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableSurface>

      <RecipeBuilderSheet
        open={building !== null}
        menu={building === "new" ? null : building}
        onOpenChange={(open) => !open && setBuilding(null)}
      />
      <MenuDetailSheet menu={viewing} onOpenChange={(open) => !open && setViewing(null)} />
      <CopyMenusDialog open={copyOpen} onOpenChange={setCopyOpen} />
    </div>
  );
}

function CopyMenusDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const me = useMe();
  const { locationId } = useParams();
  const [sourceId, setSourceId] = useState("");
  const copyFrom = useCopyMenusFromLocation();

  const options = (me.data?.clients ?? []).flatMap((client) =>
    client.locations
      .filter((l) => l.id !== locationId)
      .map((l) => ({ id: l.id, label: `${client.name} · ${l.name}` })),
  );

  const run = async () => {
    if (!sourceId) return;
    try {
      const result = await copyFrom.mutateAsync(sourceId);
      const notes: string[] = [];
      if (result.skippedExisting > 0) notes.push(`${result.skippedExisting} already existed here`);
      if (result.skippedNoRecipe > 0) notes.push(`${result.skippedNoRecipe} had no published recipe`);
      if (result.skippedMissingIngredients > 0) {
        notes.push(
          `${result.skippedMissingIngredients} skipped — missing ingredient(s) in this location's catalog ` +
            `(copy the catalog on Local Database first, then retry)`,
        );
      }
      toast.success(
        `Copied ${result.copied} recipe(s)` + (notes.length > 0 ? ` — ${notes.join("; ")}` : ""),
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Copy failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copy recipes from another location</DialogTitle>
          <DialogDescription>
            Brings that location's published recipes into this one, remapped onto this location's own catalog
            prices. Menus already here, or that use an ingredient this location doesn't stock yet, are left out —
            copy the catalog first (on Local Database) to bring across as many recipes as possible.
          </DialogDescription>
        </DialogHeader>
        <Select value={sourceId} onValueChange={setSourceId}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a source location" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button onClick={run} disabled={!sourceId || copyFrom.isPending}>
            {copyFrom.isPending ? "Copying…" : "Copy recipes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
