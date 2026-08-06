import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Copy, History, KeyRound, Package, Plus, RefreshCw, UserCog } from "lucide-react";
import { toast } from "sonner";
import {
  ROLES,
  OWNER_ASSIGNABLE_ROLES,
  PACKAGE_TYPES,
  MODULE_TYPES,
  PACKAGE_LABELS,
  MODULE_TYPE_LABELS,
  type Role,
  type PackageType,
  type ModuleType,
} from "@fnb/core";
import {
  useAdminClients,
  useAdminUsers,
  useCreateUser,
  useUpdateUser,
  useUpdateUserAccess,
  type AdminUser,
} from "@/api/admin";
import { useMe } from "@/api/auth";
import { ApiError } from "@/api/http";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { UserSessionsDialog } from "@/components/user-sessions-dialog";
import { TableEmpty, TableFailure, TableLoading, TableSurface, ToolbarField, ToolbarSearch, queryFailed } from "@/components/table-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  OWNER: "Owns this establishment; hires and disables its staff",
  MANAGER: "Manage catalog, prices, imports, reports",
  STAFF: "Record counts, purchases, sales",
  ACCOUNTANT: "View & export reports",
  AUDIT_VIEWER: "View & download reports",
  AUDIT_VIEWER_LIMITED: "View reports only, no export",
};

// Raw enum values (AUDIT_VIEWER, ACCOUNTANT) are jargon — show plain labels.
const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  OWNER: "Owner",
  MANAGER: "Manager",
  STAFF: "Staff",
  ACCOUNTANT: "Accountant",
  AUDIT_VIEWER: "Audit Viewer",
  AUDIT_VIEWER_LIMITED: "Audit Viewer (View Only)",
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
  // Generated passwords persist in a dialog until explicitly dismissed — a
  // 12-second toast is too easy to miss, and a missed password is unrecoverable.
  const [issued, setIssued] = useState<IssuedPassword | null>(null);
  // Login history dialog target (STAFF/MANAGER/ACCOUNTANT rows only — see the
  // row-action gate below; OWNER/ADMIN rows never offer this trigger).
  const [sessionsFor, setSessionsFor] = useState<AdminUser | null>(null);
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
        : u.clientAccess.some((a) => a.client.subscription?.modules.includes(moduleFilter)));

    // Subscription vs. Standalone — reads each client's actual billingCycle
    // field directly. This is the broad grouping the client asked to monitor
    // separately from exact package tier: recurring subscribers vs. one-time
    // standalone installs. (Fix Plan Phase B: billingCycle is an independent,
    // directly-settable field — no longer implied by packageType — so this
    // must read the real value instead of deriving it.)
    const matchesBilling =
      billingFilter === "ALL" ||
      (billingFilter === "__none__"
        ? u.clientAccess.every((a) => !a.client.subscription)
        : u.clientAccess.some((a) => a.client.subscription?.billingCycle === billingFilter));

    return matchesStatus && matchesSearch && matchesPkg && matchesModule && matchesBilling;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Users"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New User
          </Button>
        }
      />

      <TableSurface
        filters={
          <>
            <ToolbarSearch
              value={search}
              onChange={setSearch}
              placeholder="Search name or username…"
              label="Search"
            />
            <ToolbarField label="Status" htmlFor="users-status">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="users-status" className="w-36 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="DISABLED">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </ToolbarField>
            <ToolbarField label="Billing Type" htmlFor="users-billing">
              <Select value={billingFilter} onValueChange={setBillingFilter}>
                <SelectTrigger id="users-billing" className="w-40 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Billing Types</SelectItem>
                  <SelectItem value="__none__">No Package</SelectItem>
                  <SelectItem value="MONTHLY">Subscription</SelectItem>
                  <SelectItem value="STANDALONE">Standalone</SelectItem>
                </SelectContent>
              </Select>
            </ToolbarField>
            {/* Stays w-44: "One-Time Installation" is the widest option here. */}
            <ToolbarField label="Package" htmlFor="users-package">
              <Select value={pkgFilter} onValueChange={setPkgFilter}>
                <SelectTrigger id="users-package" className="w-44 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Packages</SelectItem>
                  <SelectItem value="__none__">No Package</SelectItem>
                  {PACKAGE_TYPES.map((p) => (
                    <SelectItem key={p} value={p}>{PACKAGE_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ToolbarField>
            <ToolbarField label="Module" htmlFor="users-module">
              <Select value={moduleFilter} onValueChange={setModuleFilter}>
                <SelectTrigger id="users-module" className="w-36 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Modules</SelectItem>
                  <SelectItem value="__none__">No Module</SelectItem>
                  {MODULE_TYPES.map((m) => (
                    <SelectItem key={m} value={m}>{MODULE_TYPE_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ToolbarField>
          </>
        }
      >
        {queryFailed(users) ? (
          <TableFailure query={users} title="Couldn't load users" />
        ) : users.isPending ? (
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
                <TableHead className="w-64">Clients / Packages</TableHead>
                <TableHead className="w-40">Modules</TableHead>
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
                    <Badge variant="secondary">{ROLE_LABELS[u.role] ?? u.role}</Badge>
                  </TableCell>
                  <TableCell className="w-64 text-sm">
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
                              <Badge variant="outline" className="border-primary/30 text-primary">
                                <BadgeCheck />
                                {PACKAGE_LABELS[a.client.subscription.packageType as PackageType] ?? a.client.subscription.packageType}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-muted-foreground">
                                <Package />
                                No package
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="w-40 text-sm">
                    {u.role === "ADMIN" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : u.clientAccess.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="space-y-1">
                        {u.clientAccess.map((a) => (
                          <div key={a.clientId} className="text-xs text-muted-foreground">
                            {a.client.subscription
                              ? a.client.subscription.modules
                                  .map((m) => MODULE_TYPE_LABELS[m as ModuleType] ?? m)
                                  .join(" + ")
                              : "—"}
                          </div>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.status === "ACTIVE" ? "success" : "destructive"}>
                      {u.status === "ACTIVE" ? "Active" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {/* Login history is watched for STAFF, MANAGER, and
                          ACCOUNTANT only (client req 2026-07-29) — OWNER and
                          ADMIN rows never get this trigger. */}
                      {(u.role === "STAFF" || u.role === "MANAGER" || u.role === "ACCOUNTANT") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSessionsFor(u)}
                          title="Login history"
                        >
                          <History className="size-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setEditing(u)}>
                        Edit
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableSurface>

      <CreateUserDialog open={creating} onOpenChange={setCreating} onPassword={setIssued} />
      <EditUserDialog user={editing} onClose={() => setEditing(null)} onPassword={setIssued} />
      <PasswordRevealDialog issued={issued} onClose={() => setIssued(null)} />
      <UserSessionsDialog
        userId={sessionsFor?.id ?? null}
        userLabel={sessionsFor ? `${sessionsFor.firstName} ${sessionsFor.lastName}` : ""}
        onClose={() => setSessionsFor(null)}
      />
    </div>
  );
}

interface IssuedPassword {
  username: string;
  password: string;
}

async function copyPassword(password: string) {
  try {
    await navigator.clipboard.writeText(password);
    toast.success("Password copied");
  } catch {
    toast.error("Couldn't copy — select it manually");
  }
}

/** Shows a freshly generated password until the admin explicitly dismisses it. */
function PasswordRevealDialog({
  issued,
  onClose,
}: {
  issued: IssuedPassword | null;
  onClose: () => void;
}) {
  if (!issued) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Temporary password for @{issued.username}</DialogTitle>
          <DialogDescription>
            Share it securely — it won't be shown again after you close this.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            readOnly
            value={issued.password}
            className="font-mono"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => copyPassword(issued.password)}
            title="Copy"
          >
            <Copy className="size-4" />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  if (queryFailed(clients))
    return (
      <div className="rounded-md border">
        <TableFailure query={clients} title="Couldn't load the client list" className="gap-1.5 px-4 py-6" />
      </div>
    );
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
          <Checkbox
            checked={selected.has(c.id)}
            disabled={disabled}
            onCheckedChange={() => onToggle(c.id)}
          />
          <span className="flex-1">{c.name}</span>
          {c.subscription ? (
            <Badge variant="outline" className="border-primary/30 text-primary">
              <BadgeCheck />
              {PACKAGE_LABELS[c.subscription.packageType as PackageType] ?? c.subscription.packageType}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-muted-foreground">
              <Package />
              No package
            </Badge>
          )}
        </label>
      ))}
    </div>
  );
}

/**
 * Per-user module restriction (client req #9): the 5 packages the client
 * listed — Bar only / Kitchen only / Asset only / Bar+Kitchen / all three —
 * are just subsets of these checkboxes. None checked = unrestricted.
 */
function ModuleCheckboxes({
  selected,
  onToggle,
}: {
  selected: Set<ModuleType>;
  onToggle: (m: ModuleType) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-4 rounded-md border p-2.5">
        {MODULE_TYPES.map((m) => (
          <label key={m} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={selected.has(m)} onCheckedChange={() => onToggle(m)} />
            {MODULE_TYPE_LABELS[m]}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {selected.size === 0
          ? "No restriction — this user works in every module their locations have."
          : `Restricted to ${[...selected].map((m) => MODULE_TYPE_LABELS[m]).join(" + ")} — locations outside that disappear from their switcher.`}
      </p>
    </div>
  );
}

function RoleSelect({ id, value, onChange }: { id: string; value: Role; onChange: (r: Role) => void }) {
  const me = useMe();
  // An owner can only create roles below him — the server enforces the same
  // ceiling (OWNER_ASSIGNABLE_ROLES); this just avoids offering a doomed pick.
  const assignable: readonly Role[] =
    me.data?.user.role === "ADMIN" ? ROLES : (OWNER_ASSIGNABLE_ROLES as readonly Role[]);
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {assignable.map((r) => (
          <SelectItem key={r} value={r}>
            <span className="font-medium">{ROLE_LABELS[r]}</span>
            <span className="ml-2 text-xs text-muted-foreground">{ROLE_HINT[r]}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onPassword,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPassword: (issued: IssuedPassword) => void;
}) {
  const create = useCreateUser();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("STAFF");
  const [password, setPassword] = useState(generatePassword());
  const [clientIds, setClientIds] = useState<Set<string>>(new Set());
  const [modules, setModules] = useState<Set<ModuleType>>(new Set());

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
    setModules(new Set());
  };

  const toggle = (id: string) =>
    setClientIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleModule = (m: ModuleType) =>
    setModules((prev) => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
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
        modules: role === "ADMIN" ? [] : [...modules],
      });
      toast.success(`User @${username.trim()} created`);
      onPassword({ username: username.trim(), password });
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
          <DialogTitle>New User</DialogTitle>
          <DialogDescription>
            A temporary password is generated — the user can keep or change it later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="fn">First Name</Label>
              <Input id="fn" autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ln">Last Name</Label>
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
            <Label htmlFor="nu-password">Password</Label>
            <div className="flex gap-2">
              <Input id="nu-password" value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
              <Button type="button" variant="outline" size="icon" onClick={() => setPassword(generatePassword())} title="Generate">
                <RefreshCw className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => copyPassword(password)}
                title="Copy"
              >
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="nu-role">Role</Label>
            <RoleSelect id="nu-role" value={role} onChange={setRole} />
          </div>
          {role !== "ADMIN" && (
            <div className="space-y-2">
              <Label>Client Access</Label>
              <ClientCheckboxes selected={clientIds} onToggle={toggle} />
            </div>
          )}
          {role !== "ADMIN" && (
            <div className="space-y-2">
              <Label>Module Access</Label>
              <ModuleCheckboxes selected={modules} onToggle={toggleModule} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || create.isPending}>
            Create User
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  onClose,
  onPassword,
}: {
  user: AdminUser | null;
  onClose: () => void;
  onPassword: (issued: IssuedPassword) => void;
}) {
  const update = useUpdateUser();
  const updateAccess = useUpdateUserAccess();
  const [role, setRole] = useState<Role>("STAFF");
  const [resetPw, setResetPw] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [clientIds, setClientIds] = useState<Set<string>>(new Set());
  const [modules, setModules] = useState<Set<ModuleType>>(new Set());

  useEffect(() => {
    if (user) {
      setRole(user.role);
      setClientIds(new Set(user.clientAccess.map((a) => a.clientId)));
      setModules(new Set(user.modules as ModuleType[]));
      setResetPw(null);
    }
  }, [user]);

  const toggle = (id: string) =>
    setClientIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleModule = (m: ModuleType) =>
    setModules((prev) => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
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
      await update.mutateAsync({ id: user.id, role, modules: role === "ADMIN" ? [] : [...modules] });
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
      toast.success("Password reset");
      onPassword({ username: user.username, password: pw });
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
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="eu-role">Role</Label>
            <RoleSelect id="eu-role" value={role} onChange={setRole} />
          </div>

          {role !== "ADMIN" && (
            <div className="space-y-2">
              <Label>Client Access</Label>
              <ClientCheckboxes selected={clientIds} onToggle={toggle} />
            </div>
          )}

          {role !== "ADMIN" && (
            <div className="space-y-2">
              <Label>Module Access</Label>
              <ModuleCheckboxes selected={modules} onToggle={toggleModule} />
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-2 text-sm">
              <KeyRound className="size-4 text-muted-foreground" />
              Reset password
            </div>
            <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)} disabled={update.isPending}>
              Generate & Reset
            </Button>
          </div>
          <ConfirmDialog
            open={confirmReset}
            onOpenChange={setConfirmReset}
            title={`Reset ${user.firstName}'s password?`}
            description="A new temporary password is generated and the current one stops working immediately. Share the new password with the user."
            confirmLabel="Reset Password"
            destructive
            pending={update.isPending}
            onConfirm={() => {
              setConfirmReset(false);
              void doReset();
            }}
          />

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
          <Button variant="ghost" onClick={onClose}>
            Go Back
          </Button>
          <Button onClick={saveRole} disabled={update.isPending || updateAccess.isPending}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
