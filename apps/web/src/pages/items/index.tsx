import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { ItemsTab } from "./items-tab";
import { CategoriesTab } from "./categories-tab";
import { UnitsTab } from "./units-tab";

export function ItemsPage() {
  return (
    <div>
      <PageHeader
        title="Items"
        description="The master catalog shared by every client — items, categories, and units of measure."
      />
      <Tabs defaultValue="items">
        <TabsList>
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="units">Units</TabsTrigger>
        </TabsList>
        <TabsContent value="items" className="mt-4">
          <ItemsTab />
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
