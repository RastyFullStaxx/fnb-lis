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
import { TableSurface, ToolbarField, ToolbarSearch } from "@/components/table-surface";
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
        <Plus className="size-4" /> New Item
      </Button>
    ) : tab === "categories" ? (
      <Button onClick={() => setCatCreateOpen(true)}>
        <Plus className="size-4" /> New Category
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
              <ToolbarField label="Section">
                <TabsList>
                  <TabsTrigger value="items">Items</TabsTrigger>
                  <TabsTrigger value="categories">Categories</TabsTrigger>
                  <TabsTrigger value="units">Units</TabsTrigger>
                </TabsList>
              </ToolbarField>
              {tab === "items" && (
                <>
                  <ToolbarSearch
                    value={search}
                    onChange={setSearch}
                    placeholder="Search items…"
                    label="Search"
                  />
                  <ToolbarField label="Product Type" htmlFor="items-product-type">
                    <Select value={productType} onValueChange={setProductType}>
                      {/* No aria-label: the visible "Product Type" caption is
                          the accessible name now (ToolbarField's htmlFor points
                          at this id). An aria-label would override it, so a
                          screen reader would announce different words than the
                          eye reads. */}
                      <SelectTrigger id="items-product-type" className="w-40 bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>All Types</SelectItem>
                        {(productTypes.data?.productTypes ?? []).map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </ToolbarField>
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
