"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { auth, AuthError } from "@/lib/auth/provider";
import { MeshBackground } from "@/components/motion";
import { Button } from "@/components/ui/button";

/**
 * Where the "confirm your email" link lands.
 *
 * Verifying on mount is right here even though it is a side effect on GET: the
 * whole purpose of the link IS the action, and asking someone who just clicked
 * "confirm" to click "confirm" again is friction with no benefit. The token is
 * single-use, so a link scanner that fetches it first would consume it — which
 * is why the copy on failure explains how to get another rather than treating
 * it as an error the customer caused.
 */
export default function VerifyEmailClient() {
  const search = useSearchParams();
  const token = search.get("token") ?? "";
  const [state, setState] = React.useState<"working" | "ok" | "failed">("working");
  const [message, setMessage] = React.useState("");

  React.useEffect(() => {
    if (!token) {
      setState("failed");
      setMessage("This link is missing its token.");
      return;
    }
    let alive = true;
    auth
      .verifyEmail(token)
      .then(() => alive && setState("ok"))
      .catch((err) => {
        if (!alive) return;
        setState("failed");
        setMessage(
          err instanceof AuthError ? err.message : "We could not confirm that link.",
        );
      });
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <div className="relative isolate flex min-h-[70vh] items-center justify-center px-[var(--gutter)] py-16">
      <MeshBackground />
      <div className="glass-panel glass-edge panel-solid w-full max-w-md p-7 text-center md:p-8">
        {state === "working" && (
          <p className="text-[length:var(--text-body)] text-[color:var(--text-2)]" role="status">
            Confirming your email…
          </p>
        )}

        {state === "ok" && (
          <>
            <CheckCircle2 className="mx-auto size-10 text-[color:var(--signal-gain)]" aria-hidden />
            <h1 className="mt-4 font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-semibold text-[color:var(--text-1)]">
              Email confirmed
            </h1>
            <p className="mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
              You&rsquo;re signed in. Any orders you placed as a guest with this
              address now appear in your order history.
            </p>
            <Button asChild className="mt-6" full>
              <Link href="/account">Go to your account</Link>
            </Button>
          </>
        )}

        {state === "failed" && (
          <>
            <XCircle className="mx-auto size-10 text-[color:var(--signal-danger)]" aria-hidden />
            <h1 className="mt-4 font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-semibold text-[color:var(--text-1)]">
              That link didn&rsquo;t work
            </h1>
            <p className="mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
              {message} Confirmation links last 48 hours and can only be used
              once. Sign in and we&rsquo;ll send you a fresh one.
            </p>
            <Button asChild className="mt-6" full>
              <Link href="/login">Sign in</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
