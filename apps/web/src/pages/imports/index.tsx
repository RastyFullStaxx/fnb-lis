import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { FileInput, Info, Upload } from "lucide-react";
import { toast } from "sonner";
import { useMe } from "@/api/auth";
import { useLocationId } from "@/api/location";
import { useImportBatches, useUploadImport, type ImportKind } from "@/api/imports";
import { ApiError } from "@/api/http";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const KIND_LABELS: Record<string, string> = {
  SALES: "Sales",
  PURCHASES: "Purchases",
  NON_REVENUE: "Non-revenue",
  COUNTS: "Counts",
};

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  NEEDS_REVIEW: { label: "Needs review", variant: "default" },
  COMMITTED: { label: "Committed", variant: "secondary" },
  REVERSED: { label: "Reversed", variant: "outline" },
  FAILED: { label: "Failed", variant: "destructive" },
  PROCESSING: { label: "Processing", variant: "outline" },
};

export function ImportsPage() {
  const batches = useImportBatches();
  const locationId = useLocationId();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Imports"
        description="Drop a POS export or supplier file. The system extracts and matches rows; you review before anything touches inventory."
      />

      <UploadCard />

      <h3 className="mt-8 mb-3 text-sm font-semibold">Recent imports</h3>
      {batches.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : (batches.data ?? []).length === 0 ? (
        <EmptyState icon={FileInput} title="No imports yet" description="Upload a CSV or Excel file above to get started." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>File</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead>Uploaded by</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.data!.map((b) => (
                <TableRow key={b.id} className={cn(b.status === "REVERSED" && "opacity-60")}>
                  <TableCell className="max-w-56 truncate font-medium">{b.fileName}</TableCell>
                  <TableCell className="text-muted-foreground">{KIND_LABELS[b.kind] ?? b.kind}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.sourceType}
                    {b.extractor === "AI" && <Badge variant="outline" className="ml-1.5">AI</Badge>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[b.status]?.variant ?? "outline"}>
                      {STATUS_BADGE[b.status]?.label ?? b.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="tnum text-right">{b._count?.rows ?? 0}</TableCell>
                  <TableCell className="text-muted-foreground">{b.createdByName}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/l/${locationId}/imports/${b.id}`}>
                        {b.status === "NEEDS_REVIEW" ? "Review" : "View"}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function UploadCard() {
  const me = useMe();
  const navigate = useNavigate();
  const locationId = useLocationId();
  const upload = useUploadImport();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ImportKind>("SALES");
  const [dragOver, setDragOver] = useState(false);

  const aiEnabled = me.data?.features.aiEnabled ?? false;

  const doUpload = async (file: File) => {
    try {
      const result = await upload.mutateAsync({ kind, file });
      if (result.warnings.length > 0) result.warnings.forEach((w) => toast.warning(w));
      toast.success("File processed — review the extracted rows");
      navigate(`/l/${locationId}/imports/${result.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Upload failed");
    }
  };

  return (
    <div className="rounded-lg border p-5">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Import type</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as ImportKind)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SALES">Sales</SelectItem>
              <SelectItem value="PURCHASES">Purchases</SelectItem>
              <SelectItem value="NON_REVENUE">Non-revenue</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) doUpload(file);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-10 text-center transition-colors",
          dragOver ? "border-primary bg-primary/5" : "hover:border-primary/40",
        )}
      >
        <Upload className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">
          {upload.isPending ? "Processing…" : "Drop a file here, or click to choose"}
        </p>
        <p className="text-xs text-muted-foreground">CSV and Excel supported{aiEnabled ? " · PDF and images via AI" : ""}</p>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={aiEnabled ? ".csv,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp" : ".csv,.xlsx,.xls"}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) doUpload(file);
            e.target.value = "";
          }}
        />
      </div>

      {!aiEnabled && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          PDF and image import needs the AI extractor. Add <code className="mx-1 rounded bg-muted px-1 font-mono">ANTHROPIC_API_KEY</code>
          to the server to enable it — CSV and Excel work without it.
        </p>
      )}
    </div>
  );
}
