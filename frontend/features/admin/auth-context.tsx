"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { adminFetch, AdminApiError, type AdminUser } from "./api";

/**
 * Who is signed in, and the CSRF token for their session.
 *
 * The token is held in memory only. Persisting it to localStorage would make
 * it readable by any script on the page, which defeats the purpose — CSRF
 * protection depends on the attacker being unable to read the token even
 * though they can cause the cookie to be sent.
 *
 * Re-established from `/auth/me` on mount, since the cookie survives a reload
 * but React state does not.
 */

interface AdminAuth {
  user: AdminUser | null;
  status: "loading" | "authenticated" | "anonymous";
  csrf: string | undefined;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Call when a request 401s mid-session so the UI drops to the login screen. */
  onUnauthorized: () => void;
}

const Ctx = React.createContext<AdminAuth | null>(null);

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = React.useState<AdminUser | null>(null);
  const [status, setStatus] = React.useState<AdminAuth["status"]>("loading");

  React.useEffect(() => {
    let cancelled = false;
    adminFetch<AdminUser>("/auth/me")
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setStatus("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = React.useCallback(async (email: string, password: string) => {
    const me = await adminFetch<AdminUser>("/auth/login", {
      method: "POST",
      body: { email, password },
      // Login is the one write with no session yet — see the note on `csrf`.
      csrf: null,
    });
    setUser(me);
    setStatus("authenticated");
  }, []);

  const signOut = React.useCallback(async () => {
    try {
      await adminFetch("/auth/logout", { method: "POST", csrf: user?.csrfToken });
    } catch {
      /* Revoking server-side is best effort; clearing locally is not. */
    }
    setUser(null);
    setStatus("anonymous");
    router.replace("/admin/login");
  }, [router, user?.csrfToken]);

  const onUnauthorized = React.useCallback(() => {
    setUser(null);
    setStatus("anonymous");
    router.replace("/admin/login");
  }, [router]);

  const value = React.useMemo<AdminAuth>(
    () => ({ user, status, csrf: user?.csrfToken, signIn, signOut, onUnauthorized }),
    [user, status, signIn, signOut, onUnauthorized],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminAuth(): AdminAuth {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useAdminAuth must be used inside AdminAuthProvider");
  return ctx;
}

/**
 * Data loader that drops to the login screen when the session expires, instead
 * of rendering an error the user cannot act on.
 */
export function useAdminData<T>(path: string | null, deps: unknown[] = []) {
  const { status, onUnauthorized } = useAdminAuth();
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    if (status !== "authenticated" || !path) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    adminFetch<T>(path, { signal: controller.signal })
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof AdminApiError && err.isAuth) {
          onUnauthorized();
          return;
        }
        setError(err instanceof Error ? err.message : "Something went wrong");
        setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, path, nonce, ...deps]);

  return { data, error, loading, reload: () => setNonce((n) => n + 1) };
}
