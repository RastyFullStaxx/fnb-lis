import { useState } from "react";
import { Unlock } from "lucide-react";
import { toast } from "sonner";
import { useReleaseDraft } from "@/api/sync";
import { ApiError } from "@/api/http";
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

/**
 * Free an open draft from the machine that started it.
 *
 * The escape hatch for Rule 1 (docs/sync-and-data-lifecycle.md §7.2). Draft
 * ownership is what makes two-way sync safe — only the source that opened a
 * count may edit it — but that rule alone would let a bar PC dying mid-count
 * freeze that count open forever.
 *
 * Deliberately friction-ful: it needs a written reason and spells out the
 * consequence, because releasing a draft that is merely *offline* rather than
 * dead means that machine's queued lines will be refused when it reconnects.
 */
export function ReleaseDraftButton({
  entity,
  id,
  machine,
}: {
  entity: "CountSession" | "Purchase" | "Transfer";
  id: string;
  machine: string | null;
}) {
  const release = useReleaseDraft();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const submit = async () => {
    if (reason.trim().length < 3) return toast.error("Say why you're releasing it");
    try {
      await release.mutateAsync({ entity, id, reason: reason.trim() });
      toast.success("Released — you can work on it here now");
      setOpen(false);
      setReason("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not release the draft");
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Unlock className="size-3.5" />
        Release
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Release this draft?</DialogTitle>
            <DialogDescription>
              It was started on {machine ?? "another computer"} and can only be edited there.
              Releasing it moves it here.
            </DialogDescription>
          </DialogHeader>

          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Only do this if that computer isn't coming back. If it's simply offline, anything
            counted on it since will be refused when it reconnects.
          </p>

          <div className="space-y-2">
            <Label htmlFor="release-reason">Reason</Label>
            <Textarea
              id="release-reason"
              rows={2}
              autoFocus
              placeholder="e.g. the bar PC died mid-count"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Go Back
            </Button>
            <Button onClick={() => void submit()} disabled={release.isPending}>
              Release
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
