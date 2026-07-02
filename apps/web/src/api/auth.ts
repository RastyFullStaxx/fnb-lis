import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LoginRequest, MeResponse } from "@fnb/core";
import { api, ApiError, post } from "./http";

export const ME_KEY = ["me"] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: () => api<MeResponse>("/api/auth/me"),
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => post<MeResponse>("/api/auth/login", body),
    onSuccess: (me) => qc.setQueryData(ME_KEY, me),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ ok: boolean }>("/api/auth/logout"),
    onSuccess: () => qc.clear(),
  });
}
