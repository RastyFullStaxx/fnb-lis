import { useMenu, type MenuSummary } from "@/api/menus";
import { variantLabel } from "@/api/types";
import { formatMoney } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/** Version history — every published recipe stays readable forever. */
export function MenuDetailSheet({
  menu,
  onOpenChange,
}: {
  menu: MenuSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = useMenu(menu?.id ?? null);

  return (
    <Sheet open={menu !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{menu?.name}</SheetTitle>
          <SheetDescription>
            Version history. Sales are tied to the version active when they were recorded, so old
            reports never change when the recipe does.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-6">
          {detail.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            detail.data?.versions.map((version, i) => (
              <div key={version.id}>
                {i > 0 && <Separator className="mb-6" />}
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant={i === 0 ? "default" : "secondary"}>
                    v{version.versionNo}
                    {i === 0 && " · current"}
                  </Badge>
                  <span className="tnum text-sm text-muted-foreground">
                    SRP {formatMoney(version.srp)} · cost {formatMoney(version.costAtPublish)}
                  </span>
                  <span className="tnum ml-auto text-xs text-muted-foreground">
                    {new Date(version.publishedAt).toLocaleDateString()}
                  </span>
                </div>
                {version.note && <p className="mb-2 text-sm text-muted-foreground">{version.note}</p>}
                <div className="divide-y rounded-lg border">
                  {version.lines.map((line) => {
                    const variant = line.locationItem.itemVariant;
                    return (
                      <div key={line.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span>
                          {variant.item.name}
                          <span className="ml-1.5 text-muted-foreground">{variantLabel(variant)}</span>
                        </span>
                        <span className="tnum">
                          {line.servingQty} {variant.contentTracked ? variant.unit.name : "unit(s)"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
