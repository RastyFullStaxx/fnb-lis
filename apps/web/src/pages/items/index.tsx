import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { useProductTypes } from "@/api/master";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { ItemsTab } from "./items-tab";
import { CategoriesTab } from "./categories-tab";
import { UnitsTab } from "./units-tab";

const ALL = "__all__";

export function ItemsPage() {
  const [tab, setTab] = useState("items");
  const [search, setSearch] = useState("");
  const [productType, setProductType] = useState(ALL);
  const [formOpen, setFormOpen] = useState(false);
  const productTypes = useProductTypes();

  return (
    <div>
      <PageHeader
        title="Items"
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center gap-2">
          <TabsList>
            <TabsTrigger value="items">Items</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="units">Units</TabsTrigger>
          </TabsList>
          {tab === "items" && (
            <>
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search items…"
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={productType} onValueChange={setProductType}>
                <SelectTrigger className="w-40">
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
              <Button className="ml-auto" onClick={() => setFormOpen(true)}>
                <Plus className="size-4" /> New item
              </Button>
            </>
          )}
        </div>
        <TabsContent value="items" className="mt-4">
          <ItemsTab search={search} productType={productType} formOpen={formOpen} setFormOpen={setFormOpen} />
        </TabsContent>
        <TabsContent value="categories" className="mt-4">
          <CategoriesTab />
        </TabsContent>
        <TabsContent value="units" className="mt-4">
          <UnitsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
