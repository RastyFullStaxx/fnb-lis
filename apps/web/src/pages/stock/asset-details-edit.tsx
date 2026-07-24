import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { useUpdateLocationItem } from "@/api/location";
import { useConditionOptions, useIndustryOptions, useStatusOptions } from "@/api/master";
import type { LocationItem } from "@/api/types";
import { ApiError } from "@/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QuantityInput } from "@/components/quantity-input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Sentinel for the "Other" branch in the Condition/Status selects — free text lives in its own state. */
const OTHER = "__other__";

/**
 * Click-to-edit the seven Asset-only fields (Phase 2.1/5.1, +Industry
 * client req 2026-07-24: Serial No., Condition, Status, Industry, Initial
 * Cost, Remarks, Asset Code) on a LocationItem.
 *
 * A sibling to `PriceEdit` rather than an extension of it (5.2): this many
 * fields is past the point a `Popover` stays comfortable, and this repo
 * already reaches for `Dialog` at that size (`AttachItemDialog`,
 * `BrandModelEditDialog`). Condition/Status/Industry are Setting-backed
 * dropdowns with a client-side "Other" escape hatch (5.3) — `Other` itself
 * is never a stored literal, only the free-text value the user types after
 * picking it.
 */
export function AssetDetailsEdit({ row, canEdit }: { row: LocationItem; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateLocationItem();
  const conditionOptions = useConditionOptions();
  const statusOptions = useStatusOptions();
  const industryOptions = useIndustryOptions();

  const [serialNo, setSerialNo] = useState("");
  const [condition, setCondition] = useState("");
  const [conditionOther, setConditionOther] = useState("");
  const [status, setStatus] = useState("");
  const [statusOther, setStatusOther] = useState("");
  const [industry, setIndustry] = useState("");
  const [industryOther, setIndustryOther] = useState("");
  const [initialCost, setInitialCost] = useState("");
  const [remarks, setRemarks] = useState("");
  const [assetCode, setAssetCode] = useState("");

  // Re-seed from the row every time the dialog opens (same convention as
  // BrandModelEditDialog) so reopening never shows stale values from a
  // previous edit or a previous row.
  useEffect(() => {
    if (!open) return;
    setSerialNo(row.serialNo ?? "");
    setInitialCost(row.initialCost === null ? "" : String(row.initialCost));
    setRemarks(row.remarks ?? "");
    setAssetCode(row.assetCode ?? "");

    const knownConditions = conditionOptions.data?.conditionOptions ?? [];
    if (row.condition && !knownConditions.includes(row.condition)) {
      setCondition(OTHER);
      setConditionOther(row.condition);
    } else {
      setCondition(row.condition ?? "");
      setConditionOther("");
    }

    const knownStatuses = statusOptions.data?.statusOptions ?? [];
    if (row.status && !knownStatuses.includes(row.status)) {
      setStatus(OTHER);
      setStatusOther(row.status);
    } else {
      setStatus(row.status ?? "");
      setStatusOther("");
    }

    const knownIndustries = industryOptions.data?.industryOptions ?? [];
    if (row.industry && !knownIndustries.includes(row.industry)) {
      setIndustry(OTHER);
      setIndustryOther(row.industry);
    } else {
      setIndustry(row.industry ?? "");
      setIndustryOther("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row.id]);

  const save = async () => {
    try {
      await update.mutateAsync({
        id: row.id,
        serialNo: serialNo.trim() === "" ? null : serialNo.trim(),
        condition: condition === OTHER ? (conditionOther.trim() || null) : condition || null,
        status: status === OTHER ? (statusOther.trim() || null) : status || null,
        industry: industry === OTHER ? (industryOther.trim() || null) : industry || null,
        initialCost: initialCost === "" ? null : Number(initialCost) || 0,
        remarks: remarks.trim() === "" ? null : remarks.trim(),
        assetCode: assetCode.trim() === "" ? null : assetCode.trim(),
      });
      toast.success(`${row.itemVariant.item.name} asset details updated`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save asset details");
    }
  };

  if (!canEdit) {
    return <span className="text-sm text-muted-foreground">{row.assetCode ?? "—"}</span>;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          title="Edit asset details"
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ClipboardList aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span className="tnum">{row.assetCode ?? "Set details"}</span>
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{row.itemVariant.item.name} · Asset Details</DialogTitle>
          <DialogDescription>
            Serial number, condition, status, industry, initial cost, and remarks for this location's register.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`asset-code-${row.id}`} className="text-xs">
              Asset Code
            </Label>
            <Input
              id={`asset-code-${row.id}`}
              value={assetCode}
              onChange={(e) => setAssetCode(e.target.value)}
              placeholder="AST-001"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`serial-${row.id}`} className="text-xs">
              Serial No.
            </Label>
            <Input
              id={`serial-${row.id}`}
              autoFocus
              value={serialNo}
              onChange={(e) => setSerialNo(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`condition-${row.id}`} className="text-xs">
              Condition
            </Label>
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger id={`condition-${row.id}`}>
                <SelectValue placeholder="Select condition" />
              </SelectTrigger>
              <SelectContent>
                {(conditionOptions.data?.conditionOptions ?? []).map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER}>Other…</SelectItem>
              </SelectContent>
            </Select>
            {condition === OTHER && (
              <Input
                className="mt-1.5"
                placeholder="Describe condition"
                value={conditionOther}
                onChange={(e) => setConditionOther(e.target.value)}
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`status-${row.id}`} className="text-xs">
              Status
            </Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id={`status-${row.id}`}>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {(statusOptions.data?.statusOptions ?? []).map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER}>Other…</SelectItem>
              </SelectContent>
            </Select>
            {status === OTHER && (
              <Input
                className="mt-1.5"
                placeholder="Describe status"
                value={statusOther}
                onChange={(e) => setStatusOther(e.target.value)}
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`industry-${row.id}`} className="text-xs">
              Industry
            </Label>
            <Select value={industry} onValueChange={setIndustry}>
              <SelectTrigger id={`industry-${row.id}`}>
                <SelectValue placeholder="Select industry" />
              </SelectTrigger>
              <SelectContent>
                {(industryOptions.data?.industryOptions ?? []).map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER}>Other…</SelectItem>
              </SelectContent>
            </Select>
            {industry === OTHER && (
              <Input
                className="mt-1.5"
                placeholder="Describe industry"
                value={industryOther}
                onChange={(e) => setIndustryOther(e.target.value)}
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`initial-cost-${row.id}`} className="text-xs">
              Initial Cost (optional)
            </Label>
            <QuantityInput
              id={`initial-cost-${row.id}`}
              className="tnum"
              value={initialCost}
              onChange={(e) => setInitialCost(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`remarks-${row.id}`} className="text-xs">
            Remarks
          </Label>
          <Textarea
            id={`remarks-${row.id}`}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save Asset Details"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
