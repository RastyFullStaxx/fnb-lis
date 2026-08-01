import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
  MfaStatus,
  SetDevicePin,
} from "@fnb/core";
import { api, ApiError, del, post } from "./http";

export const ME_KEY = ["me"] as const;
export const PIN_KEY = ["device-pin"] as const;
export const MFA_KEY = ["mfa"] as const;

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

/**
 * Two-armed on purpose: an account with a second factor gets a challenge back
 * instead of a session, so the caller MUST branch (see `isMfaChallenge`) rather
 * than assume it is signed in.
 */
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => post<LoginResponse>("/api/auth/login", body),
    onSuccess: (res) => {
      if (!("mfaRequired" in res)) qc.setQueryData(ME_KEY, res);
    },
  });
}

/** Second step: exchange the challenge plus a code for a session. */
export function useVerifyMfa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { challenge: string; code: string }) =>
      post<MeResponse>("/api/auth/mfa/verify", body),
    onSuccess: (me) => qc.setQueryData(ME_KEY, me),
  });
}

export function useMfaStatus() {
  return useQuery({
    queryKey: MFA_KEY,
    queryFn: () => api<MfaStatus>("/api/auth/mfa"),
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
  });
}

/** Step 1 of enrolment — returns the secret to scan. Never cached. */
export function useEnrollMfa() {
  return useMutation({
    mutationFn: (body: { currentPassword: string }) =>
      post<{ secret: string; otpauthUri: string }>("/api/auth/mfa/enroll", body),
  });
}

/** Step 2 — proves a working code and returns the recovery codes ONCE. */
export function useConfirmMfa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { code: string }) => post<{ backupCodes: string[] }>("/api/auth/mfa/confirm", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MFA_KEY });
      // The enrolment gate lives on /me — refetch so the app unblocks.
      qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });
}

export function useDisableMfa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { currentPassword: string; code: string }) =>
      del<{ ok: boolean }>("/api/auth/mfa", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MFA_KEY });
      qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ ok: boolean }>("/api/auth/logout"),
    onSuccess: () => qc.clear(),
  });
}
