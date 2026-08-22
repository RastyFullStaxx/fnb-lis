import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { usePreferencesContext } from "@/lib/preferences";

/**
 * One-time notice shown before a person's FIRST export in this app:
 * exports render quantities in the establishment default unit, not
 * whatever the viewer personally has set. See report-uom-plan.md, "First
 * export" and "On export".
 *
 * Lives ahead of any report actually converting a quantity (Phase 3 of
 * report-uom-phases.md), so the notice is never behind the behaviour it
 * explains — by the time a screen number can differ from what an export
 * shows, this has already had a chance to say so.
 *
 * Dismissal is a real per-user preference (hasSeenExportUnitNotice),
 * saved server-side through the same full-object PUT every other
 * preference in this app uses (see usePreferencesContext, mirrors
 * pages/admin/activity.tsx's activityViewedAt write). Not device-local:
 * a person who dismisses it on one machine won't see it again on another.
 */
export function useExportUnitNotice() {
  const { preferences, setPreferences } = usePreferencesContext();
  const [pending, setPending] = useState<{ resolve: () => void } | null>(null);

  /** Call this instead of the export action directly. Runs the export
      immediately if the notice was already dismissed; otherwise opens the
      modal and runs it once the person confirms. */
  const runWithNotice = (proceed: () => void) => {
    if (preferences.hasSeenExportUnitNotice) {
      proceed();
      return;
    }
    setPending({ resolve: proceed });
  };

  const confirm = (dontShowAgain: boolean) => {
    const proceed = pending?.resolve;
    setPending(null);
    if (dontShowAgain) {
      setPreferences({ ...preferences, hasSeenExportUnitNotice: true });
    }
    proceed?.();
  };

  const modal = pending ? <ExportUnitNoticeDialog onConfirm={confirm} /> : null;

  return { runWithNotice, modal };
}

function ExportUnitNoticeDialog({ onConfirm }: { onConfirm: (dontShowAgain: boolean) => void }) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onConfirm(dontShowAgain)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Exports use the establishment default unit</DialogTitle>
          <DialogDescription>
            Quantities on screen follow your own unit setting. In an exported file, they
            follow this establishment's default unit instead, so the file reads the same
            for everyone who opens it.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={dontShowAgain} onCheckedChange={(v) => setDontShowAgain(v === true)} />
          Don't show this again
        </label>
        <DialogFooter>
          <Button onClick={() => onConfirm(dontShowAgain)}>Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
