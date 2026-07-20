import { useState, type ReactNode } from "react";
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
 * Every void requires a reason — the record stays visible in history with it.
 * (Committed records are never deleted; this is the correction model's face.)
 */
export function VoidDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  pending,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  onConfirm: (reason: string) => void;
  pending?: boolean;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setReason("");
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ??
              "The entry stays in history, marked cancelled with your reason. Reports stop counting it."}
          </DialogDescription>
        </DialogHeader>
        {children}
        <div className="space-y-2">
          <Label htmlFor="void-reason">Reason</Label>
          <Textarea
            id="void-reason"
            rows={2}
            autoFocus
            placeholder="Why is this entry wrong?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep Record
          </Button>
          <Button
            variant="destructive"
            disabled={reason.trim().length < 3 || pending}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending ? "Cancelling…" : "Cancel Entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
