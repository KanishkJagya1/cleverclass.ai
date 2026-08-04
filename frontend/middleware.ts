import { NextResponse, type NextRequest } from "next/server";
import { slugExists } from "@/lib/known-slugs";

/**
 * Route gate for /admin.
 *
 * This is a UX gate, NOT a security boundary. It only checks that a session
 * cookie is present — it cannot check whether that cookie is valid without a
 * database round trip on every navigation, and middleware runs before any of
 * the app's own auth logic.
 *
 * The real check happens twice, server-side, on every admin API call:
 * `current_admin` resolves the session against the database, and `require_csrf`
 * validates the token on writes. Deleting this file would not expose a single
 * record; it would only mean an unauthenticated visitor sees an admin shell
 * that immediately fails to load anything.
 *
 * /account is deliberately NOT gated here. Its auth provider is still a stub
 * (`lib/auth/provider.ts`), so there is no session to check; gating it would
 * lock every visitor out of pages that currently work. That gate lands with
 * real customer auth.
 */
const SESSION_COOKIE = "cc_admin";

/**
 * Product detail routes whose ISR cache a stranger could otherwise fill.
 *
 * `[1]` is the slug segment. Only single-segment matches are guarded, so
 * `/shop/<slug>/preview` falls through to the route (it resolves the same book
 * and 404s on its own, and guarding it here would duplicate that logic).
 */
const GUARDED = new Set(["shop", "combo-packs"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The login page must stay reachable, or signing in becomes impossible.
  if (pathname === "/admin/login") return NextResponse.next();

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!request.cookies.get(SESSION_COOKIE)) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      // Preserve where they were headed so login can return them there.
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ---------------------------------------------------------------- slugs --
  // Stop a request for a nonexistent product before it reaches the route.
  //
  // The route itself returns a correct 404, but Next still writes ~40 KB of ISR
  // cache per rendered slug and never evicts it — so requesting random slugs in
  // a loop fills the disk this box shares with the LMS. Answering here means no
  // render, so no cache entry.
  //
  // `slugExists` returns null when the catalogue is unreachable; that case falls
  // through deliberately. A guard that 404s real books during a backend blip
  // costs far more than the disk it saves.
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 2 && GUARDED.has(parts[0]!)) {
    if ((await slugExists(parts[1]!)) === false) {
      // Rewrite rather than return a bare 404, so the visitor gets the site's
      // own not-found page (app/not-found.tsx) instead of the browser's error
      // screen. The URL they typed stays in the address bar.
      return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
    }
  }

  return NextResponse.next();
}

export const config = {
  // Static assets and the API are excluded: the API does its own auth, and
  // running middleware on every image request is pure overhead.
  matcher: ["/admin", "/admin/:path*", "/shop/:path*", "/combo-packs/:path*"],
};
