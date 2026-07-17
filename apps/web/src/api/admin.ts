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

// ── Clients & locations ──

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

// ── Users ──

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

// ── Subscriptions ──

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
  status?: string;
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

export function useSubscriptionCheck(clientId: string | null) {
  return useQuery({
    queryKey: ["admin", "subscriptions", "check", clientId],
    queryFn: () =>
      api<{ hasSubscription: boolean; subscription?: AdminSubscription; locationCount?: number; canAddEntity: boolean }>(
        `/api/admin/subscriptions/${clientId}/check`,
      ),
    enabled: !!clientId,
  });
}
