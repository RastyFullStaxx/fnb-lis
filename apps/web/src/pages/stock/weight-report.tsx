import { useState } from "react";
import { Scale } from "lucide-react";
import { toast } from "sonner";
import { can, type Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useReportWeightProblem, useResolveWeightProblem } from "@/api/master";
import { ApiError } from "@/api/http";
import type { LocationItem } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * A client can't edit the bottle-weight library, so this is how they say a
 * weight looks wrong — a supplier changed the bottle, the numbers stopped
 * reconciling (client req 2026-07-25, the "or need update" half).
 *
 * Anyone who records entries can raise one — including STAFF, who are the ones
 * actually weighing bottles and so the ones who notice a bad tare. The LIS admin
 * sees the note and closes it once he has re-weighed. One open report per
 * bottle, so this can't become a queue of duplicate asks.
 */
export function WeightReport({
  row,
  as = "action",
}: {
  row: LocationItem;
  /** "badge" renders only the pending state (it belongs in Status); "action"
      renders only the way to raise one (it lives inside the Weigh dialog). */
  as?: "badge" | "action";
}) {
  const me = useMe();
  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;
  const canReport = can(role, "entries.create");
  const canResolve = can(role, "weights.manage");
  const report = useReportWeightProblem();
  const resolve = useResolveWeightProblem();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const variant = row.itemVariant;
  const pending = variant.weightReviewNote;
  // Only weighable bottles have weights worth disputing.
  const weighable = variant.contentTracked || variant.weighMode === "NET" || variant.weighMode === "DENSITY";
  if (!weighable || (!canReport && !pending)) return null;

  const submit = async () => {
    if (note.trim().length < 3) return toast.error("Say what looks wrong");
    try {
      await report.mutateAsync({ variantId: variant.id, note: note.trim() });
      toast.success("Reported — your LIS administrator will re-weigh this bottle");
      setOpen(false);
      setNote("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send the report");
    }
  };

  const close = async () => {
    try {
      await resolve.mutateAsync(variant.id);
      toast.success("Weight report closed");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not close the report");
    }
  };

  if (pending) {
    if (as === "action") return null; // already raised — one open report per bottle
    return (
      <div className="flex items-center justify-end gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Badge variant="warning" className="cursor-help">Weight reported</Badge>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              “{pending}”
              {variant.weightReviewBy ? ` — ${variant.weightReviewBy}` : ""}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {canResolve && (
          <Button variant="ghost" size="xs" onClick={() => void close()} disabled={resolve.isPending}>
            Close
          </Button>
        )}
      </div>
    );
  }

  if (as === "badge") return null; // nothing pending — Status stays quiet

  return (
    <>
      {/* Secondary by placement, not by hiding: it sits inside the Weigh
          dialog, because "the standard is wrong" only comes up once you have
          weighed the bottle yourself and disagree with it. */}
      <Button variant="ghost" size="sm" className="mr-auto text-muted-foreground" onClick={() => setOpen(true)}>
        Report a problem
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report a weight problem</DialogTitle>
            <DialogDescription>
              {row.itemVariant.item.name} — tell your LIS administrator what looks wrong.
              They will re-weigh the bottle and correct it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="weight-note">What's wrong?</Label>
            <Textarea
              id="weight-note"
              rows={3}
              autoFocus
              placeholder="e.g. the supplier changed to a heavier bottle, so counts read short"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Go Back
            </Button>
            <Button onClick={() => void submit()} disabled={report.isPending}>
              Send report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
