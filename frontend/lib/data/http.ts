/**
 * The one place that talks HTTP to the catalogue API.
 *
 * Everything above this file (`api-adapter.ts`, preview, orders) gets a typed
 * result or a typed error — never a raw `fetch` and never a silent `undefined`.
 */

/** A failure the UI can branch on. `error.tsx` shows 404 differently from 500. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isNotFound() {
    return this.status === 404;
  }
  /** Worth showing a "try again" button for; a 404 is not. */
  get isRetryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

/**
 * Server-side base URL. Never exposed to the browser — the API key travels with
 * it, and the storefront reaches the backend through the `/api/ai/*` rewrite in
 * `next.config.ts` rather than directly.
 */
function baseUrl(): string {
  const url = process.env.CATALOG_API_URL ?? process.env.BACKEND_URL;
  if (!url) {
    throw new ApiError(
      0,
      "no_base_url",
      "CATALOG_API_URL is not set. Set it, or set CATALOG_SOURCE=seed to run on seed data.",
    );
  }
  return url.replace(/\/$/, "");
}

export interface FetchOptions {
  /** Seconds. Omit for `no-store` — correct for anything user- or time-specific. */
  revalidate?: number | false;
  /** Cache tags, so an admin save can invalidate exactly what changed. */
  tags?: string[];
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the retry — correct for non-idempotent writes like order creation. */
  noRetry?: boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 8_000;

function isTransient(status: number) {
  return status === 0 || status === 429 || status >= 500;
}

async function readError(res: Response, path: string): Promise<ApiError> {
  let code = `http_${res.status}`;
  let message = res.statusText || "Request failed";
  try {
    const body = await res.json();
    // FastAPI puts the message in `detail`; validation errors make it an array.
    if (typeof body?.detail === "string") message = body.detail;
    else if (Array.isArray(body?.detail)) message = JSON.stringify(body.detail);
    else if (typeof body?.error === "string") {
      code = body.error;
      message = body.message ?? body.error;
    }
  } catch {
    // Non-JSON error body — the status code is all we have, and that is fine.
  }
  return new ApiError(res.status, code, message, path);
}

/**
 * One retry on a transient failure, with jitter. Deliberately not more: a
 * storefront page that takes 30s to fail is worse than one that fails at 8s and
 * renders an error with a retry button.
 */
export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const {
    revalidate,
    tags,
    method = "GET",
    body,
    signal,
    noRetry = false,
    timeoutMs = DEFAULT_TIMEOUT,
  } = options;

  const url = `${baseUrl()}${path}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const apiKey = process.env.BACKEND_API_KEY;
  if (apiKey) headers["X-API-Key"] = apiKey;

  const attempts = noRetry || method !== "GET" ? 1 : 2;
  let lastError: ApiError | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    // A caller-supplied signal and our own timeout must both be able to abort.
    const timeout = AbortSignal.timeout(timeoutMs);
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

    try {
      const res = await fetch(url, {
        method,
        headers,
        signal: composed,
        body: body === undefined ? undefined : JSON.stringify(body),
        ...(revalidate === undefined
          ? { cache: "no-store" as const }
          : revalidate === false
            ? { cache: "no-store" as const }
            : { next: { revalidate, ...(tags ? { tags } : {}) } }),
      });

      if (!res.ok) {
        const err = await readError(res, path);
        if (attempt < attempts - 1 && isTransient(res.status)) {
          lastError = err;
          await sleep(250 + Math.random() * 250);
          continue;
        }
        throw err;
      }

      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof ApiError) throw err;

      // Caller aborted deliberately (navigation, a newer keystroke) — not an error.
      if (signal?.aborted) throw err;

      const network = new ApiError(
        0,
        err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network",
        err instanceof Error ? err.message : "Network request failed",
        path,
      );
      if (attempt < attempts - 1) {
        lastError = network;
        await sleep(250 + Math.random() * 250);
        continue;
      }
      throw network;
    }
  }

  throw lastError ?? new ApiError(0, "unknown", "Request failed", path);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Serialise a CatalogQuery into the repeated-param form the API expects
 * (`?classId=9&classId=10`), which is also the shape the storefront's
 * multi-select facets already put in the URL.
 */
export function toSearchParams(query: object = {}): string {
  const params = new URLSearchParams();
  // `object` rather than Record<string, unknown> so a typed CatalogQuery — which
  // has no index signature — can be passed without a cast at every call site.
  for (const [key, value] of Object.entries(query) as [string, unknown][]) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const v of value) if (v !== undefined && v !== null && v !== "") params.append(key, String(v));
    } else if (typeof value === "boolean") {
      if (value) params.set(key, "true");
    } else {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}
