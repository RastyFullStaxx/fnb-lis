import { Link } from "react-router";
import { Bell, Check } from "lucide-react";
import type { Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useDashboard } from "@/api/dashboard";
import { attentionCount, attentionItems, ATTENTION_GROUPS } from "@/lib/attention";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The topbar bell: everything waiting on someone at this location, chunked by
 * kind, reachable from any page (the Dashboard's "Needs Attention" panel shows
 * the same list, but only while you are on the Dashboard).
 *
 * Deliberately NOT an inbox — no read/unread, no dismiss. Each row is a live
 * state derived from the data (see lib/attention.ts); it disappears when the
 * work is actually done, so the badge can never lie or need clearing.
 */
export function NotificationMenu({ locationId }: { locationId: string }) {
  const me = useMe();
  const dashboard = useDashboard();
  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;
  const items = dashboard.data ? attentionItems(dashboard.data, role) : [];
  const total = attentionCount(items);
  const to = (path: string) => `/l/${locationId}/${path}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="relative gap-2 text-muted-foreground"
          aria-label={total > 0 ? `${total} items need attention` : "Nothing needs attention"}
        >
          <Bell className="size-4" />
          {total > 0 && (
            // Sits on the bell rather than beside it so the button keeps the
            // same width whether or not there is work outstanding.
            <span className="absolute -right-1.5 -top-1.5 grid min-w-5 place-items-center rounded-full bg-destructive px-1 text-[11px] font-semibold leading-5 text-destructive-foreground">
              {total > 99 ? "99+" : total}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2.5">
          <p className="text-sm font-semibold">Needs Attention</p>
          <p className="text-xs text-muted-foreground">
            {dashboard.isPending
              ? "Checking…"
              : total > 0
                ? `${total} item${total === 1 ? "" : "s"} waiting at this location`
                : "This location is clear"}
          </p>
        </div>

        {dashboard.isPending ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <Check className="size-4 text-success-text" />
            Nothing needs action right now.
          </div>
        ) : (
          <div className="max-h-[24rem] overflow-y-auto py-1">
            {ATTENTION_GROUPS.map((group) => {
              const rows = items.filter((i) => i.group === group);
              if (rows.length === 0) return null;
              return (
                <div key={group} className="py-1">
                  <p className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {group}
                  </p>
                  {rows.map((item) => (
                    <Link
                      key={item.kind}
                      to={to(item.path)}
                      className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent"
                    >
                      <item.icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">{item.label}</span>
                      <Badge variant="secondary" className="tnum shrink-0">
                        {item.count}
                      </Badge>
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
