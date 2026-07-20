import { useState } from "react";
import { Martini, Plus } from "lucide-react";
import { useMenus, type MenuSummary } from "@/api/menus";
import { cn, formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, ToolbarSearch } from "@/components/table-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const menus = useMenus();
  const [building, setBuilding] = useState<MenuSummary | "new" | null>(null);
  const [viewing, setViewing] = useState<MenuSummary | null>(null);
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const filtered = (menus.data ?? []).filter((m) => !q || m.name.toLowerCase().includes(q));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Recipes"
        actions={
          <Button onClick={() => setBuilding("new")}>
            <Plus className="size-4" /> New menu
          </Button>
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
    </div>
  );
}
