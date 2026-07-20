import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { can, type Role } from "@fnb/core";
import { useMe } from "@/api/auth";
import { downloadFile, ApiError } from "@/api/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  // Inline label + input pairs, matching every other page's toolbar (see admin/activity).
  return (
    <>
      <Label htmlFor="range-from" className="text-xs text-muted-foreground">
        From
      </Label>
      <Input
        id="range-from"
        type="date"
        max={to || undefined}
        className="tnum w-40 bg-background"
        value={from}
        onChange={(e) => onFrom(e.target.value)}
      />
      <Label htmlFor="range-to" className="text-xs text-muted-foreground">
        To
      </Label>
      <Input
        id="range-to"
        type="date"
        min={from || undefined}
        className="tnum w-40 bg-background"
        value={to}
        onChange={(e) => onTo(e.target.value)}
      />
      {inverted && (
        <p className="text-xs text-destructive" role="alert">
          From is after To — swap the dates to see results.
        </p>
      )}
    </>
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
  const role = (me.data?.user.role ?? "READONLY") as Role;
  const canExport = can(role, "reports.export");
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
