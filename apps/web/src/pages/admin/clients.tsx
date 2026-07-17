import { useState } from "react";
import { AlertCircle, BadgeCheck, Building2, MapPin, Package, Plus } from "lucide-react";
import { toast } from "sonner";
import { INVENTORY_MODULE_LABELS, PACKAGE_LABELS, type InventoryModule, type PackageType } from "@fnb/core";
import {
  useAddLocation,
  useAdminClients,
  useCreateClient,
  useUpdateClient,
  type AdminClient,
} from "@/api/admin";
import { ApiError } from "@/api/http";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function AdminClientsPage() {
  const clients = useAdminClients();
  const [creating, setCreating] = useState(false);
  const [addingTo, setAddingTo] = useState<AdminClient | null>(null);
  const [renaming, setRenaming] = useState<AdminClient | null>(null);

  return (
    <div>
      <PageHeader
        title="Clients & locations"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New client
          </Button>
        }
      />

      {clients.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (clients.data ?? []).length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No clients yet"
          description="Create the first client to start onboarding locations and users."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New client
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {clients.data!.map((client) => {
            const sub = client.subscription;
            const activeLocations = client.locations.filter((l) => l.status === "ACTIVE").length;
            const atLimit = sub && sub.maxEntities > 0 && activeLocations >= sub.maxEntities;

            return (
              <Card key={client.id} className={client.status !== "ACTIVE" ? "opacity-60" : undefined}>
                <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-base">{client.name}</CardTitle>
                    {client.status !== "ACTIVE" && <Badge variant="outline">Archived</Badge>}
                    {sub ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        <BadgeCheck className="size-3" />
                        {PACKAGE_LABELS[sub.packageType as PackageType] ?? sub.packageType}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        <Package className="size-3" />
                        No package
                      </span>
                    )}
                    {sub && (
                      <span className="text-xs text-muted-foreground">
                        {INVENTORY_MODULE_LABELS[sub.inventoryModules as InventoryModule] ?? sub.inventoryModules}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {client.access.length} user{client.access.length === 1 ? "" : "s"}
                    </span>
                    {sub && sub.maxEntities > 0 && (
                      <span className={`text-xs ${atLimit ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {activeLocations}/{sub.maxEntities} locations
                      </span>
                    )}
                    {sub && sub.maxEntities === 0 && (
                      <span className="text-xs text-green-600">Unlimited locations</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => setRenaming(client)}>
                      Rename
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAddingTo(client)}
                      disabled={!!atLimit}
                      title={atLimit ? `Package limit reached (${sub!.maxEntities} max)` : undefined}
                    >
                      <Plus className="size-4" /> Location
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {atLimit && (
                    <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      <AlertCircle className="size-3.5 shrink-0" />
                      Location limit reached for <strong>{PACKAGE_LABELS[sub!.packageType as PackageType]}</strong> package. Upgrade to add more.
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {client.locations.map((loc) => (
                      <span
                        key={loc.id}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${
                          loc.status !== "ACTIVE" ? "opacity-50 bg-muted/20" : "bg-muted/40"
                        }`}
                      >
                        <MapPin className="size-3.5 text-muted-foreground" />
                        {loc.name}
                        {loc.status !== "ACTIVE" && (
                          <span className="text-xs text-muted-foreground">(inactive)</span>
                        )}
                      </span>
                    ))}
                    {client.locations.length === 0 && (
                      <p className="text-sm text-muted-foreground">No locations yet.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateClientDialog open={creating} onOpenChange={setCreating} />
      <AddLocationDialog client={addingTo} onClose={() => setAddingTo(null)} />
      <RenameClientDialog client={renaming} onClose={() => setRenaming(null)} />
    </div>
  );
}

function CreateClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateClient();
  const [name, setName] = useState("");

  const submit = async () => {
    try {
      await create.mutateAsync({ name: name.trim() });
      toast.success(`Client "${name.trim()}" created with a "Main" location`);
      setName("");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create the client");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New client</DialogTitle>
          <DialogDescription>
            A starter "Main" location is created automatically. Assign a subscription package afterwards.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="client-name">Client name</Label>
          <Input
            id="client-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()}
          />
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!name.trim() || create.isPending}>
            Create client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddLocationDialog({ client, onClose }: { client: AdminClient | null; onClose: () => void }) {
  const add = useAddLocation();
  const [name, setName] = useState("");

  const submit = async () => {
    if (!client) return;
    try {
      await add.mutateAsync({ clientId: client.id, name: name.trim() });
      toast.success(`Location "${name.trim()}" added to ${client.name}`);
      setName("");
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add the location");
    }
  };

  const sub = client?.subscription;
  const activeLocations = client?.locations.filter((l) => l.status === "ACTIVE").length ?? 0;

  return (
    <Dialog open={client !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add location</DialogTitle>
          <DialogDescription>New location for {client?.name}.</DialogDescription>
        </DialogHeader>
        {sub && sub.maxEntities > 0 && (
          <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            Package: <strong>{PACKAGE_LABELS[sub.packageType as PackageType]}</strong> — using {activeLocations} of {sub.maxEntities} allowed locations.
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="loc-name">Location name</Label>
          <Input
            id="loc-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()}
          />
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!name.trim() || add.isPending}>
            Add location
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameClientDialog({ client, onClose }: { client: AdminClient | null; onClose: () => void }) {
  const update = useUpdateClient();
  const [name, setName] = useState("");

  const submit = async () => {
    if (!client) return;
    try {
      await update.mutateAsync({ id: client.id, name: name.trim() });
      toast.success("Client renamed");
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not rename the client");
    }
  };

  return (
    <Dialog open={client !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename client</DialogTitle>
          <DialogDescription>Current name: {client?.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rename">New name</Label>
          <Input
            id="rename"
            autoFocus
            defaultValue={client?.name ?? ""}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()}
          />
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={update.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
