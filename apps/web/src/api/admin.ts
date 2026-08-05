import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deriveAccessState as deriveAccessStateCore,
  daysUntilDue as daysUntilDueCore,
  type AccessState,
  type Role,
} from "@fnb/core";
import { api, post, put } from "./http";

// ── Shapes (mirror apps/server/src/routes/admin.ts) ──

export interface AdminLocation {
  id: string;
  name: string;
  /** Grouping label (MAIN | SATELLITE | STOCKROOM) or null — display only. */
  kind: string | null;
  status: string;
  /** This location's OWN modules (Fix Plan §2.3) — the enforced reality, must be a subset of the client's subscription modules. */
  modules: string[];
}

export interface AdminSubscription {
  id: string;
  clientId: string;
  /** Read-only — derived server-side from billingCycle + maxEntities + maxUsers (derivePackageType). Never sent as input. */
  packageType: string;
  billingCycle: string;
  /** The client's licensed ceiling (Fix Plan §2.2) — atomic modules, any non-empty subset. */
  modules: string[];
  /** Enabled report slugs (report tier gating, Phase 0/5.2) — the
   * SubscriptionReport rows canViewReportForSubscription() actually checks.
   * Seeded from the tier preset at creation, hand-editable after via
   * PUT /clients/:id/subscription/reports (SubscriptionReportsDialog). */
  reports: string[];
  maxEntities: number;
  /** Max user accounts (client req 2026-07-21); 0 = no cap saved (legacy rows). */
  maxUsers: number;
  /** Offline desktop computers this client may register; 0 = unlimited. */
  maxDevices: number;
  /** Optional per-client/per-deal price, if tracked at all (Fix Plan §4 open question #2). */
  negotiatedPrice: number | null;
  status: string;
  paid: boolean;
  lastPaidAt: string | null;
  startDate: string;
  endDate: string | null;
  note: string | null;
  cancelledAt: string | null;
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

/** Raw shape of a SubscriptionReport join-table row as returned by the server. */
interface ReportRow {
  reportSlug: string;
}

/** Normalizes the server's `{ reports: [{reportSlug}, ...] }` include shape into a flat `string[]`. */
function toReportList(reports: ReportRow[] | undefined | null): string[] {
  return reports?.map((r) => r.reportSlug) ?? [];
}

interface AdminLocationWire extends Omit<AdminLocation, "modules"> {
  modules?: ModuleRow[];
}
interface AdminSubscriptionWire extends Omit<AdminSubscription, "modules" | "reports"> {
  modules?: ModuleRow[];
  reports?: ReportRow[];
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
      ? {
          ...client.subscription,
          modules: toModuleList(client.subscription.modules),
          reports: toReportList(client.subscription.reports),
        }
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
  /** Per-user module restriction (client req #9): empty = unrestricted. */
  modules: string[];
  clientAccess: AdminUserClientAccess[];
}

// ── Access state (thin wrappers over @fnb/core/billing — the single source
// of truth shared with the server; only `now` injection happens here) ─────────
// Callers should check sub.status first — CANCELLED/SUSPENDED override this.
export function deriveAccessState(
  sub: Pick<AdminSubscription, "billingCycle" | "paid" | "lastPaidAt" | "startDate">,
): AccessState {
  return deriveAccessStateCore(sub, new Date());
}

/** Signed days for the current due (positive = upcoming, negative = overdue). MONTHLY only. */
export function daysUntilDue(sub: Pick<AdminSubscription, "startDate">): number {
  return daysUntilDueCore(sub.startDate, new Date());
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
    // packageType is NOT sent — the server derives it from billingCycle + maxEntities + maxUsers.
    billingCycle: string;
    modules: string[];
    maxEntities: number;
    /** Max user accounts (client req 2026-07-21); 0 = no cap saved. */
    maxUsers: number;
  /** Offline desktop computers this client may register; 0 = unlimited. */
  maxDevices: number;
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

// Rename / relabel a location (kind = main/satellite/stockroom grouping tag).
export function useUpdateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ locationId, ...body }: { locationId: string; name?: string; kind?: string | null }) =>
      put<AdminLocationWire>(`/api/admin/locations/${locationId}`, body),
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

// Report tier gating, Phase 5.3.4 (docs/2026-08-04-report-tier-gating-phases.md).
// Sets a client's full enabled-report set — same replace-the-whole-set shape
// as useUpdateLocationModules above, backing SubscriptionReportsDialog's Save
// (client-form-fields.tsx). Keyed by clientId, matching the server route
// (PUT /clients/:id/subscription/reports, Phase 5.2), not subscriptionId.
//
// Invalidates ["me"] as well as ["admin", "clients"]: the reports hub filter
// (Phase 4.1, pages/reports/index.tsx) reads `client?.subscription?.reports`
// off useMe()'s cached client data, not off the admin client list — so
// without this, an admin who just tightened a client's reports would still
// see the old (wider) set on that client's own next hub visit until some
// unrelated action happened to refetch `me`.
export function useUpdateSubscriptionReports() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, reportSlugs }: { clientId: string; reportSlugs: string[] }) =>
      put<AdminSubscriptionWithClientWire>(`/api/admin/clients/${clientId}/subscription/reports`, { reportSlugs }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "clients"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

// ── Users ──────────────────────────────────────────────────────────────────

interface AdminUserClientAccessWire extends Omit<AdminUserClientAccess, "client"> {
  client: Omit<AdminUserClientAccess["client"], "subscription"> & {
    subscription: (Pick<AdminSubscription, "packageType" | "billingCycle" | "status"> & { modules?: ModuleRow[] }) | null;
  };
}
interface AdminUserWire extends Omit<AdminUser, "clientAccess" | "modules"> {
  modules?: ModuleRow[];
  clientAccess: AdminUserClientAccessWire[];
}

function normalizeUser(user: AdminUserWire): AdminUser {
  return {
    ...user,
    modules: toModuleList(user.modules),
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
  /** Per-user module restriction: empty = unrestricted. */
  modules?: string[];
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
  /** Per-user module restriction: empty = unrestricted. */
  modules?: string[];
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

// ── Login history / active sessions (client req 2026-07-29) ────────────────
// Mirrors apps/server/src/routes/admin.ts GET/POST .../sessions[...]/revoke.
// STAFF is never fetched through this — the route itself excludes STAFF
// actors, and the frontend never renders a trigger for a STAFF-role viewer.

/** One past login/logout/auto-logout event, most recent first. */
export interface UserSessionHistoryEntry {
  id: string;
  ts: string;
  action: "auth.login" | "auth.logout" | "auth.autoLogout";
  ip: string | null;
  device: string;
}

/** A currently-active session — revokable. */
export interface UserActiveSession {
  id: string;
  ip: string | null;
  device: string;
  loginAt: string;
  expiresAt: string;
}

export interface UserSessionsResponse {
  history: UserSessionHistoryEntry[];
  active: UserActiveSession[];
}

export function useUserSessions(userId: string | null) {
  return useQuery({
    queryKey: ["admin", "users", userId, "sessions"],
    queryFn: () => api<UserSessionsResponse>(`/api/admin/users/${userId}/sessions`),
    enabled: !!userId,
  });
}

export function useRevokeUserSession(userId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, reason }: { sessionId: string; reason: string }) =>
      post<{ ok: boolean }>(`/api/admin/users/${userId}/sessions/${sessionId}/revoke`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users", userId, "sessions"] }),
  });
}


// ── Subscriptions ──────────────────────────────────────────────────────────

export interface AdminSubscriptionWithClient extends AdminSubscription {
  client: { id: string; name: string; status: string };
}
interface AdminSubscriptionWithClientWire extends Omit<AdminSubscriptionWithClient, "modules" | "reports"> {
  modules?: ModuleRow[];
  reports?: ReportRow[];
}
function normalizeSubscription(sub: AdminSubscriptionWithClientWire): AdminSubscriptionWithClient {
  return { ...sub, modules: toModuleList(sub.modules), reports: toReportList(sub.reports) };
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
  // packageType is NOT sent — the server derives it from billingCycle + maxEntities + maxUsers.
  billingCycle: string;
  modules: string[];
  maxEntities: number;
  /** Max user accounts (client req 2026-07-21); 0 = no cap saved. */
  maxUsers: number;
  /** Offline desktop computers this client may register; 0 = unlimited. */
  maxDevices: number;
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
  // packageType is NOT sent — the server derives it from billingCycle + maxEntities + maxUsers.
  billingCycle?: string;
  modules?: string[];
  maxEntities?: number;
  /** Max user accounts (client req 2026-07-21); 0 = no cap saved. */
  maxUsers?: number;
  maxDevices?: number;
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

/**
 * Registered offline desktops (docs/sync-and-data-lifecycle.md §5).
 *
 * Server-side these carry a year-long session, so the ability to SEE and REVOKE
 * them is not administrative polish — it is the counterweight that makes the
 * long token acceptable. The API never returns a device's fingerprint.
 */
export interface AdminDevice {
  id: string;
  name: string;
  status: "ACTIVE" | "REVOKED";
  registeredAt: string;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  client: { id: string; name: string };
  location: { id: string; name: string } | null;
}

export function useAdminDevices() {
  return useQuery({
    queryKey: ["admin", "devices"],
    queryFn: () => api<AdminDevice[]>("/api/admin/devices"),
  });
}

export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      post<AdminDevice>(`/api/admin/devices/${id}/revoke`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "devices"] }),
  });
}

export function useUpdateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; locationId?: string | null }) =>
      put<AdminDevice>(`/api/admin/devices/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "devices"] }),
  });
}
