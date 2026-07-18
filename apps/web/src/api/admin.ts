import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Role } from "@fnb/core";
import { api, post, put } from "./http";

// ── Shapes (mirror apps/server/src/routes/admin.ts) ──

export interface AdminLocation {
  id: string;
  name: string;
  status: string;
  /** This location's OWN modules (Fix Plan §2.3) — the enforced reality, must be a subset of the client's subscription modules. */
  modules: string[];
}

export interface AdminSubscription {
  id: string;
  clientId: string;
  /** Which catalog Plan this was composed from (Fix Plan Phase D §2.2) — traceability only; fields below remain independently overridable. */
  planId: string | null;
  /** Read-only — derived server-side from billingCycle + maxEntities (derivePackageType). Never sent as input. */
  packageType: string;
  billingCycle: string;
  /** The client's licensed ceiling (Fix Plan §2.2) — atomic modules, any non-empty subset. */
  modules: string[];
  maxEntities: number;
  /** Optional per-client/per-deal price, if tracked at all (Fix Plan §4 open question #2). */
  negotiatedPrice: number | null;
  status: string;
  paid: boolean;
  lastPaidAt: string | null;
  startDate: string;
  endDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminClient {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  locations: AdminLocation[];
  access: Array<{ userId: string; clientId: string; user: { id: string; username: string } }>;
  subscription: AdminSubscription | null;
}

/** Raw shape of a module join-table row as returned by the server (SubscriptionModule/LocationModule). */
interface ModuleRow {
  module: string;
}

/** Normalizes the server's `{ modules: [{module}, ...] }` include shape into a flat `string[]`. */
function toModuleList(modules: ModuleRow[] | undefined | null): string[] {
  return modules?.map((m) => m.module) ?? [];
}

interface AdminLocationWire extends Omit<AdminLocation, "modules"> {
  modules?: ModuleRow[];
}
interface AdminSubscriptionWire extends Omit<AdminSubscription, "modules"> {
  modules?: ModuleRow[];
}
interface AdminClientWire extends Omit<AdminClient, "locations" | "subscription"> {
  locations: AdminLocationWire[];
  subscription: AdminSubscriptionWire | null;
}

function normalizeClient(client: AdminClientWire): AdminClient {
  return {
    ...client,
    locations: client.locations.map((l) => ({ ...l, modules: toModuleList(l.modules) })),
    subscription: client.subscription
      ? { ...client.subscription, modules: toModuleList(client.subscription.modules) }
      : null,
  };
}

export interface AdminUserClientAccess {
  clientId: string;
  client: {
    id: string;
    name: string;
    subscription: (Pick<AdminSubscription, "packageType" | "billingCycle" | "status"> & { modules: string[] }) | null;
  };
}

export interface AdminUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string | null;
  role: Role;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
  clientAccess: AdminUserClientAccess[];
}

// ── Access state (compute-on-load mirror of server deriveAccessState) ─────────
// Returns the derived effective access state for display.
// Callers should check sub.status first — CANCELLED/SUSPENDED override this.
export function deriveAccessState(sub: Pick<AdminSubscription, "billingCycle" | "paid" | "lastPaidAt" | "startDate">): "ACTIVE" | "GRACE" | "VIEW_ONLY" {
  const now = new Date();

  if (sub.billingCycle !== "MONTHLY") {
    return sub.paid ? "ACTIVE" : "GRACE";
  }

  // Compute current period due date (same anchor logic as server)
  const anchor = new Date(sub.startDate + "T00:00:00Z");
  const anchorDay = anchor.getUTCDate();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const due =
    anchorDay <= daysInMonth
      ? new Date(Date.UTC(year, month, anchorDay))
      : new Date(Date.UTC(year, month + 1, 1));

  const periodStart = new Date(due);
  periodStart.setUTCMonth(periodStart.getUTCMonth() - 1);

  const lastPaid = sub.lastPaidAt ? new Date(sub.lastPaidAt) : null;
  const paidInPeriod =
    sub.paid &&
    lastPaid !== null &&
    lastPaid >= periodStart &&
    lastPaid <= due;

  if (paidInPeriod) return "ACTIVE";

  const msOverdue = now.getTime() - due.getTime();
  const daysOverdue = msOverdue / (1000 * 60 * 60 * 24);

  if (daysOverdue <= 7) return "GRACE";
  return "VIEW_ONLY";
}

/** Days until due (negative = overdue). Only meaningful for MONTHLY plans. */
export function daysUntilDue(sub: Pick<AdminSubscription, "startDate">): number {
  const now = new Date();
  const anchor = new Date(sub.startDate + "T00:00:00Z");
  const anchorDay = anchor.getUTCDate();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const due =
    anchorDay <= daysInMonth
      ? new Date(Date.UTC(year, month, anchorDay))
      : new Date(Date.UTC(year, month + 1, 1));

  return Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ── Clients & locations ────────────────────────────────────────────────────

export function useAdminClients() {
  return useQuery({
    queryKey: ["admin", "clients"],
    queryFn: async () => (await api<AdminClientWire[]>("/api/admin/clients")).map(normalizeClient),
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string }) => post<AdminClient>("/api/admin/clients", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "clients"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export interface CreateFullClientBody {
  name: string;
  extraLocationNames: string[];
  subscription: {
    /** Which catalog Plan this was composed from (Fix Plan Phase D §2.2) — optional; kept for traceability only. */
    planId?: string | null;
    // packageType is NOT sent — the server derives it from billingCycle + maxEntities.
    billingCycle: string;
    modules: string[];
    maxEntities: number;
    /** Optional per-client deal price, if tracked at all. */
    negotiatedPrice?: number | null;
    startDate: string;
    endDate?: string | null;
    note?: string | null;
  };
}

// One-shot "New client" creation — client + locations + subscription in a
// single atomic request. Used by the New Client modal so the whole form
// submits together, same as /api/admin/clients/full on the server.
export function useCreateFullClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFullClientBody) => post<AdminClientWire>("/api/admin/clients/full", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "clients"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; status?: "ACTIVE" | "ARCHIVED" }) =>
      put<AdminClient>(`/api/admin/clients/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "clients"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useAddLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, name }: { clientId: string; name: string }) =>
      post<AdminLocationWire>(`/api/admin/clients/${clientId}/locations`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "clients"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

// Sets a single location's own module set (Fix Plan §2.3) — server enforces
// it stays a subset of the client's current subscription modules.
export function useUpdateLocationModules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ locationId, modules }: { locationId: string; modules: string[] }) =>
      put<AdminLocationWire>(`/api/admin/locations/${locationId}/modules`, { modules }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "clients"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

// ── Plans (Fix Plan Phase D §2.1) ────────────────────────────────────────────
// The sellable catalog — sales composes new packaging combos here (billing
// cycle, module set, max locations) without an engineer redeploying code.
// No price field: pricing is per-client/per-deal (Subscription.negotiatedPrice),
// not catalog-fixed (Fix Plan §4 open question #2, resolved).

export interface AdminPlan {
  id: string;
  name: string;
  billingCycle: string;
  modules: string[];
  maxEntities: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  createdById: string | null;
}
interface AdminPlanWire extends Omit<AdminPlan, "modules"> {
  modules?: ModuleRow[];
}
function normalizePlan(plan: AdminPlanWire): AdminPlan {
  return { ...plan, modules: toModuleList(plan.modules) };
}

export function useAdminPlans() {
  return useQuery({
    queryKey: ["admin", "plans"],
    queryFn: async () => (await api<AdminPlanWire[]>("/api/admin/plans")).map(normalizePlan),
  });
}

export interface CreatePlanBody {
  name: string;
  billingCycle: string;
  modules: string[];
  maxEntities: number;
  isActive?: boolean;
  sortOrder?: number;
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePlanBody) => post<AdminPlanWire>("/api/admin/plans", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "plans"] }),
  });
}

export interface UpdatePlanBody {
  name?: string;
  billingCycle?: string;
  modules?: string[];
  maxEntities?: number;
  isActive?: boolean;
  sortOrder?: number;
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdatePlanBody & { id: string }) => put<AdminPlanWire>(`/api/admin/plans/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "plans"] }),
  });
}

// Deleting is only allowed once nothing references the plan anymore (server
// enforces this) — deactivate (isActive: false via update) a plan that's
// ever been sold from instead, so existing Subscription traceability isn't lost.
export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api<{ ok: boolean; deleted: string }>(`/api/admin/plans/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "plans"] }),
  });
}

// ── Users ──────────────────────────────────────────────────────────────────

interface AdminUserClientAccessWire extends Omit<AdminUserClientAccess, "client"> {
  client: Omit<AdminUserClientAccess["client"], "subscription"> & {
    subscription: (Pick<AdminSubscription, "packageType" | "billingCycle" | "status"> & { modules?: ModuleRow[] }) | null;
  };
}
interface AdminUserWire extends Omit<AdminUser, "clientAccess"> {
  clientAccess: AdminUserClientAccessWire[];
}

function normalizeUser(user: AdminUserWire): AdminUser {
  return {
    ...user,
    clientAccess: user.clientAccess.map((a) => ({
      ...a,
      client: {
        ...a.client,
        subscription: a.client.subscription
          ? { ...a.client.subscription, modules: toModuleList(a.client.subscription.modules) }
          : null,
      },
    })),
  };
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => (await api<AdminUserWire[]>("/api/admin/users")).map(normalizeUser),
  });
}

export interface CreateUserBody {
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  email?: string;
  role: Role;
  clientIds: string[];
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserBody) => post<AdminUser>("/api/admin/users", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export interface UpdateUserBody {
  role?: Role;
  status?: "ACTIVE" | "DISABLED";
  password?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateUserBody & { id: string }) => put<AdminUser>(`/api/admin/users/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useUpdateUserAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, clientIds }: { id: string; clientIds: string[] }) =>
      put<{ ok: boolean }>(`/api/admin/users/${id}/access`, { clientIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

// ── Subscriptions ──────────────────────────────────────────────────────────

export interface AdminSubscriptionWithClient extends AdminSubscription {
  client: { id: string; name: string; status: string };
}
interface AdminSubscriptionWithClientWire extends Omit<AdminSubscriptionWithClient, "modules"> {
  modules?: ModuleRow[];
}
function normalizeSubscription(sub: AdminSubscriptionWithClientWire): AdminSubscriptionWithClient {
  return { ...sub, modules: toModuleList(sub.modules) };
}

export function useAdminSubscriptions() {
  return useQuery({
    queryKey: ["admin", "subscriptions"],
    queryFn: async () =>
      (await api<AdminSubscriptionWithClientWire[]>("/api/admin/subscriptions")).map(normalizeSubscription),
  });
}

export interface CreateSubscriptionBody {
  clientId: string;
  /** Which catalog Plan this was composed from (Fix Plan Phase D §2.2) — optional; kept for traceability only. */
  planId?: string | null;
  // packageType is NOT sent — the server derives it from billingCycle + maxEntities.
  billingCycle: string;
  modules: string[];
  maxEntities: number;
  /** Optional per-client deal price, if tracked at all. */
  negotiatedPrice?: number | null;
  startDate: string;
  endDate?: string | null;
  note?: string | null;
}

export function useCreateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSubscriptionBody) =>
      post<AdminSubscriptionWithClientWire>("/api/admin/subscriptions", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
      qc.invalidateQueries({ queryKey: ["admin", "clients"] });
    },
  });
}

export interface UpdateSubscriptionBody {
  /** Which catalog Plan this was composed from (Fix Plan Phase D §2.2) — optional; kept for traceability only. */
  planId?: string | null;
  // packageType is NOT sent — the server derives it from billingCycle + maxEntities.
  billingCycle?: string;
  modules?: string[];
  maxEntities?: number;
  /** Optional per-client deal price, if tracked at all. */
  negotiatedPrice?: number | null;
  startDate?: string;
  endDate?: string | null;
  note?: string | null;
}

export function useUpdateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateSubscriptionBody & { id: string }) =>
      put<AdminSubscriptionWithClientWire>(`/api/admin/subscriptions/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
      qc.invalidateQueries({ queryKey: ["admin", "clients"] });
    },
  });
}

// ── Payment actions ────────────────────────────────────────────────────────

export function useMarkPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      post<AdminSubscriptionWithClientWire>(`/api/admin/subscriptions/${id}/mark-paid`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "clients"] });
      qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
    },
  });
}

export function useUnmarkPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      post<AdminSubscriptionWithClientWire>(`/api/admin/subscriptions/${id}/unmark-paid`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "clients"] });
      qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
    },
  });
}

export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      post<AdminSubscriptionWithClientWire>(`/api/admin/subscriptions/${id}/cancel`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "clients"] });
      qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
    },
  });
}

// The /check endpoint returns the raw Subscription row (no `modules` include
// server-side) — it's only used for maxEntities/status/billing checks, not
// module display, so it's typed without `modules` here.
export function useSubscriptionCheck(clientId: string | null) {
  return useQuery({
    queryKey: ["admin", "subscriptions", "check", clientId],
    queryFn: () =>
      api<{
        hasSubscription: boolean;
        subscription?: Omit<AdminSubscription, "modules">;
        locationCount?: number;
        canAddEntity: boolean;
        accessState?: string;
      }>(`/api/admin/subscriptions/${clientId}/check`),
    enabled: !!clientId,
  });
}
