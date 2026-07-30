import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LoginRequest, MeResponse, SetDevicePin } from "@fnb/core";
import { api, ApiError, del, post } from "./http";

export const ME_KEY = ["me"] as const;
export const PIN_KEY = ["device-pin"] as const;

export interface DevicePinStatus {
  hasPin: boolean;
  recoveryQuestion: string | null;
  updatedAt: string | null;
}

/** Status only — the server never returns the PIN or its hash. */
export function useDevicePin() {
  return useQuery({
    queryKey: PIN_KEY,
    queryFn: () => api<DevicePinStatus>("/api/auth/pin"),
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
  });
}

export function useSetDevicePin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetDevicePin) => post<{ ok: boolean; via: string }>("/api/auth/pin", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: PIN_KEY }),
  });
}

export function useClearDevicePin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => del<{ ok: boolean }>("/api/auth/pin"),
    onSuccess: () => qc.invalidateQueries({ queryKey: PIN_KEY }),
  });
}

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
