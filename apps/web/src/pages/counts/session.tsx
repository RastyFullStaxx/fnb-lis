import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, Check, Pencil } from "lucide-react";
import { toast } from "sonner";
import { can, type Role } from "@fnb/core";
import { statusVariant } from "@/lib/status";
import { useMe } from "@/api/auth";
import { useLocationId, useLocationItems } from "@/api/location";
import { useCountMutations, useCountSession } from "@/api/ops";
import { variantLabel, type CountLine, type LocationItem } from "@/api/types";
import { ApiError } from "@/api/http";
import { ItemCombobox } from "@/components/item-combobox";
import { WeightReport } from "@/pages/stock/weight-report";
import { VoidDialog } from "@/components/void-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EntryFact, EntryFacts } from "@/components/entry-fact";
import { useWeighPreview, WeighPreviewStrip } from "@/components/weigh-calculator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuantityInput } from "@/components/quantity-input";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { cn, formatDate } from "@/lib/utils";

// Arriving here via Full Audit's drilldown (see full-audit.tsx's
// fullAuditReturnUrl) stashes the exact report URL — filters, period, and
// ?drill=<item> — in router state. "Back" should return there, not to the
// plain Counts list, or the user loses the report context they came from.
function useBackHref(locationId: string): string {
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
  return returnTo || `/l/${locationId}/counts`;
}

export function CountSessionPage() {
  const { sessionId } = useParams();
  const locationId = useLocationId();
  const session = useCountSession(sessionId!);
  const backHref = useBackHref(locationId);

  if (session.isPending) return <SessionSkeleton />;
  if (session.isError)
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-sm">Couldn't load this count session — it may have been removed.</p>
        <Button asChild variant="outline" size="sm">
          <Link to={backHref}>Back to Counts</Link>
        </Button>
      </div>
    );

  const s = session.data;
  return s.status === "OPEN" ? <OpenSession session={s} /> : <ReadOnlySession session={s} />;
}

/** Skeleton shaped like the session workspace — header row, then the 7fr/5fr entry/recent split. */
function SessionSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="size-9" />
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="ml-auto h-6 w-24" />
      </div>
      <div className="grid gap-6 rounded-lg border p-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="space-y-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-11 w-full" />
          <div className="flex justify-end">
            <Skeleton className="h-9 w-28" />
          </div>
        </div>
        <div className="lg:border-l lg:pl-6">
          <Skeleton className="mb-3 h-4 w-32" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type SessionWithLines = NonNullable<ReturnType<typeof useCountSession>["data"]>;

function SessionHeader({ session }: { session: SessionWithLines }) {
  const locationId = useLocationId();
  const backHref = useBackHref(locationId);
  return (
    <div className="mb-4 flex items-center gap-3">
      <Button asChild variant="ghost" size="icon" aria-label="Back">
        <Link to={backHref}>
          <ArrowLeft className="size-4" />
        </Link>
      </Button>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Count · {formatDate(session.countDate)}</h2>
        <p className="text-sm text-muted-foreground">
          {session.status === "OPEN"
            ? "Counting in progress — every saved line lands below."
            : session.status === "COMMITTED"
              ? "Committed. Lines are locked — Edit replaces an entry, Cancel drops it. Both stay in the trail."
              : `Cancelled: ${session.voidReason}`}
        </p>
      </div>
      <Badge className="ml-auto" variant={statusVariant(session.status)}>
        {session.status === "OPEN" ? "Counting" : session.status === "COMMITTED" ? "Committed" : "Cancelled"}
      </Badge>
    </div>
  );
}

// ── OPEN: the rapid-entry screen ──

function OpenSession({ session }: { session: SessionWithLines }) {
  const mutations = useCountMutations(session.id);
  const [item, setItem] = useState<LocationItem | null>(null);
  const [mode, setMode] = useState<"FULL" | "WEIGH" | "OPEN">("FULL");
  const [qty, setQty] = useState("");
  const [scale, setScale] = useState("");
  // Direct open-amount entry — remaining content typed in, no weighing.
  const [openAmount, setOpenAmount] = useState("");
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [pane, setPane] = useState<"entered" | "remaining">("entered");
  const comboRef = useRef<HTMLButtonElement>(null);

  const weighable = (item?.itemVariant.contentTracked || item?.itemVariant.weighMode === "NET") ?? false;
  const activeMode = weighable ? mode : "FULL";
  const preview = useWeighPreview(item, scale);

  /**
   * Focus the entry field for the current mode. Picking an item left focus on
   * the picker, so every single item cost an extra Tab — and on the paths that
   * already know the item (Edit, and tapping a row in "Not counted") focusing
   * the picker was actively wrong.
   */
  const focusEntry = () => {
    requestAnimationFrame(() => {
      const id = activeMode === "FULL" ? "count-qty" : activeMode === "OPEN" ? "count-open" : "count-scale";
      document.getElementById(id)?.focus();
    });
  };

  const resetForm = () => {
    setQty("");
    setScale("");
    setOpenAmount("");
    setItem(null);
    setEditingLineId(null);
  };

  const startEdit = (line: CountLine) => {
    setEditingLineId(line.id);
    setItem(line.locationItem);
    if (line.countType === "FULL") {
      setMode("FULL");
      setQty(String(line.qtyFull));
      setScale("");
      setOpenAmount("");
    } else if (line.scaleWeight == null) {
      // Weigh line entered as a direct amount (no scale/tare).
      setMode("OPEN");
      setOpenAmount(String(line.remainingContent));
      setScale("");
      setQty("");
    } else {
      setMode("WEIGH");
      setScale(String(line.scaleWeight));
      setQty("");
      setOpenAmount("");
    }
    focusEntry();
  };

  const save = async () => {
    if (!item) return;
    try {
      // Edits go through the atomic PUT — one request updates the line in
      // place. Add-then-remove (or the reverse) leaves either a lost count or
      // a DUPLICATE line double-counting inventory if the second call fails.
      if (activeMode === "FULL") {
        const n = Number(qty);
        if (qty === "" || !Number.isFinite(n) || n < 0) return toast.error("Enter the counted quantity");
        const body = { locationItemId: item.id, countType: "FULL" as const, qtyFull: n };
        if (editingLineId) await mutations.updateLine.mutateAsync({ lineId: editingLineId, ...body });
        else await mutations.addLine.mutateAsync(body);
      } else if (activeMode === "OPEN") {
        // Direct amount — no weighing. Stored as a weigh line with the content
        // set straight from what the counter typed.
        const n = Number(openAmount);
        if (openAmount === "" || !Number.isFinite(n) || n < 0) return toast.error("Enter the remaining amount");
        const body = { locationItemId: item.id, countType: "WEIGH" as const, remainingContent: n };
        if (editingLineId) await mutations.updateLine.mutateAsync({ lineId: editingLineId, ...body });
        else await mutations.addLine.mutateAsync(body);
      } else {
        if (!preview || !preview.ready || !preview.entered || preview.blocking) {
          return toast.error("Fix the scale reading first");
        }
        const body = {
          locationItemId: item.id,
          countType: "WEIGH" as const,
          scaleWeight: preview.scale,
          scaleUnit: preview.unit as "g" | "oz",
          tareWeight: preview.tare,
          densityFactor: preview.density ?? undefined,
        };
        if (editingLineId) await mutations.updateLine.mutateAsync({ lineId: editingLineId, ...body });
        else await mutations.addLine.mutateAsync(body);
      }
      const wasEditing = editingLineId !== null;
      // Enter → saved → refocus the item picker: the counting rhythm.
      resetForm();
      comboRef.current?.focus();
      if (wasEditing) toast.success("Line updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the line");
    }
  };

  const commit = async () => {
    try {
      await mutations.commit.mutateAsync();
      toast.success(`Count for ${formatDate(session.countDate)} committed`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not commit");
    }
  };

  const activeLines = session.lines.filter((l) => l.status === "ACTIVE");

  // Completeness. An item left out of a count is silently DROPPED from the
  // reconciliation — it doesn't show as a shortage, the row just disappears —
  // so the counter has to be able to see what is still outstanding before the
  // period locks.
  const catalog = useLocationItems();
  const countedIds = new Set(activeLines.map((l) => l.locationItemId));
  const remaining = (catalog.data ?? []).filter((li: LocationItem) => !countedIds.has(li.id));
  const total = catalog.data?.length ?? 0;
  const done = total > 0 ? Math.min(activeLines.length, total) : 0;

  return (
    // Fit the viewport: only the panes scroll, never the page (like Sales).
    <div className="flex min-h-0 flex-1 flex-col">
      <SessionHeader session={session} />
      {/* One bordered surface, two panes split by a hairline — never two stacked cards. */}
      <div className="grid gap-6 rounded-lg border p-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:grid-rows-1 lg:overflow-hidden">
        {/* Entry pane — scrolls on its own if the weigh form runs tall. */}
        <div className="space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          {editingLineId && (
            <div className="flex items-center justify-between rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
              <span className="flex items-center gap-1.5">
                <Pencil className="size-3.5" /> Editing this line — save to replace it.
              </span>
              <Button variant="ghost" size="sm" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="count-item">Item</Label>
            <ItemCombobox
              id="count-item"
              ref={comboRef}
              value={item}
              onSelect={(li) => {
                setItem(li);
                focusEntry();
              }}
              autoFocus
            />
          </div>

          {weighable && (
            <Tabs value={activeMode} onValueChange={(v) => setMode(v as "FULL" | "WEIGH" | "OPEN")}>
              <TabsList className="w-full">
                <TabsTrigger value="FULL" className="flex-1">
                  Full Units
                </TabsTrigger>
                <TabsTrigger value="WEIGH" className="flex-1">
                  Weigh Partial
                </TabsTrigger>
                <TabsTrigger value="OPEN" className="flex-1">
                  Open Amount
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {activeMode === "FULL" ? (
            <div className="space-y-2">
              <Label htmlFor="count-qty">Counted Quantity</Label>
              <QuantityInput
                id="count-qty"
                className="tnum h-11 text-lg"
                placeholder="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
            </div>
          ) : activeMode === "OPEN" ? (
            <div className="space-y-2">
              <Label htmlFor="count-open">
                Remaining {item?.itemVariant.unit.name ?? "content"}
              </Label>
              <QuantityInput
                id="count-open"
                className="tnum h-11 text-lg"
                placeholder={item?.itemVariant.size ? `e.g. ${item.itemVariant.size} = a full one` : "Amount left"}
                value={openAmount}
                onChange={(e) => setOpenAmount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
              <p className="text-xs text-muted-foreground">
                Type the amount left in the open container — no scale or empty weight needed.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="count-scale">Scale reading{preview?.ready ? ` (${preview.unit})` : ""}</Label>
              <QuantityInput
                id="count-scale"
                className="tnum h-11 text-lg"
                placeholder="Put the bottle on the scale"
                value={scale}
                onChange={(e) => setScale(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
              <WeighPreviewStrip
                preview={preview}
                size={item?.itemVariant.size ?? 0}
                contentUnit={item?.itemVariant.unit.name ?? "ml"}
              />
              {/* Reported here, holding the bottle — the moment the number looks
                  wrong. Staff can't edit weights, so without this the only path
                  was telling a manager out loud. */}
              {item && <WeightReport row={item} />}
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {editingLineId ? "Enter saves the change." : "Enter saves and jumps back to the item picker."}
            </p>
            <Button onClick={save} disabled={!item || mutations.addLine.isPending || mutations.removeLine.isPending}>
              {mutations.addLine.isPending || mutations.removeLine.isPending
                ? "Saving…"
                : editingLineId
                  ? "Save changes"
                  : "Save line"}
            </Button>
          </div>

          <Separator />

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="secondary" className="w-full" disabled={activeLines.length === 0}>
                <Check className="size-4" /> Commit count ({activeLines.length} line
                {activeLines.length === 1 ? "" : "s"})
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Commit this count?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3">
                    <p>
                      {activeLines.length} line{activeLines.length === 1 ? "" : "s"} for {formatDate(session.countDate)}.
                      Once committed, lines lock — fixes go through Edit, which replaces the entry and keeps both halves in the trail. The date then becomes available as a report boundary.
                    </p>
                    {remaining.length > 0 && (
                      // The one thing worth interrupting for: uncounted items
                      // vanish from the audit rather than showing up as a
                      // variance, so nobody would ever notice the omission.
                      <div className="rounded-md bg-warning/10 p-3 text-foreground">
                        <p className="font-medium">
                          {remaining.length} item{remaining.length === 1 ? " has" : "s have"} not been counted
                        </p>
                        <p className="mt-1">
                          {remaining.slice(0, 4).map((li: LocationItem) => li.itemVariant.item.name).join(", ")}
                          {remaining.length > 4 ? `, and ${remaining.length - 4} more` : ""}.
                        </p>
                        <p className="mt-1.5">
                          Uncounted items are left out of the reconciliation entirely — they
                          won't appear as a shortage. Commit only if that is intended.
                        </p>
                      </div>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep Counting</AlertDialogCancel>
                <AlertDialogAction onClick={commit}>Commit Count</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Recent entries pane (modernized legacy live preview) */}
        <div className="flex min-h-0 flex-col lg:border-l lg:pl-6">
          <CountProgress done={done} total={total} />

          {/* Two views of the same pane: what's in, and what's still out. The
              second is the one that keeps a period from locking half-counted. */}
          <Tabs value={pane} onValueChange={(v) => setPane(v as "entered" | "remaining")} className="mb-2 shrink-0">
            <TabsList className="w-full">
              <TabsTrigger value="entered" className="flex-1">
                Counted <span className="ml-1.5 tnum opacity-70">{activeLines.length}</span>
              </TabsTrigger>
              <TabsTrigger value="remaining" className="flex-1">
                Not counted <span className="ml-1.5 tnum opacity-70">{remaining.length}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div aria-live="polite" className="min-h-0 flex-1 divide-y overflow-y-auto max-lg:max-h-[28rem]">
            {pane === "remaining" ? (
              remaining.length === 0 ? (
                <p className="flex items-center gap-2 p-4 text-sm text-success-text">
                  <Check className="size-4" /> Every item in this catalog has been counted.
                </p>
              ) : (
                remaining.map((li: LocationItem) => (
                  // Tapping it loads the item into the form — the shortest path
                  // from "what's left" to "counted".
                  <button
                    key={li.id}
                    type="button"
                    className="flex w-full items-baseline gap-2 px-1 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      setItem(li);
                      setPane("entered");
                      focusEntry();
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">{li.itemVariant.item.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{variantLabel(li.itemVariant)}</span>
                  </button>
                ))
              )
            ) : activeLines.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Nothing counted yet.</p>
            ) : (
              activeLines.map((line) => (
                <LineRow
                  key={line.id}
                  line={line}
                  removable
                  editing={line.id === editingLineId}
                  onEdit={() => startEdit(line)}
                  onRemove={() =>
                    mutations.removeLine
                      .mutateAsync(line.id)
                      .then(() => {
                        if (line.id === editingLineId) resetForm();
                      })
                      .catch((err) =>
                        toast.error(err instanceof ApiError ? err.message : "Could not remove"),
                      )
                  }
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * How far through the catalog this count is. A bare "Entered lines: 3" gives no
 * sense of whether that is nearly done or barely started, and an item never
 * counted is dropped from the reconciliation silently.
 */
function CountProgress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const complete = total > 0 && done >= total;
  return (
    <div className="mb-3 shrink-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">Progress</span>
        <span className="tnum text-sm text-muted-foreground">
          {total > 0 ? `${done} of ${total} items` : `${done} counted`}
        </span>
      </div>
      {total > 0 && (
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Items counted"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
              complete ? "bg-success" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── COMMITTED / VOID: read-only + void/correct on lines ──

function ReadOnlySession({ session }: { session: SessionWithLines }) {
  const me = useMe();
  const mutations = useCountMutations(session.id);
  const [voiding, setVoiding] = useState<CountLine | null>(null);
  const [editing, setEditing] = useState<CountLine | null>(null);
  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;
  const canVoid = can(role, "entries.void") && session.status === "COMMITTED";
  // Editing voids the original and writes a replacement, so it needs both
  // rights — same rule as Sales.
  const canEdit = canVoid && can(role, "entries.create");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SessionHeader session={session} />
      {/* Card fills the viewport; only the line list inside scrolls. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
        <div className="min-h-0 flex-1 divide-y overflow-y-auto">
          {session.lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              onVoid={canVoid && line.status === "ACTIVE" ? () => setVoiding(line) : undefined}
              onEdit={canEdit && line.status === "ACTIVE" ? () => setEditing(line) : undefined}
            />
          ))}
        </div>
      </div>

      <VoidDialog
        open={voiding !== null}
        onOpenChange={(open) => !open && setVoiding(null)}
        title="Cancel this count line?"
        pending={mutations.voidLine.isPending}
        onConfirm={async (reason) => {
          try {
            await mutations.voidLine.mutateAsync({ lineId: voiding!.id, reason });
            toast.success("Line voided — reports updated");
            setVoiding(null);
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : "Could not void");
          }
        }}
      />

      <EditLineDialog
        line={editing}
        sessionId={session.id}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </div>
  );
}

/**
 * Edit a committed count line. The item is fixed — you're correcting the number
 * counted, not what was counted (for a wrong item, cancel it and the item shows
 * up again as uncounted). Saving voids the original and writes a linked
 * replacement into the SAME session, which is why this exists at all: a
 * committed session accepts no new lines, so cancel-only would leave the item
 * with no closing count and silently drop it out of the Full Audit.
 *
 * Entry mirrors the counting screen — same modes, same live weigh preview,
 * same core math — so a correction can never produce a shape the entry form
 * refuses to create.
 */
function EditLineDialog({
  line,
  sessionId,
  onOpenChange,
}: {
  line: CountLine | null;
  sessionId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const mutations = useCountMutations(sessionId);
  const [mode, setMode] = useState<"FULL" | "WEIGH" | "OPEN">("FULL");
  const [qty, setQty] = useState("");
  const [scale, setScale] = useState("");
  const [openAmount, setOpenAmount] = useState("");
  const [changeReason, setChangeReason] = useState("");

  // Re-seed every field when a different line opens the dialog — same mapping
  // the open-session Edit uses.
  useEffect(() => {
    if (!line) return;
    setChangeReason("");
    if (line.countType === "FULL") {
      setMode("FULL");
      setQty(String(line.qtyFull));
      setScale("");
      setOpenAmount("");
    } else if (line.scaleWeight == null) {
      setMode("OPEN");
      setOpenAmount(String(line.remainingContent));
      setQty("");
      setScale("");
    } else {
      setMode("WEIGH");
      setScale(String(line.scaleWeight));
      setQty("");
      setOpenAmount("");
    }
  }, [line]);

  // Hooks stay above the early return — useWeighPreview handles a null item.
  const item = line?.locationItem ?? null;
  const preview = useWeighPreview(item, scale);
  const weighable = (item?.itemVariant.contentTracked || item?.itemVariant.weighMode === "NET") ?? false;
  const activeMode = weighable ? mode : "FULL";

  if (!line || !item) return null;
  const variant = item.itemVariant;

  const submit = async () => {
    if (changeReason.trim().length < 3) return toast.error("Add a reason for the change");
    let body;
    if (activeMode === "FULL") {
      const n = Number(qty);
      if (qty === "" || !Number.isFinite(n) || n < 0) return toast.error("Enter the counted quantity");
      body = { locationItemId: item.id, countType: "FULL" as const, qtyFull: n };
    } else if (activeMode === "OPEN") {
      const n = Number(openAmount);
      if (openAmount === "" || !Number.isFinite(n) || n < 0) return toast.error("Enter the remaining amount");
      body = { locationItemId: item.id, countType: "WEIGH" as const, remainingContent: n };
    } else {
      if (!preview || !preview.ready || !preview.entered || preview.blocking) {
        return toast.error("Fix the scale reading first");
      }
      body = {
        locationItemId: item.id,
        countType: "WEIGH" as const,
        scaleWeight: preview.scale,
        scaleUnit: preview.unit as "g" | "oz",
        tareWeight: preview.tare,
        densityFactor: preview.density ?? undefined,
      };
    }
    try {
      await mutations.correctLine.mutateAsync({ lineId: line.id, ...body, reason: changeReason.trim() });
      toast.success("Line updated — the original is kept, marked corrected");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the change");
    }
  };

  return (
    <Dialog open={line !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Line</DialogTitle>
          <DialogDescription>
            {variant.item.name} {variantLabel(variant)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {weighable && (
            <Tabs value={activeMode} onValueChange={(v) => setMode(v as "FULL" | "WEIGH" | "OPEN")}>
              <TabsList className="w-full">
                <TabsTrigger value="FULL" className="flex-1">
                  Full Units
                </TabsTrigger>
                <TabsTrigger value="WEIGH" className="flex-1">
                  Weigh Partial
                </TabsTrigger>
                <TabsTrigger value="OPEN" className="flex-1">
                  Open Amount
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {activeMode === "FULL" ? (
            <div className="space-y-2">
              <Label htmlFor="ec-qty">Counted Quantity</Label>
              <QuantityInput
                id="ec-qty"
                className="tnum"
                placeholder="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
          ) : activeMode === "OPEN" ? (
            <div className="space-y-2">
              <Label htmlFor="ec-open">Remaining {variant.unit.name}</Label>
              <QuantityInput
                id="ec-open"
                className="tnum"
                placeholder="0"
                value={openAmount}
                onChange={(e) => setOpenAmount(e.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="ec-scale">Scale Reading</Label>
              <QuantityInput
                id="ec-scale"
                className="tnum"
                placeholder="0"
                value={scale}
                onChange={(e) => setScale(e.target.value)}
              />
              <WeighPreviewStrip preview={preview} size={variant.size} contentUnit={variant.unit.name} />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="ec-change">Reason for change</Label>
            <Input
              id="ec-change"
              placeholder="e.g. Miscounted, recount confirmed 3"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel Correction
          </Button>
          <Button onClick={submit} disabled={mutations.correctLine.isPending}>
            {mutations.correctLine.isPending ? "Saving…" : "Save Correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LineRow({
  line,
  removable,
  editing,
  onEdit,
  onRemove,
  onVoid,
}: {
  line: CountLine;
  removable?: boolean;
  editing?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  onVoid?: () => void;
}) {
  const variant = line.locationItem.itemVariant;
  const voided = line.status === "VOID";
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <div
      className={cn(
        "flex flex-col gap-1 px-4 py-2.5",
        voided && "opacity-50",
        editing && "bg-accent/60",
      )}
    >
      {/* Same labelled layout as Sales / Purchases recent panels: name on its
          own full-width line (size unbroken), facts stacked, actions bottom-right. */}
      <p className={cn("text-sm font-medium", voided && "line-through")}>
        {variant.item.name}
        <span className="ml-1.5 whitespace-nowrap font-normal text-muted-foreground">
          {variantLabel(variant)}
        </span>
      </p>
      <div className="flex items-end justify-between gap-3">
        <EntryFacts>
          {line.countType === "FULL" ? (
            <EntryFact label="Count" value={`${line.qtyFull} full`} />
          ) : line.scaleWeight == null ? (
            // Direct open-amount entry — no scale/tare to show.
            <EntryFact label="Open amount" value={`${line.remainingContent} ${variant.unit.name}`} />
          ) : (
            <EntryFact
              label="Weighed"
              value={`${line.scaleWeight} ${line.scaleUnit} → ${line.remainingContent} ${variant.unit.name}`}
            />
          )}
          {line.correctionOfId && <EntryFact label="Type" value="Correction" />}
          <EntryFact label="By" value={line.createdByName} />
          {voided && line.voidReason && <EntryFact label="Cancelled" value={line.voidReason} />}
        </EntryFacts>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {line.countType === "WEIGH" && !voided && (
            <Badge variant="outline" className="tnum">
              {(line.remainingContent / (variant.size || 1)).toFixed(2)} of {variantLabel(variant)}
            </Badge>
          )}
          {/* Edit is no longer draft-only: a committed line corrects through the
              same button, so the parent decides by passing onEdit or not. */}
          {(onVoid || onEdit || (removable && onRemove)) && (
            <div className="mt-auto flex gap-1">
              {onVoid && (
                <Button variant="destructive" size="xs" onClick={onVoid}>
                  Cancel
                </Button>
              )}
              {removable && onRemove && (
                <Button variant="destructive" size="xs" onClick={() => setConfirmRemove(true)}>
                  Remove
                </Button>
              )}
              {onEdit && (
                <Button variant="outline" size="xs" onClick={onEdit}>
                  Edit
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {onRemove && (
        <ConfirmDialog
          open={confirmRemove}
          onOpenChange={setConfirmRemove}
          title="Remove this line?"
          description={`${variant.item.name} ${variantLabel(variant)} will be taken off this count.`}
          confirmLabel="Remove"
          destructive
          onConfirm={() => {
            setConfirmRemove(false);
            onRemove();
          }}
        />
      )}
    </div>
  );
}
