import { encryptSession, fingerprintOf, type DesktopConfig } from "./config";

/**
 * First-run setup: point this machine at a server, register it, choose a
 * location, and pull the first snapshot.
 *
 * Registration is trust-on-first-use bounded by the licence: an OWNER or LIS
 * ADMIN signs in once, on the machine, and that first sign-in is what binds the
 * device. Nobody can read a fingerprint off a computer before installing the
 * software that computes it, so pre-registration was never workable.
 */

export interface SetupInput {
  remoteUrl: string;
  username: string;
  password: string;
  deviceName: string;
  /** Required only when the account can reach more than one establishment. */
  clientId?: string;
}

export interface MeLocation {
  id: string;
  name: string;
  clientId: string;
}

export interface RegisterResult {
  cookie: string;
  deviceId: string;
  locations: MeLocation[];
  clients: Array<{ id: string; name: string }>;
  /** Where the server says this device belongs, if an admin already set it. */
  suggestedLocationId: string | null;
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Sign in WITH a device payload, which is what turns an ordinary login into a
 * registration (see apps/server/src/auth/device.ts).
 */
export async function registerDevice(
  input: SetupInput,
  existingFingerprint?: string,
): Promise<{ result: RegisterResult; fingerprint: string; remoteUrl: string }> {
  const remoteUrl = normalizeUrl(input.remoteUrl);
  const fingerprint = fingerprintOf(existingFingerprint);

  let res: Response;
  try {
    res = await fetch(`${remoteUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: input.username,
        password: input.password,
        device: { fingerprint, name: input.deviceName, clientId: input.clientId },
      }),
    });
  } catch {
    // A raw "TypeError: fetch failed" tells the person installing this nothing.
    // Every cause is the same actionable thing: the address or the connection.
    throw new Error(
      `Couldn't reach ${remoteUrl}. Check the server address and that this computer is online. ` +
        `If the server runs without HTTPS, include http:// at the front.`,
    );
  }

  const text = await res.text();
  if (!res.ok) {
    let message = `Sign-in failed (${res.status})`;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      /* non-JSON error page — keep the status message */
    }
    throw new Error(message);
  }

  // The session cookie IS the device credential from here on; the password is
  // never stored.
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("The server did not return a session");
  const cookie = setCookie.split(";")[0]!;

  const me = JSON.parse(text) as {
    clients: Array<{ id: string; name: string; locations: MeLocation[] }>;
    device?: { id: string; locationId: string | null };
  };
  if (!me.device) {
    // The account signed in but the server did not treat it as a device —
    // meaning it lacks devices.manage. Say so plainly rather than failing later
    // with an empty location list.
    throw new Error(
      "That account can't set up a computer. Ask the establishment's owner or your LIS administrator to sign in here once.",
    );
  }

  return {
    result: {
      cookie,
      deviceId: me.device.id,
      locations: me.clients.flatMap((c) => c.locations),
      clients: me.clients.map((c) => ({ id: c.id, name: c.name })),
      suggestedLocationId: me.device.locationId,
    },
    fingerprint,
    remoteUrl,
  };
}

/** Fetch the first full snapshot. Unbounded on purpose — see below. */
export async function fetchSnapshot(
  remoteUrl: string,
  cookie: string,
  locationId: string,
): Promise<Record<string, unknown>> {
  // No `from` on the FIRST pull. Bounding the initial load would leave the
  // mirror unable to reconcile any period older than the cutoff, and a device
  // that cannot compute last month's Full Audit offline is not a mirror.
  // Later pulls narrow with from + since.
  const res = await fetch(`${remoteUrl}/api/locations/${locationId}/sync/snapshot`, {
    headers: { cookie },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 403
        ? "This computer isn't allowed to download data yet — check it hasn't been revoked."
        : `Could not download the data (${res.status})`,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

export function configFrom(
  reg: Awaited<ReturnType<typeof registerDevice>>,
  locationId: string,
  locationName: string,
  deviceName: string,
): DesktopConfig {
  const clientId = reg.result.locations.find((l) => l.id === locationId)?.clientId;
  return {
    clientId,
    remoteUrl: reg.remoteUrl,
    fingerprint: reg.fingerprint,
    deviceName,
    deviceId: reg.result.deviceId,
    locationId,
    locationName,
    sessionEnc: encryptSession(reg.result.cookie),
  };
}
