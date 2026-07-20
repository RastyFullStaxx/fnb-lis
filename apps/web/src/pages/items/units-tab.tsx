import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Ruler } from "lucide-react";
import { toast } from "sonner";
import { unitCreate, type UnitCreate } from "@fnb/core";
import { useCreateUnit, useUnits } from "@/api/master";
import { ApiError } from "@/api/http";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuantityInput } from "@/components/quantity-input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { TableLoading, TableEmpty } from "@/components/table-surface";

const KIND_LABELS: Record<string, { label: string; base: string }> = {
  VOLUME: { label: "Volume", base: "ml" },
  MASS: { label: "Mass", base: "g" },
  COUNT: { label: "Count", base: "unit" },
};

export function UnitsTab({
  createOpen,
  setCreateOpen,
}: {
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
}) {
  const units = useUnits();

  return (
    <>
      {units.isPending ? (
        <TableLoading />
      ) : (units.data ?? []).length === 0 ? (
        <TableEmpty
          icon={Ruler}
          title="No units yet"
          description="Add a unit with its factor to the base (ml, g, or 1)."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> New Unit
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead>Unit</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead className="text-right">Factor to Base</TableHead>
              <TableHead className="text-right">Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {units.data!.map((unit) => (
              <TableRow key={unit.id}>
                <TableCell className="font-medium">{unit.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {KIND_LABELS[unit.kind]?.label ?? unit.kind}
                </TableCell>
                <TableCell className="tnum text-right">
                  {unit.factorToBase.toLocaleString("en-PH")} {KIND_LABELS[unit.kind]?.base}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant={unit.isSystem ? "secondary" : "outline"}>
                    {unit.isSystem ? "System" : "Custom"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <UnitDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function UnitDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const createUnit = useCreateUnit();
  const form = useForm<UnitCreate>({
    resolver: zodResolver(unitCreate),
    defaultValues: { name: "", kind: "COUNT", factorToBase: 1 },
  });
  const kind = form.watch("kind");

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await createUnit.mutateAsync(values);
      toast.success(`Unit "${values.name}" added`);
      form.reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the unit");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Unit</DialogTitle>
          <DialogDescription>
            Example: a "keg" that holds 30,000 ml is kind Volume with factor 30000.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="unit-name">Name</Label>
            <Input id="unit-name" autoFocus {...form.register("name")} />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="unit-kind">Kind</Label>
            <Select
              value={kind}
              onValueChange={(v) => form.setValue("kind", v as UnitCreate["kind"], { shouldValidate: true })}
            >
              <SelectTrigger id="unit-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="VOLUME">Volume (base: ml)</SelectItem>
                <SelectItem value="MASS">Mass (base: g)</SelectItem>
                <SelectItem value="COUNT">Count (base: 1)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="unit-factor">Factor to base ({KIND_LABELS[kind]?.base})</Label>
            <QuantityInput
              id="unit-factor"
              className="tnum"
              {...form.register("factorToBase", { valueAsNumber: true })}
            />
            {form.formState.errors.factorToBase && (
              <p className="text-sm text-destructive">Enter a positive factor</p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createUnit.isPending}>
              Add Unit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
