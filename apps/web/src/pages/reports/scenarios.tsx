import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, FlaskConical, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/api/http";
import { useLocationId } from "@/api/location";
import { useCountDates } from "@/api/ops";
import {
  useScenario,
  useScenarioCompare,
  useScenarioMutations,
  useScenarioReport,
  useScenarios,
  type ScenarioKind,
} from "@/api/reports";
import { formatMoney } from "@/lib/utils";
import { ItemCombobox } from "@/components/item-combobox";
import { PageHeader } from "@/components/page-header";
import { QuantityInput } from "@/components/quantity-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { LocationItem } from "@/api/types";
import {
  TableEmpty,
  TableFailure,
  TableLoading,
  TableSurface,
  queryFailed,
} from "@/components/table-surface";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * What-if scenarios (client request I, 2026-08-06 — "This is a case What If
 * pag duda si Client sa unang mga pinasok na data").
 *
 * Keeps the committed beginning and ending counts, replaces the movements in
 * between, and shows what the Full Audit would have said. Nothing here touches
 * a real record: the entries live in their own table and the live report never
 * reads them.
 *
 * The banner is not decoration. A screen showing audit figures that are not the
 * audit figures has exactly one way to go wrong, so it says what it is on every
 * view, in the strongest tone the design system has.
 */

const KIND_LABELS: Record<ScenarioKind, string> = {
  SALE: "Sale",
  NON_REVENUE: "Non-revenue",
  PRODUCTION: "Production",
  PURCHASE: "Delivery",
  FORFEIT: "Returned bottle",
};

function HypotheticalBanner({ name, begin, end }: { name: string; begin: string; end: string }) {
  return (
    <div className="mb-4 rounded-md border border-warning/50 bg-warning/10 px-3 py-2.5 text-sm">
      <span className="font-medium">These are not your real figures.</span> "{name}" is a what-if over{" "}
      <span className="tnum">{begin} → {end}</span>: the real beginning and ending counts, with hypothetical
      movements in between. Nothing here changes an inventory record or any report.
    </div>
  );
}

export function ScenariosPage() {
  const locationId = useLocationId();
  const scenarios = useScenarios();
  const list = scenarios.data?.scenarios ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="What-if Scenarios"
        actions={<NewScenarioDialog />}
      />
      <p className="mb-4 max-w-prose text-sm text-muted-foreground">
        Doubting the data behind a period? Keep its beginning and ending counts, enter the sales, deliveries and
        non-revenue you think are right, and see what the Full Audit would have said. Your real records are never
        touched.
      </p>

      <TableSurface>
        {queryFailed(scenarios) ? (
          <TableFailure query={scenarios} title="Couldn't load scenarios" />
        ) : scenarios.isPending ? (
          <TableLoading rows={4} />
        ) : list.length === 0 ? (
          <TableEmpty
            icon={FlaskConical}
            title="No what-ifs yet"
            description="Start one from a period that has a committed count at both ends."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>Name</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Entries</TableHead>
                <TableHead>Started by</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="tnum">{s.begin} → {s.end}</TableCell>
                  <TableCell className="tnum text-right">{s._count?.entries ?? 0}</TableCell>
                  <TableCell className="text-muted-foreground">{s.createdByName}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="xs" variant="outline">
                      <Link to={`/l/${locationId}/reports/scenarios/${s.id}`}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableSurface>
    </div>
  );
}

function NewScenarioDialog() {
  const [open, setOpen] = useState(false);
  const [begin, setBegin] = useState("");
  const [end, setEnd] = useState("");
  const [name, setName] = useState("");
  const [seed, setSeed] = useState(true);
  const dates = useCountDates();
  const { create } = useScenarioMutations();

  const submit = async () => {
    if (!begin || !end) return toast.error("Pick both count dates");
    if (!name.trim()) return toast.error("Give the scenario a name");
    try {
      const made = await create.mutateAsync({ begin, end, name: name.trim(), seedFromLive: seed });
      toast.success(
        seed
          ? `Started with ${made.seededEntries} real entries copied in — edit them freely`
          : "Started with an empty sheet",
      );
      setOpen(false);
      setName("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not start the scenario");
    }
  };

  const options = dates.data?.dates ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><FlaskConical className="size-4" /> New What-if</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a what-if</DialogTitle>
          <DialogDescription>
            Pick the period. Its committed beginning and ending counts are kept exactly as they are — only the
            movements in between are yours to change.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sc-name">Name</Label>
            <Input
              id="sc-name"
              placeholder="e.g. If the July sales were re-entered"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sc-begin">Beginning count</Label>
              <Select value={begin} onValueChange={setBegin}>
                <SelectTrigger id="sc-begin"><SelectValue placeholder="Pick a date…" /></SelectTrigger>
                <SelectContent>
                  {options.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sc-end">Ending count</Label>
              <Select value={end} onValueChange={setEnd}>
                <SelectTrigger id="sc-end"><SelectValue placeholder="Pick a date…" /></SelectTrigger>
                <SelectContent>
                  {options.filter((d) => !begin || d > begin).map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {/* Both starts exist because they answer different doubts: "the whole
              day's entry is suspect, start again" versus "one of these forty
              lines is wrong and I want to find which". */}
          <div className="flex items-start justify-between gap-3 rounded-md border px-3 py-2.5">
            <Label htmlFor="sc-seed" className="text-sm font-normal">
              Start from the real entries
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Copies the period's actual sales and deliveries in, so you can change the ones you doubt instead of
                retyping everything. Turn off to start from an empty sheet.
              </span>
            </Label>
            <Switch id="sc-seed" checked={seed} onCheckedChange={(v) => setSeed(v === true)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Starting…" : "Start"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ScenarioEditorPage() {
  const { scenarioId } = useParams();
  const locationId = useLocationId();
  const detail = useScenario(scenarioId ?? null);
  const report = useScenarioReport(scenarioId ?? null);
  const compare = useScenarioCompare(scenarioId ?? null);
  const { addEntry, removeEntry, discard } = useScenarioMutations(scenarioId);

  const [kind, setKind] = useState<ScenarioKind>("SALE");
  const [item, setItem] = useState<LocationItem | null>(null);
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState("");

  if (queryFailed(detail)) {
    return (
      <TableSurface>
        <TableFailure query={detail} title="Couldn't load this scenario" />
      </TableSurface>
    );
  }
  if (detail.isPending) return <TableLoading rows={6} />;

  const { scenario, entries } = detail.data!;
  const diff = compare.data?.diff;

  const add = async () => {
    if (!item) return toast.error("Pick an item");
    const q = Number(qty);
    if (!q || q <= 0) return toast.error("Enter a quantity");
    const money = price === "" ? undefined : Number(price);
    try {
      await addEntry.mutateAsync({
        kind,
        locationItemId: item.id,
        businessDate: date || scenario.begin,
        qty: q,
        ...(kind === "PURCHASE" ? { unitCost: money ?? 0 } : { unitPrice: money ?? 0 }),
      });
      setItem(null);
      setQty("");
      setPrice("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add that entry");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to scenarios">
          <Link to={`/l/${locationId}/reports/scenarios`}><ArrowLeft className="size-4" /></Link>
        </Button>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{scenario.name}</h2>
          <p className="text-sm text-muted-foreground tnum">{scenario.begin} → {scenario.end}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() =>
            discard
              .mutateAsync(scenario.id)
              .then(() => toast.success("Discarded"))
              .catch(() => toast.error("Could not discard it"))
          }
        >
          Discard
        </Button>
      </div>

      <HypotheticalBanner name={scenario.name} begin={scenario.begin} end={scenario.end} />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <TableSurface
          filters={
            <div className="grid w-full grid-cols-[8rem_minmax(0,1fr)_6rem_7rem_9rem_auto] items-end gap-2">
              <div className="space-y-2">
                <Label htmlFor="sc-kind">Kind</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as ScenarioKind)}>
                  <SelectTrigger id="sc-kind" className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(KIND_LABELS) as ScenarioKind[]).map((k) => (
                      <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sc-item">Item</Label>
                <ItemCombobox id="sc-item" value={item} onSelect={setItem} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sc-qty">Qty</Label>
                <QuantityInput id="sc-qty" className="tnum bg-background" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sc-price">{kind === "PURCHASE" ? "Unit cost" : "Unit price"}</Label>
                <QuantityInput id="sc-price" className="tnum bg-background" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sc-date">Date</Label>
                <Input
                  id="sc-date"
                  type="date"
                  className="tnum bg-background"
                  value={date || scenario.begin}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <Button size="sm" onClick={add} disabled={addEntry.isPending}>Add</Button>
            </div>
          }
        >
          {entries.length === 0 ? (
            <TableEmpty
              title="No movements in this what-if"
              description="With nothing here, the report below shows what the period would look like if nothing had been sold or delivered at all."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="w-36">Kind</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead className="w-20 text-right">Qty</TableHead>
                  <TableHead className="w-28 text-right">Each</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell><Badge variant="outline">{KIND_LABELS[e.kind]}</Badge></TableCell>
                    <TableCell>{e.itemName}</TableCell>
                    <TableCell className="tnum">{e.businessDate}</TableCell>
                    <TableCell className="tnum text-right">{e.qty}</TableCell>
                    <TableCell className="tnum text-right">
                      {e.unitCost !== null ? formatMoney(e.unitCost) : e.unitPrice !== null ? formatMoney(e.unitPrice) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${e.itemName}`}
                        onClick={() =>
                          removeEntry.mutateAsync(e.id).catch(() => toast.error("Could not remove that entry"))
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TableSurface>

        <section>
          <h2 className="mb-2 text-sm font-semibold">What this would change</h2>
          <p className="mb-2 text-sm text-muted-foreground">
            The real report against this what-if, item by item. Same comparison the Full Audit's version history
            uses.
          </p>
          <TableSurface>
            {compare.isPending ? (
              <TableLoading rows={4} />
            ) : !diff || diff.summary.identical ? (
              <TableEmpty
                title="No difference yet"
                description="This what-if currently produces the same figures as the real report."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead>Item</TableHead>
                    <TableHead>Figure</TableHead>
                    <TableHead className="text-right">Real</TableHead>
                    <TableHead className="text-right">What-if</TableHead>
                    <TableHead className="text-right">Δ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {diff.rows.slice(0, 60).map((row) =>
                    row.fields.map((f, i) => (
                      <TableRow key={`${row.locationItemId}-${f.field}`}>
                        <TableCell className={i === 0 ? "font-medium" : ""}>{i === 0 ? row.itemName : ""}</TableCell>
                        <TableCell className={f.field === "variance" ? "font-medium" : undefined}>{f.field}</TableCell>
                        <TableCell className="tnum text-right">{f.a === null ? "—" : Math.round(f.a * 100) / 100}</TableCell>
                        <TableCell className="tnum text-right">{f.b === null ? "—" : Math.round(f.b * 100) / 100}</TableCell>
                        <TableCell className={f.delta < 0 ? "tnum text-right font-medium text-destructive" : "tnum text-right font-medium"}>
                          {f.delta > 0 ? "+" : ""}{Math.round(f.delta * 100) / 100}
                        </TableCell>
                      </TableRow>
                    )),
                  )}
                </TableBody>
              </Table>
            )}
          </TableSurface>
          {report.data && (
            <p className="mt-2 text-xs text-muted-foreground">
              What-if totals — over/short at cost {formatMoney(report.data.report.totals.varianceCost)}, revenue{" "}
              {formatMoney(report.data.report.totals.revenue)}.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
