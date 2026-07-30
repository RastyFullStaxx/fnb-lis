import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import path from "node:path";

/**
 * `safeStorage` is resolved lazily, not imported at module scope.
 *
 * A top-level `import ... from "electron"` makes this whole module unloadable
 * outside a real Electron runtime — which breaks any headless exercise of the
 * provisioning path, and those are the tests worth having. Only the two
 * functions that actually encrypt need it.
 */
function electronSafeStorage(): typeof import("electron").safeStorage | null {
  try {
    return (require("electron") as typeof import("electron")).safeStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * What this machine knows about itself between launches.
 *
 * Lives in Electron's userData directory, beside the mirror, so an app update
 * never wipes it and two Windows accounts on one PC get their own.
 */

export interface DesktopConfig {
  /** e.g. https://lis.example.com — the establishment's server. */
  remoteUrl: string;
  /** Stable machine id, generated once (see fingerprintOf). */
  fingerprint: string;
  /** Human label shown in the admin's device list. */
  deviceName: string;
  /** Filled in by the server at registration. */
  deviceId?: string;
  /** Which location this machine mirrors. */
  locationId?: string;
  /** The establishment. Needed to write the local Device row at PIN unlock. */
  clientId?: string;
  locationName?: string;
  /** Encrypted device session cookie — see sessionCookie below. */
  sessionEnc?: string;
  /** `meta.generatedAt` of the last successful pull, sent back as `since`. */
  lastPullAt?: string;
  /** Business-date floor for transactional data. */
  from?: string;
}

let configPath = "";

export function initConfig(userDataDir: string): void {
  mkdirSync(userDataDir, { recursive: true });
  configPath = path.join(userDataDir, "config.json");
}

export function readConfig(): DesktopConfig | null {
  if (!configPath || !existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as DesktopConfig;
  } catch {
    // A corrupt config must not brick the app into an unrecoverable state —
    // treat it as unprovisioned so setup can run again.
    return null;
  }
}

export function writeConfig(cfg: DesktopConfig): void {
  writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf8");
}

/** Provisioned enough to run offline? */
export function isProvisioned(cfg: DesktopConfig | null): cfg is DesktopConfig {
  return Boolean(cfg?.deviceId && cfg.locationId && cfg.sessionEnc);
}

/**
 * A stable identifier for this machine.
 *
 * Deliberately NOT derived from hardware. Serial numbers and MAC addresses look
 * more "real" but change with a NIC swap or a docking station, and the server
 * treats a new fingerprint as a NEW DEVICE — which consumes the licence slot and
 * strands the old machine's outbox. A random id generated once and persisted is
 * stable across exactly the events that should not re-register: reboots, app
 * updates, hardware changes. Reinstalling Windows is a genuinely new device.
 *
 * The hostname is prefixed only so an admin can recognise it in a list.
 */
export function fingerprintOf(existing?: string): string {
  return existing ?? `${hostname().replace(/[^\w-]/g, "").slice(0, 24)}-${randomUUID()}`;
}

/**
 * The device session cookie, encrypted at rest.
 *
 * This is a year-long credential to an establishment's books, sitting on a
 * computer in a bar. `safeStorage` binds it to the OS user account (DPAPI on
 * Windows), so copying config.json to another machine yields nothing usable.
 *
 * Falls back to plaintext ONLY where the OS offers no keyring, and says so
 * loudly rather than silently downgrading — a credential you believe is
 * encrypted and isn't is worse than one you know is not.
 */
export function encryptSession(cookie: string): string {
  const safeStorage = electronSafeStorage();
  if (!safeStorage?.isEncryptionAvailable()) {
    console.warn("[fnb-desktop] OS encryption unavailable — device session stored in plain text");
    return `plain:${cookie}`;
  }
  return `enc:${safeStorage.encryptString(cookie).toString("base64")}`;
}

export function decryptSession(stored: string | undefined): string | null {
  if (!stored) return null;
  if (stored.startsWith("plain:")) return stored.slice(6);
  if (!stored.startsWith("enc:")) return null;
  try {
    const safeStorage = electronSafeStorage();
    if (!safeStorage) return null;
    return safeStorage.decryptString(Buffer.from(stored.slice(4), "base64"));
  } catch {
    // Decryption fails if the config was copied from another machine or the OS
    // user changed — which is the control working, not a bug. Re-provision.
    return null;
  }
}
