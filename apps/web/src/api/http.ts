export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /**
     * Machine-readable reason from the server (`SIMILAR_ITEM`,
     * `SUBSCRIPTION_VIEW_ONLY`, `DUPLICATE`, …). The server has always sent
     * this; dropping it forced callers to match on message text, which breaks
     * the moment the wording is improved.
     */
    public code?: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    let code: string | null = null;
    try {
      const body = (await res.json()) as { error?: string; code?: string | null };
      if (body.error) message = body.error;
      code = body.code ?? null;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, message, code);
  }
  return res.json() as Promise<T>;
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const put = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) });

/**
 * Body is optional: most deletes need none, but the ones that undo a security
 * control (turning off a second factor) require the caller to re-prove
 * themselves in the same request.
 */
export const del = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "DELETE", body: body === undefined ? undefined : JSON.stringify(body) });

export async function downloadFile(path: string): Promise<void> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error
    }
    throw new ApiError(res.status, message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const filename = /filename="(.+?)"/.exec(disposition)?.[1] ?? "report";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
