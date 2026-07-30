import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2, Lock, Printer } from "lucide-react";
import { toast } from "sonner";
import { can, type Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { useLocationId } from "@/api/location";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { downloadFile, ApiError } from "@/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToolbarField } from "@/components/table-surface";

export function DateRangeControl({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  const inverted = Boolean(from && to && from > to);
  // From and To live in ONE flex unit, not as two loose toolbar items. Loose,
  // they wrap independently — on a narrow strip From stays up top and To
  // orphans onto a second row on its own. As a unit the pair always wraps
  // together, so a strip that must break reads as clean rows (e.g. Reason /
  // From-To) instead of a stray input. Captions stack over each input.
  return (
    <div className="flex items-end gap-3">
      <ToolbarField label="From" htmlFor="range-from">
        <Input
          id="range-from"
          type="date"
          max={to || undefined}
          className="tnum w-[8.5rem] bg-background"
          value={from}
          onChange={(e) => onFrom(e.target.value)}
        />
      </ToolbarField>
      <ToolbarField label="To" htmlFor="range-to">
        <Input
          id="range-to"
          type="date"
          min={from || undefined}
          className="tnum w-[8.5rem] bg-background"
          value={to}
          onChange={(e) => onTo(e.target.value)}
        />
      </ToolbarField>
      {inverted && (
        <p className="pb-2 text-xs text-destructive" role="alert">
          From is after To — swap the dates to see results.
        </p>
      )}
    </div>
  );
}

/** xlsx + csv (+ optional pdf) download buttons, gated on reports.export. */
export function ExportButtons({
  xlsxUrl,
  csvUrl,
  pdfUrl,
  onPrint,
  disabled,
}: {
  xlsxUrl: string;
  csvUrl: string;
  pdfUrl?: string;
  onPrint?: () => void;
  disabled?: boolean;
}) {
  const me = useMe();
  const locationId = useLocationId();
  const role = (me.data?.user.role ?? "AUDIT_VIEWER_LIMITED") as Role;
  // Three independent gates, and the user deserves to know WHICH one applies:
  // the role, the admin's per-client switch, and the billing lockout. Hidden
  // buttons with no explanation was the previous behaviour.
  const client = me.data?.clients.find((c) => c.locations.some((l) => l.id === locationId));
  const downloads = client?.reportDownloads ?? "ALLOWED";
  const canExport = can(role, "reports.export") && downloads === "ALLOWED";
  const blockedReason =
    can(role, "reports.export") && downloads !== "ALLOWED"
      ? downloads === "PAST_DUE"
        ? "Downloads are paused while this establishment's subscription is past due — reports stay viewable on screen."
        : "Report downloads are turned off for this establishment by your LIS administrator."
      : null;
  // Slow workbooks invite double-clicks — disable every button while one runs.
  const [running, setRunning] = useState<"xlsx" | "csv" | "pdf" | null>(null);

  const run = async (kind: "xlsx" | "csv" | "pdf", url: string) => {
    setRunning(kind);
    try {
      await downloadFile(url);
      toast.success("Export ready");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="flex items-center gap-2 print:hidden">
      {onPrint && (
        <Button variant="outline" size="sm" onClick={onPrint}>
          <Printer className="size-4" /> Print
        </Button>
      )}
      {blockedReason && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-help items-center gap-1 text-xs text-muted-foreground">
                <Lock className="size-3.5" /> Download unavailable
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{blockedReason}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {canExport && (
        <>
          <Button variant="outline" size="sm" disabled={disabled || running !== null} onClick={() => void run("xlsx", xlsxUrl)}>
            {running === "xlsx" ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />} Excel
          </Button>
          <Button variant="outline" size="sm" disabled={disabled || running !== null} onClick={() => void run("csv", csvUrl)}>
            {running === "csv" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} CSV
          </Button>
          {pdfUrl && (
            <Button variant="outline" size="sm" disabled={disabled || running !== null} onClick={() => void run("pdf", pdfUrl)}>
              {running === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />} PDF
            </Button>
          )}
        </>
      )}
    </div>
  );
}
