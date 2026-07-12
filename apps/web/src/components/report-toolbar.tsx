import { Download, FileSpreadsheet, Printer } from "lucide-react";
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
  // Inline label + input pairs, matching every other page's toolbar (see admin/activity).
  return (
    <>
      <Label htmlFor="range-from" className="text-xs text-muted-foreground">
        From
      </Label>
      <Input
        id="range-from"
        type="date"
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
        className="tnum w-40 bg-background"
        value={to}
        onChange={(e) => onTo(e.target.value)}
      />
    </>
  );
}

/** xlsx + csv download buttons, gated on the reports.export permission. */
export function ExportButtons({
  xlsxUrl,
  csvUrl,
  onPrint,
  disabled,
}: {
  xlsxUrl: string;
  csvUrl: string;
  onPrint?: () => void;
  disabled?: boolean;
}) {
  const me = useMe();
  const role = (me.data?.user.role ?? "READONLY") as Role;
  const canExport = can(role, "reports.export");

  const run = async (url: string) => {
    try {
      await downloadFile(url);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Export failed");
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
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => run(xlsxUrl)}>
            <FileSpreadsheet className="size-4" /> Excel
          </Button>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => run(csvUrl)}>
            <Download className="size-4" /> CSV
          </Button>
        </>
      )}
    </div>
  );
}
