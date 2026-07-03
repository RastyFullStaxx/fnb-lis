import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImportRowUpdate } from "@fnb/core";
import { api, ApiError, post, put } from "./http";
import { useLocationId } from "./location";

const base = (locationId: string) => `/api/locations/${locationId}`;

export type ImportKind = "SALES" | "PURCHASES" | "NON_REVENUE";

export interface ImportBatchSummary {
  id: string;
  kind: string;
  fileName: string;
  sourceType: string;
  extractor: string;
  status: "PROCESSING" | "NEEDS_REVIEW" | "COMMITTED" | "REVERSED" | "FAILED";
  businessDate: string | null;
  createdByName: string;
  createdAt: string;
  committedAt: string | null;
  reversedAt: string | null;
  _count?: { rows: number };
}

export interface ImportRow {
  id: string;
  rowIndex: number;
  itemText: string;
  qty: number | null;
  unitCost: number | null;
  unitPrice: number | null;
  rowDate: string | null;
  matchedLocationItemId: string | null;
  matchedMenuItemId: string | null;
  matchMethod: "EXACT" | "ALIAS" | "FUZZY" | "MANUAL" | null;
  confidence: number | null;
  warning: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "COMMITTED";
  resultType: string | null;
}

export interface ImportBatchDetail extends ImportBatchSummary {
  rows: ImportRow[];
}

export function useImportBatches() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["imports", locationId],
    queryFn: () => api<ImportBatchSummary[]>(`${base(locationId)}/imports`),
  });
}

export function useImportBatch(batchId: string | null) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["imports", locationId, batchId],
    queryFn: () => api<ImportBatchDetail>(`${base(locationId)}/imports/${batchId}`),
    enabled: Boolean(batchId),
  });
}

export function useUploadImport() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, file, businessDate }: { kind: ImportKind; file: File; businessDate?: string }) => {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      if (businessDate) form.append("businessDate", businessDate);
      const res = await fetch(`${base(locationId)}/imports`, { method: "POST", credentials: "same-origin", body: form });
      if (!res.ok) {
        let message = res.statusText;
        try {
          message = ((await res.json()) as { error?: string }).error ?? message;
        } catch {
          /* non-JSON */
        }
        throw new ApiError(res.status, message);
      }
      return res.json() as Promise<{ id: string; warnings: string[] }>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["imports", locationId] }),
  });
}

export function useImportRowMutations(batchId: string) {
  const locationId = useLocationId();
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["imports", locationId] });
    qc.invalidateQueries({ queryKey: ["report"] });
  };
  return {
    updateRow: useMutation({
      mutationFn: ({ rowId, ...body }: ImportRowUpdate & { rowId: string }) =>
        put<ImportRow>(`${base(locationId)}/imports/${batchId}/rows/${rowId}`, body),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["imports", locationId, batchId] }),
    }),
    commit: useMutation({
      mutationFn: () => post<{ committed: number }>(`${base(locationId)}/imports/${batchId}/commit`),
      onSuccess: invalidate,
    }),
    reverse: useMutation({
      mutationFn: () => post<{ reversed: number }>(`${base(locationId)}/imports/${batchId}/reverse`),
      onSuccess: invalidate,
    }),
  };
}
