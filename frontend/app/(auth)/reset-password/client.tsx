"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, AuthError } from "@/lib/auth/provider";
import { MeshBackground } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/primitives";

/**
 * Where the password-reset email lands.
 *
 * The token arrives in the query string and is spent on submit, not on load —
 * mail scanners and link previewers fetch URLs, and burning the token on GET
 * would mean the customer's own click always found it "already used".
 */
export default function ResetPasswordClient() {
  const router = useRouter();
  const search = useSearchParams();
  const token = search.get("token") ?? "";

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    try {
      await auth.resetPassword(token, password);
      // The server signs them in and kills every other session, so going
      // straight to the account is correct — asking them to log in again with
      // the password they just set is pure friction.
      router.replace("/account");
      router.refresh();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="relative isolate flex min-h-[70vh] items-center justify-center px-[var(--gutter)] py-16">
      <MeshBackground />
      <div className="glass-panel glass-edge panel-solid w-full max-w-md p-7 md:p-8">
        <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-semibold text-[color:var(--text-1)]">
          Choose a new password
        </h1>

        {!token ? (
          <>
            <p className="mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
              This link is missing its token. Reset links expire after an hour and
              can only be used once — request a fresh one and it will work.
            </p>
            <Button asChild className="mt-6" full>
              <Link href="/forgot-password">Request a new link</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
              Setting a new password signs you out everywhere else.
            </p>
            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
              {error && (
                <div
                  role="alert"
                  className="rounded-[var(--radius-md)] border border-[var(--signal-danger)] bg-[var(--signal-danger-soft)] px-3.5 py-2.5 text-[length:var(--text-sm)] text-[color:var(--signal-danger)]"
                >
                  {error}
                </div>
              )}
              <div>
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <FieldError>{tooShort ? "Use at least 8 characters" : undefined}</FieldError>
              </div>
              <div>
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
                <FieldError>{mismatch ? "The two passwords do not match" : undefined}</FieldError>
              </div>
              <Button type="submit" full size="lg" loading={busy}>
                Set new password
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
