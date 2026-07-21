import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Check, ChevronsUpDown, Martini, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { useLocationId, useLocationItems } from "@/api/location";
import { useMenus } from "@/api/menus";
import { useImportBatch, useImportRowMutations, type ImportRow } from "@/api/imports";
import { variantLabel } from "@/api/types";
import { ApiError } from "@/api/http";
import { formatMoney } from "@/lib/utils";
import { TableSurface, TableLoading } from "@/components/table-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KIND_LABELS, SOURCE_LABELS } from "./index";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const METHOD_BADGE: Record<string, { label: string; className: string }> = {
  EXACT: { label: "Exact", className: "border-primary text-primary" },
  ALIAS: { label: "Alias", className: "border-primary/60 text-primary" },
  FUZZY: { label: "Similar", className: "border-warning/35 bg-warning/10 text-warning-text" },
  MANUAL: { label: "Manual", className: "border-primary text-primary" },
};

const ROW_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  COMMITTED: "Committed",
};

/** Peso-formatted money cell value; em dash when the file carried none. */
const money = (value: number | null) => (value == null ? "—" : formatMoney(value));

export function ImportReviewPage() {
  const { batchId } = useParams();
  const locationId = useLocationId();
  const navigate = useNavigate();
  const batch = useImportBatch(batchId!);
  const items = useLocationItems();
  const menus = useMenus();
  const mutations = useImportRowMutations(batchId!);

  const labelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const li of items.data ?? []) m.set(li.id, `${li.itemVariant.item.name} ${variantLabel(li.itemVariant)}`);
    for (const menu of menus.data ?? []) m.set(menu.id, menu.name);
    return m;
  }, [items.data, menus.data]);

  // Bulk approve/reject runs one request per row — surface progress and lock
  // the header actions so a large batch doesn't look dead mid-run.
  const [bulk, setBulk] = useState<{ verb: string; done: number; total: number } | null>(null);

  if (batch.isPending) {
    // Skeleton shaped like the final layout: back-button header + review surface.
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label="Back to Imports">
            <Link to={`/l/${locationId}/imports`}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <TableSurface>
          <TableLoading />
        </TableSurface>
      </div>
    );
  }
  if (batch.isError || !batch.data) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <p className="text-sm text-foreground">
            This import batch couldn't be found — it may have been removed, or the link is out of date.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to={`/l/${locationId}/imports`}>Back to Imports</Link>
          </Button>
        </div>
      </div>
    );
  }

  const b = batch.data;
  const editable = b.status === "NEEDS_REVIEW";
  const rows = b.rows;
  const approvedCount = rows.filter((r) => r.status === "APPROVED").length;

  const setStatus = (row: ImportRow, status: "PENDING" | "APPROVED" | "REJECTED") =>
    mutations.updateRow.mutateAsync({ rowId: row.id, status }).catch((e) => toast.error(e instanceof ApiError ? e.message : "Failed"));

  const setMatch = (row: ImportRow, kind: "item" | "menu", id: string) =>
    mutations.updateRow
      .mutateAsync({
        rowId: row.id,
        matchedLocationItemId: kind === "item" ? id : undefined,
        matchedMenuItemId: kind === "menu" ? id : undefined,
        status: "APPROVED",
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "Failed"));

  // The rows each bulk button would act on. Kept as live counts so the button
  // can show how many it will affect and disable itself when there's nothing
  // to do — the missing "did that work?" cue: a lit button with a count means
  // there's work; a greyed one means every matched/unmatched row is already
  // handled.
  const matchedPending = rows.filter(
    (r) => r.status !== "REJECTED" && r.status !== "APPROVED" && Boolean(r.matchedLocationItemId || r.matchedMenuItemId),
  );
  const unmatchedActive = rows.filter((r) => !r.matchedLocationItemId && !r.matchedMenuItemId && r.status !== "REJECTED");

  const runBulk = async (verb: string, targets: ImportRow[], status: "APPROVED" | "REJECTED") => {
    if (targets.length === 0 || bulk) return;
    setBulk({ verb, done: 0, total: targets.length });
    try {
      for (const row of targets) {
        await setStatus(row, status);
        setBulk((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
      }
      toast.success(`${status === "APPROVED" ? "Approved" : "Declined"} ${targets.length} row${targets.length === 1 ? "" : "s"}`);
    } finally {
      setBulk(null);
    }
  };
  const approveAllMatched = () => runBulk("Approving", matchedPending, "APPROVED");
  const rejectUnmatched = () => runBulk("Rejecting", unmatchedActive, "REJECTED");

  const commit = async () => {
    try {
      const res = await mutations.commit.mutateAsync();
      toast.success(`Committed ${res.committed} rows — they're now in your reports`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Commit failed");
    }
  };
  const reverse = async () => {
    try {
      const res = await mutations.reverse.mutateAsync();
      toast.success(`Reversed — ${res.reversed} records voided, reports restored`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Reverse failed");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to Imports">
          <Link to={`/l/${locationId}/imports`}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold tracking-tight">{b.fileName}</h2>
          <p className="text-sm text-muted-foreground">
            {KIND_LABELS[b.kind] ?? b.kind} · {SOURCE_LABELS[b.sourceType] ?? b.sourceType}
            {b.extractor === "AI" && " · AI-extracted"} · {rows.length} rows
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {editable && (
            <>
              {/* Bulk shortcuts for a large file — the per-row Approve/Reject
                  do the same for one row. "Matched"/"Unmatched" name the set
                  each acts on. */}
              <Button
                variant="outline"
                size="sm"
                title="Approve every row that already has a confident match"
                onClick={approveAllMatched}
                disabled={bulk !== null || matchedPending.length === 0}
              >
                <Check className="size-4" />
                {bulk?.verb === "Approving"
                  ? `Approving ${bulk.done}/${bulk.total}…`
                  : `Approve All Matched${matchedPending.length > 0 ? ` (${matchedPending.length})` : ""}`}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                title="Decline every row that has no match"
                onClick={rejectUnmatched}
                disabled={bulk !== null || unmatchedActive.length === 0}
              >
                <X className="size-4" />
                {bulk?.verb === "Rejecting"
                  ? `Declining ${bulk.done}/${bulk.total}…`
                  : `Decline All Unmatched${unmatchedActive.length > 0 ? ` (${unmatchedActive.length})` : ""}`}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" disabled={approvedCount === 0 || bulk !== null}>
                    <Check className="size-4" /> Commit ({approvedCount})
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Commit {approvedCount} approved rows?</AlertDialogTitle>
                    <AlertDialogDescription>
                      These become {b.kind === "PURCHASES" ? "purchase" : "sale"} records in your reports. You can reverse the
                      whole batch later if needed. Manual matches are remembered for next time.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep Reviewing</AlertDialogCancel>
                    <AlertDialogAction onClick={commit}>Commit</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          {b.status === "COMMITTED" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Undo2 className="size-4" /> Reverse Batch
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reverse this import?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Every record created by this batch is voided and your reports return to their prior numbers. The batch
                    stays in history, marked reversed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep It</AlertDialogCancel>
                  <AlertDialogAction onClick={reverse}>Reverse</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {b.status === "REVERSED" && <Badge variant="destructive">Reversed</Badge>}
        </div>
      </div>

      <TableSurface>
        {/* Fixed widths + capped text columns so the six columns fit a 13"
            laptop instead of scrolling sideways. From File and Matched To share
            the flexible width and wrap; the numeric columns stay tight. */}
        <Table className="w-full table-fixed">
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead>From File</TableHead>
              <TableHead>Matched To</TableHead>
              <TableHead className="w-16 text-right">Qty</TableHead>
              <TableHead className="w-24 text-right">{b.kind === "PURCHASES" ? "Cost" : "Price"}</TableHead>
              <TableHead className="w-24">Date</TableHead>
              <TableHead className="w-28 text-right">{editable ? "Action" : "Status"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              // Rows stay white; a declined row just fades back.
              <TableRow key={row.id} className={cn(row.status === "REJECTED" && "opacity-45")}>
                {/* whitespace-normal is load-bearing: TableCell defaults to
                    whitespace-nowrap, so without it the warning line runs
                    straight across into the Matched To column instead of
                    wrapping inside this one. */}
                <TableCell className="align-top whitespace-normal break-words">
                  <span className="font-medium">{row.itemText}</span>
                  {row.warning && <p className="mt-0.5 text-xs break-words text-warning-text">{row.warning}</p>}
                </TableCell>
                <TableCell>
                  {editable ? (
                    <MatchPicker
                      row={row}
                      kind={b.kind}
                      labelMap={labelMap}
                      onSelect={(k, id) => setMatch(row, k, id)}
                    />
                  ) : (
                    <MatchLabel row={row} labelMap={labelMap} />
                  )}
                </TableCell>
                <TableCell className="tnum text-right">{row.qty ?? "—"}</TableCell>
                <TableCell className="tnum text-right">
                  {money(b.kind === "PURCHASES" ? row.unitCost : row.unitPrice)}
                </TableCell>
                <TableCell className="tnum text-muted-foreground">{row.rowDate ?? "—"}</TableCell>
                <TableCell className="align-top text-right">
                  {editable ? (
                    // Small solid chips: green Approve / red Decline, white text
                    // that stays white on hover. A one-column grid sizes the pair
                    // to the wider label ("Approve") — grid items stretch to the
                    // column, so Decline adopts the same width with no fixed
                    // number, and the stack lines up. Row with no match can't be
                    // approved yet (the From File warning says why).
                    <div className="inline-grid gap-1.5">
                      <Button
                        size="xs"
                        disabled={!row.matchedLocationItemId && !row.matchedMenuItemId}
                        className="bg-success-text text-white hover:bg-success-text/85 hover:text-white"
                        onClick={() => setStatus(row, row.status === "APPROVED" ? "PENDING" : "APPROVED")}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="destructive"
                        size="xs"
                        onClick={() => setStatus(row, row.status === "REJECTED" ? "PENDING" : "REJECTED")}
                      >
                        Decline
                      </Button>
                    </div>
                  ) : (
                    <div className="text-right">
                      <Badge variant={row.status === "COMMITTED" ? "success" : "outline"}>
                        {ROW_STATUS_LABELS[row.status] ?? row.status}
                      </Badge>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableSurface>
    </div>
  );
}

function MatchLabel({ row, labelMap }: { row: ImportRow; labelMap: Map<string, string> }) {
  const id = row.matchedLocationItemId ?? row.matchedMenuItemId;
  if (!id) return <span className="text-sm text-muted-foreground">— unmatched —</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-sm">
      {row.matchedMenuItemId && <Martini className="size-3.5 shrink-0 text-primary" />}
      <span className="truncate">{labelMap.get(id) ?? "—"}</span>
      {row.matchMethod && (
        <Badge variant="outline" className={cn("ml-1 shrink-0", METHOD_BADGE[row.matchMethod]?.className)}>
          {METHOD_BADGE[row.matchMethod]?.label}
          {row.matchMethod === "FUZZY" && row.confidence != null && ` ${Math.round(row.confidence * 100)}%`}
        </Badge>
      )}
    </span>
  );
}

function MatchPicker({
  row,
  kind,
  labelMap,
  onSelect,
}: {
  row: ImportRow;
  kind: string;
  labelMap: Map<string, string>;
  onSelect: (kind: "item" | "menu", id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const items = useLocationItems();
  const menus = useMenus();
  const currentId = row.matchedLocationItemId ?? row.matchedMenuItemId;
  const readyMenus = kind === "SALES" ? (menus.data ?? []).filter((m) => m.isActive && m.current) : [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          className="h-8 w-full justify-between font-normal"
          title={currentId ? labelMap.get(currentId) : undefined}
        >
          <span className="flex items-center gap-1.5 truncate">
            {currentId ? (
              <>
                {row.matchedMenuItemId && <Martini className="size-3.5 shrink-0 text-primary" />}
                <span className="truncate">{labelMap.get(currentId) ?? "…"}</span>
                {row.matchMethod && (
                  <Badge variant="outline" className={cn("shrink-0", METHOD_BADGE[row.matchMethod]?.className)}>
                    {METHOD_BADGE[row.matchMethod]?.label}
                    {row.matchMethod === "FUZZY" && row.confidence != null && ` ${Math.round(row.confidence * 100)}%`}
                  </Badge>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">Pick an item…</span>
            )}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search…" autoFocus />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            {readyMenus.length > 0 && (
              <CommandGroup heading="Menus">
                {readyMenus.map((menu) => (
                  <CommandItem
                    key={menu.id}
                    value={`menu ${menu.name}`}
                    onSelect={() => {
                      onSelect("menu", menu.id);
                      setOpen(false);
                    }}
                  >
                    <Martini className="size-4 text-primary" />
                    <span className="flex-1 truncate">{menu.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading="Items">
              {(items.data ?? []).map((li) => (
                <CommandItem
                  key={li.id}
                  value={`item ${li.itemVariant.item.name} ${variantLabel(li.itemVariant)}`}
                  onSelect={() => {
                    onSelect("item", li.id);
                    setOpen(false);
                  }}
                >
                  <span className="flex-1 truncate">
                    {li.itemVariant.item.name}
                    <span className="ml-1.5 text-muted-foreground">{variantLabel(li.itemVariant)}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
