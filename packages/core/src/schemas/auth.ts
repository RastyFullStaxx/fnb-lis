import { z } from "zod";
import { ROLES } from "../constants";

/**
 * Sent only by the offline desktop, never by the browser. Its presence is what
 * turns an ordinary login into a device login: the session comes back bound to
 * a Device row and carries a year-long expiry instead of the 7-day sliding one,
 * because a machine sold as working without connectivity (proposal §18) cannot
 * be logged out by the very offline stretch it exists to support.
 *
 * Registration is trust-on-first-use, bounded by Subscription.maxDevices: the
 * first login from an unknown fingerprint registers it, and the LIS admin sees
 * it in the device list and can revoke it. The alternative — the admin pre-
 * registering a fingerprint — needs them to read a machine id off a computer
 * they have never touched, before the software is installed on it.
 */
export const deviceLogin = z.object({
  /** Stable machine identifier the desktop derives at install time. */
  fingerprint: z.string().trim().min(8).max(200),
  /** Human label for the admin's device list, e.g. "Front bar PC". */
  name: z.string().trim().min(1).max(80),
  /**
   * Required only when the account can reach more than one establishment —
   * otherwise there is no way to know which one the machine belongs to, and
   * guessing would bind a licence to the wrong client.
   */
  clientId: z.string().min(1).optional(),
});
export type DeviceLogin = z.infer<typeof deviceLogin>;

/**
 * Set or replace my device PIN.
 *
 * Authorised by ONE of two proofs, never by the PIN itself. `currentPassword`
 * is the ordinary path. `recoveryAnswer` is the break-glass: no network, PIN
 * forgotten, and the closing count still has to happen — which is exactly the
 * situation the desktop exists for, so refusing to plan for it just means the
 * count does not get done.
 *
 * Every use of the recovery path is logged and syncs to the LIS admin. A
 * break-glass with an alarm on it is a different thing from a back door.
 */
export const setDevicePin = z
  .object({
    pin: z.string(),
    /** Free text the user writes themselves — see DevicePin in the schema. */
    recoveryQuestion: z.string().trim().min(5, "Write a question only you can answer").max(160),
    recoveryAnswer: z.string().trim().min(2, "Answer is too short").max(120),
    currentPassword: z.string().min(1).optional(),
    /** Answer to the question already on file, for the forgot-PIN path. */
    currentRecoveryAnswer: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.currentPassword) !== Boolean(v.currentRecoveryAnswer), {
    message: "Confirm with either your password or your recovery answer",
    path: ["currentPassword"],
  });
export type SetDevicePin = z.infer<typeof setDevicePin>;

export const loginRequest = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional(),
  device: deviceLogin.optional(),
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const role = z.enum(ROLES);

// ── Second factor (TOTP) ─────────────────────────────────────────────────────

/**
 * Start enrolment. Re-proving the password matters: without it, anyone who
 * walks up to an unlocked screen can bind THEIR authenticator to the account
 * and lock the real owner out of it.
 */
export const mfaEnrollRequest = z.object({
  currentPassword: z.string().min(1, "Password is required"),
});
export type MfaEnrollRequest = z.infer<typeof mfaEnrollRequest>;

/** A 6-digit code, or one of the single-use recovery codes. */
export const mfaCode = z
  .string()
  .trim()
  // Spaces are stripped server-side — authenticator apps display "123 456".
  .min(6, "Enter the 6-digit code")
  .max(20);

/** Finish enrolment by proving one working code from the app just scanned. */
export const mfaConfirmRequest = z.object({ code: mfaCode });
export type MfaConfirmRequest = z.infer<typeof mfaConfirmRequest>;

/** Second step of a two-step login. `challenge` comes from the login response. */
export const mfaVerifyRequest = z.object({
  challenge: z.string().min(1),
  code: mfaCode,
});
export type MfaVerifyRequest = z.infer<typeof mfaVerifyRequest>;

/**
 * Turn off my own second factor. Requires BOTH proofs — a password alone would
 * make MFA removable by exactly the attacker it exists to stop.
 * Refused outright for MFA_REQUIRED_ROLES; those go through an administrator.
 */
export const mfaDisableRequest = z.object({
  currentPassword: z.string().min(1, "Password is required"),
  code: mfaCode,
});
export type MfaDisableRequest = z.infer<typeof mfaDisableRequest>;

/** GET /api/auth/mfa — what the account settings screen renders from. */
export interface MfaStatus {
  /** False when the server has no FNB_MFA_KEY; the whole feature is off. */
  available: boolean;
  enrolled: boolean;
  /** This role must enrol before it can use the rest of the app. */
  required: boolean;
  confirmedAt: string | null;
  backupCodesRemaining: number;
}

/**
 * What POST /api/auth/login returns.
 *
 * The two-arm shape is the point: an enrolled user gets NO session and NO
 * cookie from the password alone, only a short-lived challenge to exchange.
 */
export type LoginResponse =
  | (MeResponse & { device?: { id: string; clientId: string; locationId: string | null } })
  | { mfaRequired: true; challenge: string; expiresAt: string };

export function isMfaChallenge(
  res: LoginResponse,
): res is { mfaRequired: true; challenge: string; expiresAt: string } {
  return "mfaRequired" in res && res.mfaRequired === true;
}

export interface SessionUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  role: z.infer<typeof role>;
  /**
   * Per-user module restriction (client req #9): which of BAR/KITCHEN/ASSET
   * this user may work in. Null = unrestricted (no UserModule rows, or ADMIN).
   * Enforced server-side in requireLocationAccess by intersecting with the
   * location's own module set.
   */
  modules: string[] | null;
  /**
   * Set when this session was opened from a registered offline desktop rather
   * than a browser. Optional because every existing caller constructs a
   * SessionUser without one, and a browser session legitimately has none.
   */
  deviceId?: string | null;
  /**
   * The user who actually OPENED this session, when an acting-user claim has
   * substituted somebody else (device sessions only). Routes that must not let
   * a person act upon themselves through a borrowed identity check both.
   */
  sessionUserId?: string;
  /**
   * Set when a device session named an acting user whose account has since been
   * DISABLED. Their queued work is still accepted — it really happened, and
   * discarding it would falsify the audit — but every entry it produces is
   * flagged for review (docs/sync-and-data-lifecycle.md §7.5).
   */
  actorDisabled?: boolean;
}

export interface MeLocation {
  id: string;
  name: string;
  clientId: string;
  /** Grouping label (MAIN | SATELLITE | STOCKROOM) or null — display only. */
  kind: string | null;
  /** This location's OWN modules (Fix Plan §2.3) — the enforced reality, not the client's ceiling. */
  modules: string[];
}

export interface MeClientSubscription {
  packageType: string;
  modules: string[];
  status: string;
  /**
   * This subscription's enabled report slugs (docs/2026-08-04-report-tier-gating-plan.md)
   * — the same `SubscriptionReport` rows `canViewReportForSubscription()` checks
   * server-side. Exposed here so the hub and RouteGuard can filter/guard with
   * the identical set the server enforces, never a guess.
   */
  reports: string[];
}

/**
 * Why report downloads are (un)available to this establishment.
 * ALLOWED · DISABLED (admin switched them off) · PAST_DUE (billing lockout).
 */
export type ReportDownloadState = "ALLOWED" | "DISABLED" | "PAST_DUE";

export interface MeClient {
  id: string;
  name: string;
  reportDownloads: ReportDownloadState;
  locations: MeLocation[];
  subscription: MeClientSubscription | null;
}

export interface MeResponse {
  user: SessionUser;
  clients: MeClient[];
  features: { aiEnabled: boolean };
  /**
   * Set when this account's role requires a second factor and it has not
   * enrolled yet. The server already refuses everything but the enrolment
   * routes in that state (requireMfaEnrolment); this is so the UI can show the
   * enrolment screen instead of a wall of 403 toasts.
   */
  mfaSetupRequired?: boolean;
}
