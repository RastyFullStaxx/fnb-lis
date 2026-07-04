import { useState } from "react";
import { Building2, MapPin, Plus } from "lucide-react";
import { toast } from "sonner";
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
        description="Each client owns its own catalog, suppliers, and locations. Add a client, then give it locations."
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
          {clients.data!.map((client) => (
            <Card key={client.id} className={client.status !== "ACTIVE" ? "opacity-60" : undefined}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{client.name}</CardTitle>
                  {client.status !== "ACTIVE" && <Badge variant="outline">Archived</Badge>}
                  <span className="text-xs text-muted-foreground">
                    {client.access.length} user{client.access.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setRenaming(client)}>
                    Rename
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setAddingTo(client)}>
                    <Plus className="size-4" /> Location
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {client.locations.map((loc) => (
                    <span
                      key={loc.id}
                      className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-sm"
                    >
                      <MapPin className="size-3.5 text-muted-foreground" />
                      {loc.name}
                    </span>
                  ))}
                  {client.locations.length === 0 && (
                    <p className="text-sm text-muted-foreground">No locations yet.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
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
          <DialogDescription>A starter "Main" location is created automatically.</DialogDescription>
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

  return (
    <Dialog open={client !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add location</DialogTitle>
          <DialogDescription>New location for {client?.name}.</DialogDescription>
        </DialogHeader>
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
