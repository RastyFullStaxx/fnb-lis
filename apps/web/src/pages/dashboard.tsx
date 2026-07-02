import { Link, useParams } from "react-router";
import { ClipboardList, FileInput, Receipt, ShoppingCart } from "lucide-react";
import { useMe } from "@/api/auth";
import { can, type Role } from "@fnb/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const QUICK_ACTIONS = [
  { title: "Start a count", path: "counts", icon: ClipboardList, permission: "entries.create" as const },
  { title: "Receive purchase", path: "purchases", icon: ShoppingCart, permission: "entries.create" as const },
  { title: "Record sale", path: "sales", icon: Receipt, permission: "entries.create" as const },
  { title: "Import a file", path: "imports", icon: FileInput, permission: "imports.upload" as const },
];

export function DashboardPage() {
  const me = useMe();
  const { locationId } = useParams();
  const role = (me.data?.user.role ?? "READONLY") as Role;
  const firstName = me.data?.user.firstName ?? "";

  const actions = QUICK_ACTIONS.filter((a) => can(role, a.permission));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          {greeting()}, {firstName}
        </h2>
        <p className="text-sm text-muted-foreground">
          Here's where this location stands. Period status, variance leaders, and attention items
          appear as data comes in.
        </p>
      </div>

      {actions.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {actions.map((action) => (
            <Card key={action.path} className="transition-colors hover:border-primary/40">
              <CardHeader className="pb-2">
                <action.icon className="size-5 text-primary" />
              </CardHeader>
              <CardContent className="space-y-3">
                <CardTitle className="text-base">{action.title}</CardTitle>
                <Button asChild variant="secondary" size="sm">
                  <Link to={`/l/${locationId}/${action.path}`}>Open</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit period</CardTitle>
          <CardDescription>
            No committed counts yet. The dashboard fills in once the first count is committed —
            start with a beginning count, record the period's activity, then count again to
            generate your first Full Audit report.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
