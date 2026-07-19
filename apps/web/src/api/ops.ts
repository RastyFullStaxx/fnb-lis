import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CountLineCreate,
  CountSessionCreate,
  ForfeitCreate,
  PurchaseCreate,
  PurchaseLineCreate,
  ReconReport,
  SaleCreate,
  TransferCreate,
  TransferLineCreate,
  TransferReceive,
} from "@fnb/core";
import { api, post, put } from "./http";
import { useLocationId } from "./location";
import type { CountLine, CountSession, Forfeit, Purchase, PurchaseLine, SaleRecord, Transfer, TransferLine } from "./types";

const base = (locationId: string) => `/api/locations/${locationId}`;

// ── Counts ──

export function useCountSessions() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["counts", locationId],
    queryFn: () => api<CountSession[]>(`${base(locationId)}/counts`),
  });
}

export function useCountSession(sessionId: string) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["counts", locationId, sessionId],
    queryFn: () => api<CountSession & { lines: CountLine[] }>(`${base(locationId)}/counts/${sessionId}`),
  });
}

export function useCountMutations(sessionId?: string) {
  const locationId = useLocationId();
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["counts", locationId] });
    qc.invalidateQueries({ queryKey: ["report"] });
  };
  return {
    createSession: useMutation({
      mutationFn: (body: CountSessionCreate) => post<CountSession>(`${base(locationId)}/counts`, body),
      onSuccess: invalidate,
    }),
    addLine: useMutation({
      mutationFn: (body: CountLineCreate) => post<CountLine>(`${base(locationId)}/counts/${sessionId}/lines`, body),
      onSuccess: invalidate,
    }),
    removeLine: useMutation({
      mutationFn: (lineId: string) =>
        api<{ ok: boolean }>(`${base(locationId)}/counts/${sessionId}/lines/${lineId}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
    commit: useMutation({
      mutationFn: () => post<CountSession>(`${base(locationId)}/counts/${sessionId}/commit`),
      onSuccess: invalidate,
    }),
    voidSession: useMutation({
      mutationFn: (reason: string) => post<CountSession>(`${base(locationId)}/counts/${sessionId}/void`, { reason }),
      onSuccess: invalidate,
    }),
    voidLine: useMutation({
      mutationFn: ({ lineId, reason }: { lineId: string; reason: string }) =>
        post<CountLine>(`${base(locationId)}/counts/${sessionId}/lines/${lineId}/void`, { reason }),
      onSuccess: invalidate,
    }),
    correctLine: useMutation({
      mutationFn: ({ lineId, ...body }: CountLineCreate & { lineId: string; reason: string }) =>
        post<CountLine>(`${base(locationId)}/counts/${sessionId}/lines/${lineId}/correct`, body),
      onSuccess: invalidate,
    }),
  };
}

// ── Purchases & forfeits ──

export function usePurchases() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["purchases", locationId],
    queryFn: () => api<Purchase[]>(`${base(locationId)}/purchases`),
  });
}

export function usePurchase(purchaseId: string) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["purchases", locationId, purchaseId],
    queryFn: () => api<Purchase & { lines: PurchaseLine[] }>(`${base(locationId)}/purchases/${purchaseId}`),
  });
}

export function usePurchaseMutations(purchaseId?: string) {
  const locationId = useLocationId();
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["purchases", locationId] });
    qc.invalidateQueries({ queryKey: ["report"] });
  };
  return {
    create: useMutation({
      mutationFn: (body: PurchaseCreate) => post<Purchase>(`${base(locationId)}/purchases`, body),
      onSuccess: invalidate,
    }),
    addLine: useMutation({
      mutationFn: (body: PurchaseLineCreate) =>
        post<PurchaseLine>(`${base(locationId)}/purchases/${purchaseId}/lines`, body),
      onSuccess: invalidate,
    }),
    removeLine: useMutation({
      mutationFn: (lineId: string) =>
        api<{ ok: boolean }>(`${base(locationId)}/purchases/${purchaseId}/lines/${lineId}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
    commit: useMutation({
      mutationFn: () => post<Purchase>(`${base(locationId)}/purchases/${purchaseId}/commit`),
      onSuccess: invalidate,
    }),
    voidPurchase: useMutation({
      mutationFn: (reason: string) => post<Purchase>(`${base(locationId)}/purchases/${purchaseId}/void`, { reason }),
      onSuccess: invalidate,
    }),
    voidLine: useMutation({
      mutationFn: ({ lineId, reason }: { lineId: string; reason: string }) =>
        post<PurchaseLine>(`${base(locationId)}/purchases/${purchaseId}/lines/${lineId}/void`, { reason }),
      onSuccess: invalidate,
    }),
  };
}

export function useForfeits() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["forfeits", locationId],
    queryFn: () => api<Forfeit[]>(`${base(locationId)}/forfeits`),
  });
}

export function useForfeitMutations() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["forfeits", locationId] });
    qc.invalidateQueries({ queryKey: ["report"] });
  };
  return {
    create: useMutation({
      mutationFn: (body: ForfeitCreate) => post<Forfeit>(`${base(locationId)}/forfeits`, body),
      onSuccess: invalidate,
    }),
    voidForfeit: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) =>
        post<Forfeit>(`${base(locationId)}/forfeits/${id}/void`, { reason }),
      onSuccess: invalidate,
    }),
  };
}

// ── Transfers ──

export function useTransfers(direction: "out" | "in") {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["transfers", locationId, direction],
    queryFn: () => api<Transfer[]>(`${base(locationId)}/transfers?direction=${direction}`),
  });
}

export function useTransfer(transferId: string) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["transfers", locationId, transferId],
    queryFn: () => api<Transfer & { lines: TransferLine[] }>(`${base(locationId)}/transfers/${transferId}`),
  });
}

export function useTransferMutations(transferId?: string) {
  const locationId = useLocationId();
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["transfers"] }); // both sides + both directions
    qc.invalidateQueries({ queryKey: ["report"] });
  };
  return {
    create: useMutation({
      mutationFn: (body: TransferCreate) => post<Transfer>(`${base(locationId)}/transfers`, body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (body: Partial<TransferCreate>) => put<Transfer>(`${base(locationId)}/transfers/${transferId}`, body),
      onSuccess: invalidate,
    }),
    addLine: useMutation({
      mutationFn: (body: TransferLineCreate) =>
        post<TransferLine>(`${base(locationId)}/transfers/${transferId}/lines`, body),
      onSuccess: invalidate,
    }),
    removeLine: useMutation({
      mutationFn: (lineId: string) =>
        api<{ ok: boolean }>(`${base(locationId)}/transfers/${transferId}/lines/${lineId}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
    commit: useMutation({
      mutationFn: () => post<Transfer>(`${base(locationId)}/transfers/${transferId}/commit`),
      onSuccess: invalidate,
    }),
    voidTransfer: useMutation({
      mutationFn: (reason: string) => post<Transfer>(`${base(locationId)}/transfers/${transferId}/void`, { reason }),
      onSuccess: invalidate,
    }),
    voidLine: useMutation({
      mutationFn: ({ lineId, reason }: { lineId: string; reason: string }) =>
        post<TransferLine>(`${base(locationId)}/transfers/${transferId}/lines/${lineId}/void`, { reason }),
      onSuccess: invalidate,
    }),
    receive: useMutation({
      mutationFn: ({ id, ...body }: TransferReceive & { id: string }) =>
        post(`${base(locationId)}/transfers/${id}/receive`, body),
      onSuccess: invalidate,
    }),
    voidReceipt: useMutation({
      mutationFn: ({ id, receiptId, reason }: { id: string; receiptId: string; reason: string }) =>
        post(`${base(locationId)}/transfers/${id}/receipts/${receiptId}/void`, { reason }),
      onSuccess: invalidate,
    }),
  };
}

// ── Sales ──

export function useSales(filters: { kind?: string; date?: string } = {}) {
  const locationId = useLocationId();
  const params = new URLSearchParams();
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.date) params.set("date", filters.date);
  return useQuery({
    queryKey: ["sales", locationId, filters],
    queryFn: () => api<SaleRecord[]>(`${base(locationId)}/sales?${params}`),
  });
}

export function useSaleMutations() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["sales", locationId] });
    qc.invalidateQueries({ queryKey: ["report"] });
  };
  return {
    create: useMutation({
      mutationFn: (body: SaleCreate) => post<SaleRecord>(`${base(locationId)}/sales`, body),
      onSuccess: invalidate,
    }),
    voidSale: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) =>
        post<SaleRecord>(`${base(locationId)}/sales/${id}/void`, { reason }),
      onSuccess: invalidate,
    }),
  };
}

// ── Reports ──

export function useCountDates() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "countDates", locationId],
    queryFn: () => api<{ dates: string[] }>(`${base(locationId)}/reports/count-dates`),
  });
}

export function useFullAudit(begin?: string, end?: string, productType?: string) {
  const locationId = useLocationId();
  const params = new URLSearchParams({ begin: begin ?? "", end: end ?? "" });
  if (productType) params.set("productType", productType);
  return useQuery({
    queryKey: ["report", "fullAudit", locationId, begin, end, productType],
    queryFn: () => api<ReconReport>(`${base(locationId)}/reports/full-audit?${params}`),
    enabled: Boolean(begin && end),
  });
}

export function useOnHand() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["report", "onHand", locationId],
    queryFn: () =>
      api<Array<{ locationItemId: string; onHand: number; lastCountDate: string | null }>>(
        `${base(locationId)}/stock/on-hand`,
      ),
  });
}
