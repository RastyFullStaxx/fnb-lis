import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Check, ChevronsUpDown, Martini, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { useLocationId, useLocationItems } from "@/api/location";
import { useMenus } from "@/api/menus";
import { useImportBatch, useImportRowMutations, type ImportRow } from "@/api/imports";
import { variantLabel } from "@/api/types";
import { ApiError } from "@/api/http";
import { FullPageSpinner } from "@/components/full-page-spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  FUZZY: { label: "Fuzzy", className: "border-warning text-warning" },
  MANUAL: { label: "Manual", className: "border-primary text-primary" },
};

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

  if (batch.isPending) return <FullPageSpinner />;
  if (batch.isError || !batch.data) return <FullPageSpinner error="Import batch not found." />;

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

  const approveAllMatched = async () => {
    for (const row of rows) {
      if (row.status !== "REJECTED" && (row.matchedLocationItemId || row.matchedMenuItemId) && row.status !== "APPROVED") {
        await setStatus(row, "APPROVED");
      }
    }
  };
  const rejectUnmatched = async () => {
    for (const row of rows) {
      if (!row.matchedLocationItemId && !row.matchedMenuItemId && row.status !== "REJECTED") {
        await setStatus(row, "REJECTED");
      }
    }
  };

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
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to imports">
          <Link to={`/l/${locationId}/imports`}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight">{b.fileName}</h2>
          <p className="text-sm text-muted-foreground">
            {b.kind} · {b.sourceType}
            {b.extractor === "AI" && " · AI-extracted"} · {rows.length} rows
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {editable && (
            <>
              <Button variant="outline" size="sm" onClick={approveAllMatched}>
                Approve matched
              </Button>
              <Button variant="outline" size="sm" onClick={rejectUnmatched}>
                Reject unmatched
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" disabled={approvedCount === 0}>
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
                    <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
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
                  <Undo2 className="size-4" /> Reverse batch
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
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction onClick={reverse}>Reverse</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {b.status === "REVERSED" && <Badge variant="outline">Reversed</Badge>}
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead>From file</TableHead>
              <TableHead>Matched to</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">{b.kind === "PURCHASES" ? "Cost" : "Price"}</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="w-28 text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={cn(row.status === "REJECTED" && "opacity-45")}>
                <TableCell>
                  <span className="font-medium">{row.itemText}</span>
                  {row.warning && <p className="text-xs text-warning">{row.warning}</p>}
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
                  {b.kind === "PURCHASES" ? (row.unitCost ?? "—") : (row.unitPrice ?? "—")}
                </TableCell>
                <TableCell className="tnum text-muted-foreground">{row.rowDate ?? "—"}</TableCell>
                <TableCell className="text-right">
                  {editable ? (
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant={row.status === "APPROVED" ? "default" : "ghost"}
                        size="icon"
                        className="size-7"
                        aria-label="Approve"
                        disabled={!row.matchedLocationItemId && !row.matchedMenuItemId}
                        onClick={() => setStatus(row, row.status === "APPROVED" ? "PENDING" : "APPROVED")}
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        variant={row.status === "REJECTED" ? "destructive" : "ghost"}
                        size="icon"
                        className="size-7"
                        aria-label="Reject"
                        onClick={() => setStatus(row, row.status === "REJECTED" ? "PENDING" : "REJECTED")}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <Badge variant={row.status === "COMMITTED" ? "secondary" : "outline"}>{row.status}</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MatchLabel({ row, labelMap }: { row: ImportRow; labelMap: Map<string, string> }) {
  const id = row.matchedLocationItemId ?? row.matchedMenuItemId;
  if (!id) return <span className="text-sm text-muted-foreground">— unmatched —</span>;
  return (
    <span className="flex items-center gap-1.5 text-sm">
      {row.matchedMenuItemId && <Martini className="size-3.5 text-primary" />}
      {labelMap.get(id) ?? "—"}
      {row.matchMethod && (
        <Badge variant="outline" className={cn("ml-1", METHOD_BADGE[row.matchMethod]?.className)}>
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
        <Button variant="outline" size="sm" role="combobox" className="h-8 max-w-72 justify-between font-normal">
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
