import { useState } from "react";
import { Martini, Plus } from "lucide-react";
import { useMenus, type MenuSummary } from "@/api/menus";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
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
import { Skeleton } from "@/components/ui/skeleton";
import { RecipeBuilderSheet } from "./builder";
import { MenuDetailSheet } from "./detail";

export function RecipesPage() {
  const menus = useMenus();
  const [building, setBuilding] = useState<MenuSummary | "new" | null>(null);
  const [viewing, setViewing] = useState<MenuSummary | null>(null);

  return (
    <div>
      <PageHeader
        title="Recipes"
        description="Menus expand into ingredient consumption when sold. Publishing changes creates a new version — past sales keep the recipe they were sold under."
        actions={
          <Button onClick={() => setBuilding("new")}>
            <Plus className="size-4" /> New menu
          </Button>
        }
      />

      {menus.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (menus.data ?? []).length === 0 ? (
        <EmptyState
          icon={Martini}
          title="No menus yet"
          description="Build your first cocktail or dish — its recipe links menu sales to ingredient stock."
          action={
            <Button onClick={() => setBuilding("new")}>
              <Plus className="size-4" /> New menu
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border">
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
              {menus.data!.map((menu) => {
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
                    <TableCell className="tnum text-right">
                      {margin === null ? "—" : `${margin.toFixed(0)}%`}
                    </TableCell>
                    <TableCell className="tnum text-right">{menu.salesCount}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setViewing(menu)}>
                        History
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setBuilding(menu)}>
                        {cur ? "New version" : "Build recipe"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <RecipeBuilderSheet
        open={building !== null}
        menu={building === "new" ? null : building}
        onOpenChange={(open) => !open && setBuilding(null)}
      />
      <MenuDetailSheet menu={viewing} onOpenChange={(open) => !open && setViewing(null)} />
    </div>
  );
}
