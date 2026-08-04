import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy for the customer auth API.
 *
 * Everything under /api/auth/* is forwarded to the FastAPI service. Three
 * reasons this exists rather than the browser calling the backend directly:
 *
 *  1. `BACKEND_API_KEY` is injected here and never reaches the browser.
 *  2. The session cookie stays first-party. The browser only ever talks to the
 *     Next origin, so the cookie needs no cross-site relaxation — it stays
 *     SameSite=Lax, which is what makes it useless to another site.
 *  3. Set-Cookie from the backend is passed straight through, so login and
 *     logout work without the frontend knowing anything about the cookie.
 *
 * This is the CUSTOMER auth path. It is entirely separate from the LMS's own
 * auth and from this project's /admin-api — different service, different table,
 * different cookie (`cc_session`). A customer session can never satisfy an
 * admin check.
 */

const BACKEND = process.env.BACKEND_URL ?? "http://cc-api:8000";

async function forward(request: NextRequest, path: string[]) {
  const suffix = path.join("/");
  const url = new URL(`${BACKEND}/auth/${suffix}`);
  url.search = request.nextUrl.search;

  const headers: Record<string, string> = { Accept: "application/json" };
  const cookie = request.headers.get("cookie");
  if (cookie) headers["cookie"] = cookie;
  if (process.env.BACKEND_API_KEY) headers["X-API-Key"] = process.env.BACKEND_API_KEY;

  const contentType = request.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;

  // The real client IP, so rate limiting and the session audit trail record the
  // customer rather than the container's address.
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) headers["x-forwarded-for"] = forwardedFor;
  const agent = request.headers.get("user-agent");
  if (agent) headers["user-agent"] = agent;

  let body: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.text();
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: "Sign-in is temporarily unavailable. Please try again." },
      { status: 503 },
    );
  }

  const response = new NextResponse(
    upstream.status === 204 || upstream.status === 304 ? null : await upstream.arrayBuffer(),
    { status: upstream.status },
  );

  // Set-Cookie must be copied one header at a time. Reading it with
  // `headers.get()` folds multiple cookies into a single comma-joined string
  // that browsers then reject wholesale.
  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  for (const value of setCookies) response.headers.append("set-cookie", value);

  for (const header of ["content-type", "location", "cache-control"]) {
    const value = upstream.headers.get(header);
    if (value) response.headers.set(header, value);
  }
  return response;
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(request, path);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(request, path);
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(request, path);
}

export const dynamic = "force-dynamic";
