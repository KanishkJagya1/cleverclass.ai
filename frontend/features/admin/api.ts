"use client";

/**
 * Admin API client.
 *
 * Every call is same-origin: `/admin-api/*` is rewritten to the backend in
 * `next.config.ts`, which is what lets the session cookie stay HttpOnly and
 * SameSite=Lax. The browser never sees the backend's origin.
 *
 * Writes carry the CSRF token issued with the session. That token lives in
 * React state, never in localStorage — a token readable by any script is not a
 * CSRF defence at all.
 */

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }

  get isAuth() {
    return this.status === 401;
  }
  get isConflict() {
    return this.status === 409;
  }
}

async function parseError(res: Response): Promise<AdminApiError> {
  let message = res.statusText || "Request failed";
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") message = body.detail;
    else if (Array.isArray(body?.detail)) {
      // FastAPI validation errors: surface the field, not the whole blob.
      message = body.detail
        .map((d: { loc?: unknown[]; msg?: string }) =>
          `${(d.loc ?? []).slice(1).join(".") || "field"}: ${d.msg ?? "invalid"}`,
        )
        .join("; ");
    }
  } catch {
    /* non-JSON error body — the status is all we have */
  }
  return new AdminApiError(res.status, message);
}

export async function adminFetch<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    /**
     * The session's CSRF token. Pass `null` ONLY for login, which by
     * definition has no session yet and therefore nothing to forge — a
     * cross-site request that logs someone into their own account achieves
     * nothing. Every other write must pass a real token.
     */
    csrf?: string | null;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const { method = "GET", body, csrf, signal } = options;

  // FormData goes through untouched: the browser has to set Content-Type
  // itself so it can append the multipart boundary, and JSON.stringify on a
  // File yields "{}" — an upload that silently sends nothing.
  const isUpload = typeof FormData !== "undefined" && body instanceof FormData;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined && !isUpload) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrf !== null) {
    if (!csrf) {
      throw new AdminApiError(
        403,
        "Your session has expired. Reload the page and sign in again.",
      );
    }
    headers["X-CSRF-Token"] = csrf;
  }

  const res = await fetch(`/admin-api${path}`, {
    method,
    headers,
    // Same-origin, but explicit: without this the cookie is omitted on
    // cross-origin builds and every request 401s for no visible reason.
    credentials: "same-origin",
    body:
      body === undefined
        ? undefined
        : isUpload
          ? (body as FormData)
          : JSON.stringify(body),
    signal,
  });

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* --------------------------------------------------------------------------
   Types shared by the admin screens
   -------------------------------------------------------------------------- */

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  csrfToken: string;
}

export interface AdminBookRow {
  id: string;
  slug: string;
  title: string;
  classId: string;
  medium: string;
  subject: string;
  series: string;
  price: number;
  mrp: number | null;
  inStock: boolean;
  stockQty: number | null;
  status: "draft" | "published" | "archived";
  updatedAt: string;
  cover: string | null;
  /** null until a PDF is uploaded — drives the "needs a PDF" column. */
  pdfState: "pending" | "processing" | "ready" | "failed" | null;
  pageCount: number;
  freePages: number;
}

export interface AdminBook {
  id: string;
  slug: string;
  title: string;
  titleMr: string | null;
  /** Current front cover, or null when none has been uploaded. */
  cover: string | null;
  series: string;
  board: string;
  classId: string;
  medium: string;
  subject: string;
  stream: string | null;
  price: number;
  mrp: number | null;
  /** Sold in print, as a download, or both — each priced separately. */
  physicalAvailable: boolean;
  ebookAvailable: boolean;
  ebookPrice: number | null;
  pages: number;
  isbn: string | null;
  edition: string;
  description: string;
  highlights: string[];
  marketingCopy: string;
  chapterList: string[];
  inStock: boolean;
  stockQty: number | null;
  status: "draft" | "published" | "archived";
  publishedAt: string;
  updatedAt: string;
  asset: {
    id: string;
    originalName: string;
    pageCount: number;
    processState: string;
    processError: string | null;
    pagesDone: number;
  } | null;
  freeRanges: { start: number; end: number }[];
}

export interface AdminStats {
  books: {
    total: number;
    published: number;
    draft: number;
    outOfStock: number;
    withPdf: number;
    withFreePages: number;
  };
  combos: number;
  keyNotes: number;
  orders: { total: number; requested: number };
  leads: { contact: number; newsletter: number };
}
