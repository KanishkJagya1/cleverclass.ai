"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { auth } from "@/lib/auth/provider";
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
  const copy = COPY[mode];

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: "onBlur" });

  const onSubmit = async (v: Values) => {
    if (mode === "login") await auth.signIn(v.email, v.password ?? "");
    else if (mode === "signup") await auth.signUp(v.name ?? "", v.email, v.password ?? "");
    else await auth.requestPasswordReset(v.email);
    setDone(true);
  };

  return (
    <div className="relative isolate flex min-h-[70vh] items-center justify-center px-[var(--gutter)] py-16">
      <MeshBackground />

      <div className="glass-panel glass-edge w-full max-w-md p-7 md:p-8">
        <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-semibold text-[color:var(--text-1)]">
          {copy.title}
        </h1>
        <p className="mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">{copy.sub}</p>

        {done ? (
          <div className="mt-6 rounded-[var(--radius-lg)] bg-[var(--signal-gain-soft)] p-4" role="status">
            <p className="text-[length:var(--text-sm)] text-[color:var(--signal-gain)]">
              {mode === "forgot"
                ? "If that email is registered, a reset link is on its way."
                : "Signed in — accounts are running against a stubbed provider in this build."}
            </p>
            <Button asChild variant="secondary" size="sm" className="mt-4">
              <Link href="/account">Go to your account</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
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
                      className="mb-1.5 text-[length:var(--text-xs)] text-[color:var(--text-brand)] hover:underline"
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
