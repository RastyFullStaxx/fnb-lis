import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MenuCreate, RecipePublish } from "@fnb/core";
import { api, post, put } from "./http";
import { useLocationId } from "./location";
import type { LocationItem } from "./types";

const base = (locationId: string) => `/api/locations/${locationId}`;

export interface MenuSummary {
  id: string;
  name: string;
  isActive: boolean;
  versionCount: number;
  salesCount: number;
  current: { id: string; versionNo: number; srp: number; costAtPublish: number; lineCount: number } | null;
}

export interface RecipeVersionDetail {
  id: string;
  versionNo: number;
  srp: number;
  costAtPublish: number;
  publishedAt: string;
  note: string | null;
  lines: Array<{
    id: string;
    locationItemId: string;
    servingQty: number;
    sortOrder: number;
    locationItem: LocationItem;
  }>;
}

export interface MenuDetail {
  id: string;
  name: string;
  isActive: boolean;
  versions: RecipeVersionDetail[];
}

export function useMenus() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["menus", locationId],
    queryFn: () => api<MenuSummary[]>(`${base(locationId)}/menus`),
  });
}

export function useMenu(menuId: string | null) {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ["menus", locationId, menuId],
    queryFn: () => api<MenuDetail>(`${base(locationId)}/menus/${menuId}`),
    enabled: Boolean(menuId),
  });
}

export function useCopyMenusFromLocation() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceLocationId: string) =>
      post<{
        copied: number;
        skippedExisting: number;
        skippedNoRecipe: number;
        skippedMissingIngredients: number;
        missingIngredientMenus: string[];
      }>(`${base(locationId)}/menus/copy-from/${sourceLocationId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menus", locationId] }),
  });
}

export function useMenuMutations() {
  const locationId = useLocationId();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["menus", locationId] });
  return {
    create: useMutation({
      mutationFn: (body: MenuCreate) => post<MenuSummary>(`${base(locationId)}/menus`, body),
      onSuccess: invalidate,
    }),
    publish: useMutation({
      mutationFn: ({ menuId, ...body }: RecipePublish & { menuId: string }) =>
        post<RecipeVersionDetail>(`${base(locationId)}/menus/${menuId}/versions`, body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; name?: string; isActive?: boolean }) =>
        put(`${base(locationId)}/menus/${id}`, body),
      onSuccess: invalidate,
    }),
  };
}
