import { useState } from "react";
import { Plus } from "lucide-react";
import { useProductTypes } from "@/api/master";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { TableSurface, ToolbarSearch } from "@/components/table-surface";
import { ItemsTab } from "./items-tab";
import { CategoriesTab } from "./categories-tab";
import { UnitsTab } from "./units-tab";

const ALL = "__all__";

export function ItemsPage() {
  const [tab, setTab] = useState("items");
  const [search, setSearch] = useState("");
  const [productType, setProductType] = useState(ALL);
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [catCreateOpen, setCatCreateOpen] = useState(false);
  const [unitCreateOpen, setUnitCreateOpen] = useState(false);
  const productTypes = useProductTypes();

  const action =
    tab === "items" ? (
      <Button onClick={() => setItemFormOpen(true)}>
        <Plus className="size-4" /> New item
      </Button>
    ) : tab === "categories" ? (
      <Button onClick={() => setCatCreateOpen(true)}>
        <Plus className="size-4" /> New category
      </Button>
    ) : (
      <Button onClick={() => setUnitCreateOpen(true)}>
        <Plus className="size-4" /> New unit
      </Button>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Main Database" actions={action} />
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TableSurface
          filters={
            <>
              <TabsList>
                <TabsTrigger value="items">Items</TabsTrigger>
                <TabsTrigger value="categories">Categories</TabsTrigger>
                <TabsTrigger value="units">Units</TabsTrigger>
              </TabsList>
              {tab === "items" && (
                <>
                  <ToolbarSearch value={search} onChange={setSearch} placeholder="Search items…" />
                  <Select value={productType} onValueChange={setProductType}>
                    <SelectTrigger className="w-40 bg-background" aria-label="Filter by product type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All types</SelectItem>
                      {(productTypes.data?.productTypes ?? []).map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </>
          }
        >
          <TabsContent value="items" className="m-0">
            <ItemsTab search={search} productType={productType} formOpen={itemFormOpen} setFormOpen={setItemFormOpen} />
          </TabsContent>
          <TabsContent value="categories" className="m-0">
            <CategoriesTab createOpen={catCreateOpen} setCreateOpen={setCatCreateOpen} />
          </TabsContent>
          <TabsContent value="units" className="m-0">
            <UnitsTab createOpen={unitCreateOpen} setCreateOpen={setUnitCreateOpen} />
          </TabsContent>
        </TableSurface>
      </Tabs>
    </div>
  );
}
