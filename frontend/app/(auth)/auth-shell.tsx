"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, AuthError, GOOGLE_SIGNIN_URL } from "@/lib/auth/provider";
import { MeshBackground } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/primitives";

const schema = z.object({
  name: z.string().min(2, "Enter your name").optional(),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").optional(),
});
type Values = z.infer<typeof schema>;

export type AuthMode = "login" | "signup" | "forgot";

const COPY: Record<AuthMode, { title: string; sub: string; cta: string }> = {
  login: { title: "Welcome back", sub: "Sign in to see your orders, wishlist and downloads.", cta: "Sign in" },
  signup: { title: "Create your account", sub: "Track orders, save books and keep your downloads in one place.", cta: "Create account" },
  forgot: { title: "Reset your password", sub: "We'll email you a link to set a new password.", cta: "Send reset link" },
};

/**
 * One shell, three modes. Three near-identical page files would be three
 * places to fix the next accessibility issue.
 */
export function AuthShell({ mode }: { mode: AuthMode }) {
  const [done, setDone] = React.useState(false);
  const [doneMessage, setDoneMessage] = React.useState("");
  // A failed sign-in has to say WHY. The stub this replaced could not fail, so
  // there was nowhere to put a server message and every error was invisible.
  const [formError, setFormError] = React.useState<string | null>(null);
  const [google, setGoogle] = React.useState(false);
  const router = useRouter();
  const search = useSearchParams();
  const copy = COPY[mode];

  // The Google button appears only when the server says it is configured.
  // Rendering it unconditionally gives the customer a button that dead-ends.
  React.useEffect(() => {
    let alive = true;
    auth.providers().then((p) => {
      if (alive) setGoogle(p.google);
    });
    return () => {
      alive = false;
    };
  }, []);

  // The Google callback bounces back here with ?error= when it refuses.
  const callbackError = search.get("error");
  React.useEffect(() => {
    if (callbackError) setFormError(callbackError);
  }, [callbackError]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: "onBlur" });

  const onSubmit = async (v: Values) => {
    setFormError(null);
    try {
      if (mode === "login") {
        await auth.signIn(v.email, v.password ?? "");
        // Honour ?next= so someone bounced off /account lands back there.
        const next = search.get("next");
        router.replace(next && next.startsWith("/") ? next : "/account");
        router.refresh();
        return;
      }
      if (mode === "signup") {
        const result = await auth.signUp({
          name: v.name ?? "",
          email: v.email,
          password: v.password ?? "",
        });
        if (result.user) {
          router.replace("/account");
          router.refresh();
          return;
        }
        // No user back means that address already had an account. The server
        // will not confirm that — it emails the real owner instead — so this
        // copy has to read correctly either way without hinting which it was.
        setDoneMessage(
          "Check your email — we've sent a link to that address to finish signing in.",
        );
        setDone(true);
        return;
      }
      await auth.requestPasswordReset(v.email);
      setDoneMessage("If that email is registered, a reset link is on its way.");
      setDone(true);
    } catch (error) {
      setFormError(
        error instanceof AuthError
          ? error.message
          : "Something went wrong. Please try again.",
      );
    }
  };

  return (
    <div className="relative isolate flex min-h-[70vh] items-center justify-center px-[var(--gutter)] py-16">
      <MeshBackground />

      <div className="glass-panel panel-solid glass-edge w-full max-w-md p-7 md:p-8">
        <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-semibold text-[color:var(--text-1)]">
          {copy.title}
        </h1>
        <p className="mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">{copy.sub}</p>

        {done ? (
          <div className="mt-6 rounded-[var(--radius-lg)] bg-[var(--signal-gain-soft)] p-4" role="status">
            <p className="text-[length:var(--text-sm)] text-[color:var(--signal-gain)]">
              {doneMessage}
            </p>
            <Button asChild variant="secondary" size="sm" className="mt-4">
              <Link href="/account">Go to your account</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
            {formError && (
              // role="alert" so it is announced. A sign-in failure that only
              // appears visually strands anyone using a screen reader on a form
              // that looks like it did nothing.
              <div
                role="alert"
                className="rounded-[var(--radius-md)] border border-[var(--signal-danger)] bg-[var(--signal-danger-soft)] px-3.5 py-2.5 text-[length:var(--text-sm)] text-[color:var(--signal-danger)]"
              >
                {formError}
              </div>
            )}

            {mode === "signup" && (
              <div>
                <Label htmlFor="name">Full name</Label>
                <Input id="name" autoComplete="name" {...register("name")} />
                <FieldError>{errors.name?.message}</FieldError>
              </div>
            )}

            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...register("email")} />
              <FieldError>{errors.email?.message}</FieldError>
            </div>

            {mode !== "forgot" && (
              <div>
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="password">Password</Label>
                  {mode === "login" && (
                    <Link
                      href="/forgot-password"
                      // A standalone link beside a label, not one inside a
                      // sentence, so WCAG's inline exception does not cover it
                      // — and it measured 20px tall. The negative margin keeps
                      // the baseline aligned with the Label while the padding
                      // grows the hit area.
                      className="-my-2 mb-1.5 inline-flex items-center py-2 text-[length:var(--text-xs)] text-[color:var(--text-brand)] hover:underline coarse:min-h-11"
                    >
                      Forgot?
                    </Link>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  {...register("password")}
                />
                <FieldError>{errors.password?.message}</FieldError>
              </div>
            )}

            <Button type="submit" full size="lg" loading={isSubmitting}>
              {copy.cta}
            </Button>

            {google && mode !== "forgot" && (
              <>
                <div className="flex items-center gap-3 pt-1" aria-hidden>
                  <span className="h-px flex-1 bg-[var(--border-1)]" />
                  <span className="text-[length:var(--text-xs)] text-[color:var(--text-3)]">or</span>
                  <span className="h-px flex-1 bg-[var(--border-1)]" />
                </div>
                {/* A real link, not a fetch: the browser itself must navigate
                    to accounts.google.com for the OAuth round trip. */}
                <Button asChild variant="secondary" full size="lg">
                  <a href={GOOGLE_SIGNIN_URL}>
                    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
                      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
                      <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.7l4-3z" />
                      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
                    </svg>
                    Continue with Google
                  </a>
                </Button>
              </>
            )}
          </form>
        )}

        <p className="mt-6 text-center text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          {mode === "login" ? (
            <>
              New here?{" "}
              <Link href="/signup" className="font-medium text-[color:var(--text-brand)] underline underline-offset-4">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-[color:var(--text-brand)] underline underline-offset-4">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
