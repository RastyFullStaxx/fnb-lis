import { useState } from "react";
import { useSearchParams } from "react-router";
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

const STATUSES = ["ACTIVE", "CLAIMED", "FORFEITED", "VOID"] as const;

/**
 * What each status looks like, and why.
 *
 * Four outcomes that mean four different things, so they must not share one
 * grey pill — a glance down this column is how somebody finds the row that
 * needs them.
 *
 *  - Overdue    destructive  the only row that wants action today
 *  - On keep    outline      normal, quiet, the majority
 *  - Claimed    success      resolved the way everyone wanted
 *  - Forfeited  warning      resolved, but the guest lost the bottle and stock
 *                            moved — not a failure, not a non-event either
 *  - Void       secondary    recorded in error; deliberately the dullest thing
 *                            on screen, and it counts toward nothing
 *
 * Colour is never the only carrier: each returns its own words too, so this
 * still reads correctly in the printed sheet and to anyone who cannot
 * distinguish the hues.
 */
function statusLook(
  status: string,
  dueForForfeit: boolean,
): { label: string; variant: "outline" | "success" | "warning" | "destructive" | "secondary" } {
  if (status === "ACTIVE") {
    return dueForForfeit
      ? { label: "Overdue", variant: "destructive" }
      : { label: "On keep", variant: "outline" };
  }
  if (status === "CLAIMED") return { label: "Claimed", variant: "success" };
  if (status === "FORFEITED") return { label: "Forfeited", variant: "warning" };
  return { label: "Void", variant: "secondary" };
}

export function BottleKeepPage() {
  const location = useCurrentLocation();
  const [params] = useSearchParams();
  // Deep-linked from the attention bell, same pattern as `stock?missingPrices=1`.
  // A badge that says "3 bottles are overdue" has to land on those 3 — dropping
  // someone into a 50-row register to find them is a search task, not a fix.
  const [status, setStatus] = useState<string>(() => params.get("status") ?? "ACTIVE");
  const [customer, setCustomer] = useState("");
  // OVERDUE is not a stored status — it is ACTIVE plus a date that has passed,
  // which only the server can judge. So it is sent as ACTIVE and narrowed here
  // using the server's own `dueForForfeit`, rather than this screen re-deriving
  // "is it past today" against a possibly-wrong local clock.
  const overdueOnly = status === "OVERDUE";
  const report = useBottleKeeps({
    status: status === "ALL" ? undefined : overdueOnly ? "ACTIVE" : status,
    customer: customer || undefined,
  });
  const { claim, forfeit } = useBottleKeepMutations();

  const data = report.data
    ? overdueOnly
      ? { ...report.data, rows: report.data.rows.filter((r) => r.dueForForfeit) }
      : report.data
    : undefined;

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
              {data.totals.dueForForfeit === 1
                ? "1 bottle has passed its keep date."
                : `${data.totals.dueForForfeit} bottles have passed their keep date.`}
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
                  <SelectItem value="OVERDUE">Overdue</SelectItem>
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
            title={overdueOnly ? "Nothing overdue" : "No bottles on keep"}
            description={
              overdueOnly
                ? "Every bottle on keep is still within the date it was promised for."
                : "A bottle a guest paid for and left to finish next visit is recorded here, and stays out of sellable stock until it expires."
            }
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
                <TableRow key={r.id} className={r.status === "VOID" ? "opacity-55" : undefined}>
                  <TableCell className={r.status === "VOID" ? "font-medium line-through" : "font-medium"}>
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
                    {(() => {
                      const look = statusLook(r.status, r.dueForForfeit);
                      return <Badge variant={look.variant}>{look.label}</Badge>;
                    })()}
                  </TableCell>
                  <TableCell className="text-right print:hidden">
                    {r.status === "ACTIVE" && (
                      <div className="flex justify-end gap-1">
                        {/* "Mark claimed", not "Claimed": a button says what
                            pressing it DOES. "Claimed" reads as the row's
                            current state, so it looks like a label that has
                            somehow become clickable. */}
                        <Button size="xs" variant="outline" onClick={() => void act("claim", r.id, r.customerName)}>
                          Mark Claimed
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
                            Forfeit now
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
            {/* Says so out loud because it looks wrong otherwise: filtered to
                Overdue, a one-row table sat directly above "3 bottles on
                record" and read as a contradiction rather than as two
                different questions. */}
            {status !== "ALL" && " Counts every bottle at this location, not just the filtered list above."}
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
