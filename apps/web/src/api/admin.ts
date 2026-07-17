import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Role } from "@fnb/core";
import { api, post, put } from "./http";

// ── Shapes (mirror apps/server/src/routes/admin.ts) ──

export interface AdminLocation {
  id: string;
  name: string;
  status: string;
}

export interface AdminSubscription {
  id: string;
  clientId: string;
  packageType: string;
  billingCycle: string;
  inventoryModules: string;
  maxEntities: number;
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

export interface AdminUserClientAccess {
  clientId: string;
  client: {
    id: string;
    name: string;
    subscription: Pick<AdminSubscription, "packageType" | "billingCycle" | "inventoryModules" | "status"> | null;
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
  return useQuery({ queryKey: ["admin", "clients"], queryFn: () => api<AdminClient[]>("/api/admin/clients") });
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
    packageType: string;
    billingCycle: string;
    inventoryModules: string;
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
    mutationFn: (body: CreateFullClientBody) => post<AdminClient>("/api/admin/clients/full", body),
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
      post<AdminLocation>(`/api/admin/clients/${clientId}/locations`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "clients"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

// ── Users ──────────────────────────────────────────────────────────────────

export function useAdminUsers() {
  return useQuery({ queryKey: ["admin", "users"], queryFn: () => api<AdminUser[]>("/api/admin/users") });
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

export function useAdminSubscriptions() {
  return useQuery({
    queryKey: ["admin", "subscriptions"],
    queryFn: () => api<AdminSubscriptionWithClient[]>("/api/admin/subscriptions"),
  });
}

export interface CreateSubscriptionBody {
  clientId: string;
  packageType: string;
  billingCycle: string;
  inventoryModules: string;
  startDate: string;
  endDate?: string | null;
  note?: string | null;
}

export function useCreateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSubscriptionBody) =>
      post<AdminSubscriptionWithClient>("/api/admin/subscriptions", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
      qc.invalidateQueries({ queryKey: ["admin", "clients"] });
    },
  });
}

export interface UpdateSubscriptionBody {
  packageType?: string;
  billingCycle?: string;
  inventoryModules?: string;
  startDate?: string;
  endDate?: string | null;
  note?: string | null;
}

export function useUpdateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateSubscriptionBody & { id: string }) =>
      put<AdminSubscriptionWithClient>(`/api/admin/subscriptions/${id}`, body),
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
      post<AdminSubscriptionWithClient>(`/api/admin/subscriptions/${id}/mark-paid`, {}),
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
      post<AdminSubscriptionWithClient>(`/api/admin/subscriptions/${id}/unmark-paid`, {}),
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
      post<AdminSubscriptionWithClient>(`/api/admin/subscriptions/${id}/cancel`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "clients"] });
      qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
    },
  });
}

export function useSubscriptionCheck(clientId: string | null) {
  return useQuery({
    queryKey: ["admin", "subscriptions", "check", clientId],
    queryFn: () =>
      api<{ hasSubscription: boolean; subscription?: AdminSubscription; locationCount?: number; canAddEntity: boolean; accessState?: string }>(
        `/api/admin/subscriptions/${clientId}/check`,
      ),
    enabled: !!clientId,
  });
}
