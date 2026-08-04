import { useState } from "react";
import { AlertTriangle, Printer, Wine } from "lucide-react";
import { toast } from "sonner";
import { useBottleKeepMutations, useBottleKeeps, useCurrentLocation } from "@/api/location";
import { ApiError } from "@/api/http";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TableEmpty,
  TableFailure,
  TableLoading,
  TableSurface,
  ToolbarField,
  queryFailed,
} from "@/components/table-surface";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Bottle Keep register and Forfeited Inventory report (client req 2026-08-04).
 *
 * **One row per bottle.** The client's own question decides the shape: "what if
 * may 10 bottles Jack Daniel's na different or same date ang entry for Bottle
 * Keeps but different name of client guest". Ten bottles under ten guests are
 * ten rows — a quantity of ten could not say whose is whose, when each expires,
 * or which was claimed on Tuesday. The per-customer roll-up sits alongside, for
 * his "number of Bottle Keep under client name".
 *
 * Overdue is computed by the server against today, so this list cannot drift
 * out of date while a tab is left open overnight.
 */

const STATUSES = ["ACTIVE", "CLAIMED", "FORFEITED"] as const;

export function BottleKeepPage() {
  const location = useCurrentLocation();
  const [status, setStatus] = useState<string>("ACTIVE");
  const [customer, setCustomer] = useState("");
  const report = useBottleKeeps({ status: status === "ALL" ? undefined : status, customer: customer || undefined });
  const { claim, forfeit } = useBottleKeepMutations();

  const data = report.data;

  const act = async (kind: "claim" | "forfeit", id: string, who: string) => {
    try {
      if (kind === "claim") {
        await claim.mutateAsync(id);
        toast.success(`Marked ${who}'s bottle as claimed`);
      } else {
        await forfeit.mutateAsync(id);
        toast.success(`Forfeited — returned to stock at zero cost`);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update this bottle");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Bottle Keep & Forfeited Inventory"
        actions={
          <Button variant="outline" onClick={() => window.print()} className="print:hidden">
            <Printer className="size-4" /> Print
          </Button>
        }
      />

      {data && data.totals.dueForForfeit > 0 && (
        // The alert the client asked for. Stated as a count with the action
        // spelled out, because "3 bottles" alone does not tell anyone what
        // happens next or that it needs a person to agree to it.
        <div className="mb-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 print:hidden">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-foreground" />
          <p className="text-sm">
            <span className="font-medium">
              {data.totals.dueForForfeit} {data.totals.dueForForfeit === 1 ? "bottle has" : "bottles have"} passed
              their keep date.
            </span>{" "}
            Forfeiting one returns it to bar stock at zero cost. Nothing moves until someone here says so.
          </p>
        </div>
      )}

      <TableSurface
        filters={
          <>
            <ToolbarField label="Status" htmlFor="bk-status">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="bk-status" className="w-40 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ToolbarField>
            <ToolbarField label="Customer" htmlFor="bk-customer" grow>
              <Input
                id="bk-customer"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                placeholder="Find a guest's bottles…"
                className="bg-background"
              />
            </ToolbarField>
          </>
        }
      >
        {queryFailed(report) ? (
          <TableFailure query={report} title="Couldn't load bottle keeps" />
        ) : report.isPending ? (
          <TableLoading />
        ) : !data || data.rows.length === 0 ? (
          <TableEmpty
            icon={Wine}
            title="No bottles on keep"
            description="A bottle a guest paid for and left to finish next visit is recorded here, and stays out of sellable stock until it expires."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Customer</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Where</TableHead>
                <TableHead>Kept</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right print:hidden">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.customerName}
                    {r.customerContact && (
                      <span className="ml-2 text-xs text-muted-foreground">{r.customerContact}</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[18rem] break-words">
                    {r.locationItem.itemVariant.item.name}{" "}
                    <span className="text-muted-foreground">
                      {r.locationItem.itemVariant.size ?? ""} {r.locationItem.itemVariant.unit?.name ?? ""}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.area?.name ?? "—"}</TableCell>
                  <TableCell className="tnum">{formatDate(r.keptDate)}</TableCell>
                  <TableCell className="tnum">
                    {formatDate(r.expiresOn)}
                    {r.status === "ACTIVE" && (
                      <span
                        className={
                          r.dueForForfeit ? "ml-2 text-xs text-destructive" : "ml-2 text-xs text-muted-foreground"
                        }
                      >
                        {r.dueForForfeit
                          ? `${Math.abs(r.daysLeft)}d overdue`
                          : `${r.daysLeft}d left`}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.dueForForfeit ? "destructive" : "outline"}>
                      {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right print:hidden">
                    {r.status === "ACTIVE" && (
                      <div className="flex justify-end gap-1">
                        <Button size="xs" variant="outline" onClick={() => void act("claim", r.id, r.customerName)}>
                          Claimed
                        </Button>
                        {/* Only offered once it is actually due — the server
                            refuses an early forfeit, and a button that exists
                            only to be rejected is a worse answer than no button. */}
                        {r.dueForForfeit && (
                          <Button
                            size="xs"
                            variant="destructive"
                            onClick={() => void act("forfeit", r.id, r.customerName)}
                          >
                            Forfeit
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableSurface>

      {data && data.byCustomer.length > 0 && (
        <section className="mt-6 break-inside-avoid">
          <h2 className="text-sm font-semibold">Bottles by guest</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The client's own check: how many bottles each guest is holding, and how many are overdue.
          </p>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-1 text-left font-medium">Guest</th>
                <th className="w-[16%] py-1 text-right font-medium">Bottles</th>
                <th className="w-[16%] py-1 text-right font-medium">Still kept</th>
                <th className="w-[16%] py-1 text-right font-medium">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {data.byCustomer.map((c) => (
                <tr key={c.customerName} className="border-b">
                  <td className="py-1.5">{c.customerName}</td>
                  <td className="tnum py-1.5 text-right">{c.bottles}</td>
                  <td className="tnum py-1.5 text-right">{c.active}</td>
                  <td className={c.dueForForfeit > 0 ? "tnum py-1.5 text-right text-destructive" : "tnum py-1.5 text-right"}>
                    {c.dueForForfeit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">
            {location?.name ?? ""} — {data.totals.bottles} bottle{data.totals.bottles === 1 ? "" : "s"} on
            record, {data.totals.active} still kept, {data.totals.dueForForfeit} overdue.
          </p>
        </section>
      )}
    </div>
  );
}
