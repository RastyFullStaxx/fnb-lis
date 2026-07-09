import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Empty states teach the interface: icon, one sentence, one action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-muted-foreground/25">
      <div className="max-w-sm p-8 text-center">
        <Icon className="mx-auto mb-3 size-8 text-muted-foreground/50" />
        <h3 className="text-balance text-base font-semibold">{title}</h3>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}
