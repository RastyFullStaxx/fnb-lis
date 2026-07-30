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
}
