"use client";

/**
 * Sign out.
 *
 * Lives in the account nav where people look for it, rather than only in a
 * header dropdown. It renders nothing when there is no session — an account
 * area reachable by a signed-out visitor should not offer to sign them out.
 *
 * A full reload rather than a router push: the session cookie is HttpOnly, so
 * client-side state cannot know it is gone, and a soft navigation would leave
 * stale personal data rendered until something happened to refetch it.
 */

import * as React from "react";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const [signedIn, setSignedIn] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
      .then((r) => {
        if (!cancelled) setSignedIn(r.ok);
      })
      .catch(() => {
        if (!cancelled) setSignedIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!signedIn) return null;

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      window.location.href = "/";
    }
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      className="flex min-h-11 w-full items-center gap-2.5 whitespace-nowrap rounded-[var(--radius-md)] px-3.5 py-2.5 text-[length:var(--text-sm)] text-[color:var(--text-2)] transition-colors hover:bg-[var(--surface-0)] hover:text-[color:var(--text-1)] disabled:opacity-50"
    >
      <LogOut className="size-4 shrink-0" aria-hidden />
      {busy ? "Signing out…" : "Log out"}
    </button>
  );
}
