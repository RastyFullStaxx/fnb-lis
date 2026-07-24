import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CategoryUpsert, ItemCreate, ItemUpdate, UnitCreate, VariantCreate, VariantUpdate } from "@fnb/core";
import { api, post, put } from "./http";
import type { Category, Item, ItemVariant, Unit } from "./types";

export function useUnits() {
  return useQuery({
    queryKey: ["units"],
    queryFn: () => api<Unit[]>("/api/master/units"),
    staleTime: 10 * 60 * 1000,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => api<Category[]>("/api/master/categories"),
    staleTime: 5 * 60 * 1000,
  });
}

export function useProductTypes() {
  return useQuery({
    queryKey: ["productTypes"],
    queryFn: () => api<{ productTypes: string[] }>("/api/master/product-types"),
    staleTime: 10 * 60 * 1000,
  });
}

// Asset Condition / Status preset lists (architecture.md deviation #21) —
// same data-driven-list shape and staleTime as useProductTypes above.
export function useConditionOptions() {
  return useQuery({
    queryKey: ["conditionOptions"],
    queryFn: () => api<{ conditionOptions: string[] }>("/api/master/condition-options"),
    staleTime: 10 * 60 * 1000,
  });
}

export function useStatusOptions() {
  return useQuery({
    queryKey: ["statusOptions"],
    queryFn: () => api<{ statusOptions: string[] }>("/api/master/status-options"),
    staleTime: 10 * 60 * 1000,
  });
}

// Asset Industry preset list (client req 2026-07-24) — same shape as
// condition/status above.
export function useIndustryOptions() {
  return useQuery({
    queryKey: ["industryOptions"],
    queryFn: () => api<{ industryOptions: string[] }>("/api/master/industry-options"),
    staleTime: 10 * 60 * 1000,
  });
}

export function useItems(filters: { search?: string; categoryId?: string; productType?: string }) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.productType) params.set("productType", filters.productType);
  return useQuery({
    queryKey: ["items", filters],
    queryFn: () => api<Item[]>(`/api/master/items?${params}`),
  });
}

function useInvalidate(...keys: string[]) {
  const qc = useQueryClient();
  return () => keys.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
}

export function useCreateUnit() {
  const invalidate = useInvalidate("units");
  return useMutation({
    mutationFn: (body: UnitCreate) => post<Unit>("/api/master/units", body),
    onSuccess: invalidate,
  });
}

export function useCreateCategory() {
  const invalidate = useInvalidate("categories", "productTypes");
  return useMutation({
    mutationFn: (body: CategoryUpsert) => post<Category>("/api/master/categories", body),
    onSuccess: invalidate,
  });
}

export function useUpdateCategory() {
  const invalidate = useInvalidate("categories", "items");
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<CategoryUpsert> & { id: string }) =>
      put<Category>(`/api/master/categories/${id}`, body),
    onSuccess: invalidate,
  });
}

export function useCreateItem() {
  const invalidate = useInvalidate("items");
  return useMutation({
    mutationFn: (body: ItemCreate) => post<Item>("/api/master/items", body),
    onSuccess: invalidate,
  });
}

export function useUpdateItem() {
  const invalidate = useInvalidate("items");
  return useMutation({
    mutationFn: ({ id, ...body }: ItemUpdate & { id: string }) => put<Item>(`/api/master/items/${id}`, body),
    onSuccess: invalidate,
  });
}

export function useAddVariant() {
  const invalidate = useInvalidate("items");
  return useMutation({
    mutationFn: ({ itemId, ...body }: VariantCreate & { itemId: string }) =>
      post<ItemVariant>(`/api/master/items/${itemId}/variants`, body),
    onSuccess: invalidate,
  });
}

export function useUpdateVariant() {
  const invalidate = useInvalidate("items");
  return useMutation({
    mutationFn: ({ id, ...body }: VariantUpdate & { id: string }) =>
      put<ItemVariant>(`/api/master/variants/${id}`, body),
    onSuccess: invalidate,
  });
}
