import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Copy, KeyRound, Package, Plus, RefreshCw, UserCog } from "lucide-react";
import { toast } from "sonner";
import {
  ROLES,
  PACKAGE_TYPES,
  INVENTORY_MODULES,
  PACKAGE_LABELS,
  INVENTORY_MODULE_LABELS,
  PACKAGE_BILLING_CYCLE,
  type Role,
  type PackageType,
  type InventoryModule,
  type BillingCycle,
} from "@fnb/core";
import {
  useAdminClients,
  useAdminUsers,
  useCreateUser,
  useUpdateUser,
  useUpdateUserAccess,
  type AdminUser,
} from "@/api/admin";
import { ApiError } from "@/api/http";
import { PageHeader } from "@/components/page-header";
import { TableSurface, TableLoading, TableEmpty, ToolbarSearch } from "@/components/table-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ROLE_HINT: Record<Role, string> = {
  ADMIN: "Full access, all clients",
  MANAGER: "Manage catalog, prices, imports, reports",
  STAFF: "Record counts, purchases, sales",
  ACCOUNTANT: "View & export reports",
  READONLY: "View reports only",
};

function generatePassword(): string {
  const words = ["Audit", "Stock", "Ledger", "Bottle", "Cellar", "Tally", "Cask", "Vault"];
  const arr = new Uint32Array(2);
  crypto.getRandomValues(arr);
  const word = words[arr[0]! % words.length]!;
  const num = (arr[1]! % 9000) + 1000;
  return `${word}!${num}`;
}

export function AdminUsersPage() {
  const users = useAdminUsers();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [pkgFilter, setPkgFilter] = useState("ALL");
  const [moduleFilter, setModuleFilter] = useState("ALL");
  const [billingFilter, setBillingFilter] = useState("ALL");

  const q = search.trim().toLowerCase();
  const filtered = (users.data ?? []).filter((u) => {
    const matchesStatus = status === "ALL" || u.status === status;
    const matchesSearch =
      !q ||
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q);

    // Package / module filters apply per client assignment. Admins aren't
    // exempted here — an admin genuinely assigned to only Bar clients should
    // disappear when filtering to "Kitchen", same as anyone else; that's the
    // whole point of using these filters to monitor who's on what.
    const matchesPkg =
      pkgFilter === "ALL" ||
      (pkgFilter === "__none__"
        ? u.clientAccess.every((a) => !a.client.subscription)
        : u.clientAccess.some((a) => a.client.subscription?.packageType === pkgFilter));

    const matchesModule =
      moduleFilter === "ALL" ||
      (moduleFilter === "__none__"
        ? u.clientAccess.every((a) => !a.client.subscription)
        : u.clientAccess.some((a) => a.client.subscription?.inventoryModules === moduleFilter));

    // Subscription vs. Standalone — derived from each client's package via
    // PACKAGE_BILLING_CYCLE, same source of truth the Clients page uses.
    // This is the broad grouping the client asked to monitor separately from
    // exact package tier: recurring subscribers (Basic/Medium) vs. one-time
    // standalone installs (One-Time).
    const matchesBilling =
      billingFilter === "ALL" ||
      (billingFilter === "__none__"
        ? u.clientAccess.every((a) => !a.client.subscription)
        : u.clientAccess.some((a) => {
            const pkg = a.client.subscription?.packageType as PackageType | undefined;
            return pkg && PACKAGE_BILLING_CYCLE[pkg] === billingFilter;
          }));

    return matchesStatus && matchesSearch && matchesPkg && matchesModule && matchesBilling;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Users"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New user
          </Button>
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarSearch value={search} onChange={setSearch} placeholder="Search name or username…" />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-36 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="DISABLED">Disabled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={billingFilter} onValueChange={setBillingFilter}>
              <SelectTrigger className="w-44 bg-background">
                <SelectValue placeholder="Billing type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All billing types</SelectItem>
                <SelectItem value="__none__">No package</SelectItem>
                <SelectItem value="MONTHLY">Subscription</SelectItem>
                <SelectItem value="STANDALONE">Standalone</SelectItem>
              </SelectContent>
            </Select>
            <Select value={pkgFilter} onValueChange={setPkgFilter}>
              <SelectTrigger className="w-44 bg-background">
                <SelectValue placeholder="Package" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All packages</SelectItem>
                <SelectItem value="__none__">No package</SelectItem>
                {PACKAGE_TYPES.map((p) => (
                  <SelectItem key={p} value={p}>{PACKAGE_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger className="w-52 bg-background">
                <SelectValue placeholder="Module" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All modules</SelectItem>
                <SelectItem value="__none__">No module</SelectItem>
                {INVENTORY_MODULES.map((m) => (
                  <SelectItem key={m} value={m}>{INVENTORY_MODULE_LABELS[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      >
        {users.isPending ? (
          <TableLoading />
        ) : filtered.length === 0 ? (
          <TableEmpty
            icon={UserCog}
            title={(users.data ?? []).length === 0 ? "No users yet" : "Nothing matches the current filter"}
            description={
              (users.data ?? []).length === 0
                ? "Create the first account."
                : "Clear the search or filters to see everyone."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Clients / Packages</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.id} className={u.status === "DISABLED" ? "opacity-60" : undefined}>
                  <TableCell>
                    <div className="font-medium">
                      {u.firstName} {u.lastName}
                    </div>
                    <div className="text-xs text-muted-foreground">@{u.username}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{u.role}</Badge>
                  </TableCell>
                  <TableCell className="max-w-72 text-sm">
                    {u.role === "ADMIN" ? (
                      <span className="text-muted-foreground">All clients (admin)</span>
                    ) : u.clientAccess.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="space-y-1">
                        {u.clientAccess.map((a) => (
                          <div key={a.clientId} className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-muted-foreground">{a.client.name}</span>
                            {a.client.subscription ? (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                                <BadgeCheck className="size-2.5" />
                                {PACKAGE_LABELS[a.client.subscription.packageType as PackageType] ?? a.client.subscription.packageType}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                <Package className="size-2.5" />
                                No pkg
                              </span>
                            )}
                            {a.client.subscription && (
                              <span className="text-xs text-muted-foreground">
                                {INVENTORY_MODULE_LABELS[a.client.subscription.inventoryModules as InventoryModule] ?? a.client.subscription.inventoryModules}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.status === "ACTIVE" ? "secondary" : "outline"}>
                      {u.status === "ACTIVE" ? "Active" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(u)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableSurface>

      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      <EditUserDialog user={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function ClientCheckboxes({
  selected,
  onToggle,
  disabled,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  const clients = useAdminClients();
  if (clients.isPending) return <Skeleton className="h-20 w-full" />;
  if ((clients.data ?? []).length === 0)
    return <p className="text-sm text-muted-foreground">No clients exist yet.</p>;
  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
      {clients.data!.map((c) => (
        <label
          key={c.id}
          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
        >
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={selected.has(c.id)}
            disabled={disabled}
            onChange={() => onToggle(c.id)}
          />
          <span className="flex-1">{c.name}</span>
          {c.subscription ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
              <BadgeCheck className="size-2.5" />
              {PACKAGE_LABELS[c.subscription.packageType as PackageType] ?? c.subscription.packageType}
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              <Package className="size-2.5" />
              No pkg
            </span>
          )}
        </label>
      ))}
    </div>
  );
}

function RoleSelect({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            <span className="font-medium">{r}</span>
            <span className="ml-2 text-xs text-muted-foreground">{ROLE_HINT[r]}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateUser();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("STAFF");
  const [password, setPassword] = useState(generatePassword());
  const [clientIds, setClientIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!usernameEdited) {
      const suggestion = `${firstName}${lastName ? "." + lastName : ""}`
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, "");
      setUsername(suggestion);
    }
  }, [firstName, lastName, usernameEdited]);

  const reset = () => {
    setFirstName("");
    setLastName("");
    setUsername("");
    setUsernameEdited(false);
    setEmail("");
    setRole("STAFF");
    setPassword(generatePassword());
    setClientIds(new Set());
  };

  const toggle = (id: string) =>
    setClientIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const submit = async () => {
    try {
      await create.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: username.trim(),
        email: email.trim() || undefined,
        role,
        password,
        clientIds: role === "ADMIN" ? [] : [...clientIds],
      });
      toast.success(`User @${username.trim()} created`, {
        description: `Temporary password: ${password} — share it securely.`,
        duration: 12000,
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create the user");
    }
  };

  const valid = firstName.trim() && lastName.trim() && username.trim().length >= 3 && password.length >= 8;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
          <DialogDescription>
            A temporary password is generated — the user can keep or change it later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="fn">First name</Label>
              <Input id="fn" autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ln">Last name</Label>
              <Input id="ln" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="un">Username</Label>
              <Input
                id="un"
                value={username}
                onChange={(e) => {
                  setUsernameEdited(true);
                  setUsername(e.target.value);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="em">Email (optional)</Label>
              <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Password</Label>
            <div className="flex gap-2">
              <Input value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
              <Button type="button" variant="outline" size="icon" onClick={() => setPassword(generatePassword())} title="Generate">
                <RefreshCw className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  navigator.clipboard.writeText(password);
                  toast.success("Password copied");
                }}
                title="Copy"
              >
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <RoleSelect value={role} onChange={setRole} />
          </div>
          {role !== "ADMIN" && (
            <div className="space-y-2">
              <Label>Client access</Label>
              <p className="text-xs text-muted-foreground">
                Package badges show each client's subscription tier.
              </p>
              <ClientCheckboxes selected={clientIds} onToggle={toggle} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!valid || create.isPending}>
            Create user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const update = useUpdateUser();
  const updateAccess = useUpdateUserAccess();
  const [role, setRole] = useState<Role>("STAFF");
  const [resetPw, setResetPw] = useState<string | null>(null);
  const [clientIds, setClientIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user) {
      setRole(user.role);
      setClientIds(new Set(user.clientAccess.map((a) => a.clientId)));
      setResetPw(null);
    }
  }, [user]);

  const toggle = (id: string) =>
    setClientIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const dirtyAccess = useMemo(() => {
    if (!user) return false;
    const orig = new Set(user.clientAccess.map((a) => a.clientId));
    return orig.size !== clientIds.size || [...clientIds].some((id) => !orig.has(id));
  }, [user, clientIds]);

  if (!user) return null;

  const saveRole = async () => {
    try {
      await update.mutateAsync({ id: user.id, role });
      if (dirtyAccess && role !== "ADMIN") {
        await updateAccess.mutateAsync({ id: user.id, clientIds: [...clientIds] });
      }
      toast.success("User updated");
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update the user");
    }
  };

  const toggleStatus = async () => {
    const status = user.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    try {
      await update.mutateAsync({ id: user.id, status });
      toast.success(status === "ACTIVE" ? "User enabled" : "User disabled");
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not change status");
    }
  };

  const doReset = async () => {
    const pw = resetPw ?? generatePassword();
    try {
      await update.mutateAsync({ id: user.id, password: pw });
      toast.success("Password reset", { description: `New password: ${pw}`, duration: 12000 });
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not reset the password");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {user.firstName} {user.lastName}{" "}
            <span className="text-sm font-normal text-muted-foreground">@{user.username}</span>
          </DialogTitle>
          <DialogDescription>Change role, client access, status, or reset the password.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Role</Label>
            <RoleSelect value={role} onChange={setRole} />
          </div>

          {role !== "ADMIN" && (
            <div className="space-y-2">
              <Label>Client access</Label>
              <p className="text-xs text-muted-foreground">
                Package badges show each client's subscription tier.
              </p>
              <ClientCheckboxes selected={clientIds} onToggle={toggle} />
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-2 text-sm">
              <KeyRound className="size-4 text-muted-foreground" />
              Reset password
            </div>
            <Button variant="outline" size="sm" onClick={doReset} disabled={update.isPending}>
              Generate & reset
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="text-sm">
              {user.status === "ACTIVE" ? "This account is active." : "This account is disabled."}
            </div>
            <Button
              variant={user.status === "ACTIVE" ? "destructive" : "default"}
              size="sm"
              onClick={toggleStatus}
              disabled={update.isPending}
            >
              {user.status === "ACTIVE" ? "Disable" : "Enable"}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={saveRole} disabled={update.isPending || updateAccess.isPending}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
