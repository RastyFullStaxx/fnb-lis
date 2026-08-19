import { useEffect, useState } from "react";
import { CalendarRange } from "lucide-react";
import { toast } from "sonner";
import { can, type Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useUpdateLocationItemSchedule } from "@/api/location";
import { ApiError } from "@/api/http";
import type { LocationItem } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Set or clear an item's expected movement window (clutter-item-removal
 * plan, Phase 2 of the UI work). Same shape as PerishableEdit: saves onto
 * THIS location's catalog row through its own route (useUpdateLocationItemSchedule),
 * separate from locationItemUpdate so this button can be gated on
 * master.write without opening cost/retail/weights to that permission.
 *
 * Both months are always set or cleared together (server-enforced), so the
 * local state is a single "hasSchedule" toggle plus two month values rather
 * than three independent fields — there is no valid state with only one set.
 */
export function ScheduleEdit({ row }: { row: LocationItem }) {
  const me = useMe();
  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;
  // Same permission the PUT enforces (master.write), so the button can never
  // appear to someone the server will refuse.
  const canEdit = can(role, "master.write");
  const update = useUpdateLocationItemSchedule();
  const [open, setOpen] = useState(false);

  const [startMonth, setStartMonth] = useState<string>("1");
  const [endMonth, setEndMonth] = useState<string>("12");
  const [hasSchedule, setHasSchedule] = useState(false);

  // Reseed from the row every time the dialog opens, same pattern
  // PerishableEdit uses — an untouched dialog reflects what's actually saved.
  useEffect(() => {
    if (!open) return;
    setHasSchedule(row.scheduleStartMonth != null && row.scheduleEndMonth != null);
    setStartMonth(String(row.scheduleStartMonth ?? 1));
    setEndMonth(String(row.scheduleEndMonth ?? 12));
  }, [open, row.scheduleStartMonth, row.scheduleEndMonth]);

  if (!canEdit) return null;

  const save = async () => {
    try {
      await update.mutateAsync({
        id: row.id,
        scheduleStartMonth: hasSchedule ? Number(startMonth) : null,
        scheduleEndMonth: hasSchedule ? Number(endMonth) : null,
      });
      toast.success(`Movement schedule saved for ${row.itemVariant.item.name}`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save movement schedule");
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        className="size-6 shrink-0 p-0 text-muted-foreground"
        title="Movement schedule for this location"
        aria-label={`Movement schedule for ${row.itemVariant.item.name}`}
        onClick={() => setOpen(true)}
      >
        <CalendarRange className="size-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Movement schedule — {row.itemVariant.item.name}</DialogTitle>
            <DialogDescription>
              Keeps a seasonal item off Clutter Candidates while it's in season. Outside the window
              it counts as normal — every check applies against the last 12 months.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="schedule-start">Start</Label>
              <Select
                value={startMonth}
                onValueChange={(v) => {
                  setStartMonth(v);
                  setHasSchedule(true);
                }}
              >
                <SelectTrigger id="schedule-start">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((name, i) => (
                    <SelectItem key={name} value={String(i + 1)}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-end">End</Label>
              <Select
                value={endMonth}
                onValueChange={(v) => {
                  setEndMonth(v);
                  setHasSchedule(true);
                }}
              >
                <SelectTrigger id="schedule-end">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((name, i) => (
                    <SelectItem key={name} value={String(i + 1)}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="w-fit text-muted-foreground"
            onClick={() => setHasSchedule(false)}
            disabled={!hasSchedule}
          >
            Clear
          </Button>

          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            {hasSchedule ? (
              <>
                In season{" "}
                <span className="font-medium text-foreground">{MONTH_NAMES[Number(startMonth) - 1]}</span>{" "}
                to{" "}
                <span className="font-medium text-foreground">{MONTH_NAMES[Number(endMonth) - 1]}</span>.
                Outside this window, no movement counts against it.
              </>
            ) : (
              "Checked against the last 12 months at all times."
            )}
          </p>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Go Back
            </Button>
            <Button onClick={() => void save()} disabled={update.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
