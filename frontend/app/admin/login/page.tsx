"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Lock, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/primitives";
import { useAdminAuth } from "@/features/admin/auth-context";
import { AdminApiError } from "@/features/admin/api";

const schema = z.object({
  email: z.string().email("Enter your email address"),
  password: z.string().min(1, "Enter your password"),
});
type Values = z.infer<typeof schema>;

export default function AdminLoginPage() {
  const router = useRouter();
  const { signIn, status } = useAdminAuth();
  const [failure, setFailure] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: "onBlur" });

  // Already signed in — skip the form.
  React.useEffect(() => {
    if (status === "authenticated") router.replace("/admin");
  }, [status, router]);

  const submit = async (values: Values) => {
    setFailure(null);
    try {
      await signIn(values.email, values.password);
      router.replace("/admin");
    } catch (err) {
      // The server deliberately does not say WHICH of the two was wrong, and
      // neither does this — that difference is an account-enumeration oracle.
      setFailure(
        err instanceof AdminApiError && err.status === 429
          ? err.message
          : "Incorrect email or password.",
      );
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-[var(--surface-canvas)] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[color:var(--text-brand)]">
            <Lock className="size-5" aria-hidden />
          </span>
          <h1 className="mt-5 font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-semibold text-[color:var(--text-1)]">
            CleverClass Admin
          </h1>
          <p className="mt-1.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            Sign in to manage the catalogue.
          </p>
        </div>

        <form onSubmit={handleSubmit(submit)} className="surface-card p-6" noValidate>
          <div className="space-y-4">
            <div>
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                type="email"
                autoComplete="username"
                autoFocus
                {...register("email")}
              />
              <FieldError>{errors.email?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="admin-password">Password</Label>
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                {...register("password")}
              />
              <FieldError>{errors.password?.message}</FieldError>
            </div>
          </div>

          {failure && (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius-md)] bg-[var(--signal-danger-soft)] px-3.5 py-2.5 text-[length:var(--text-sm)] text-[color:var(--signal-danger)]"
            >
              {failure}
            </p>
          )}

          <Button type="submit" size="lg" full className="mt-6" loading={isSubmitting}>
            Sign in
          </Button>
        </form>

        {/*
          Stated plainly rather than hidden. The deployment runs on plain HTTP
          by an explicit decision; whoever signs in should know what that means.
        */}
        <p className="mt-6 flex items-start gap-2 text-[length:var(--text-xs)] leading-[var(--leading-relaxed)] text-[color:var(--text-3)]">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            This panel is served over plain HTTP. Your password and session are
            not encrypted in transit — sign in only from a network you trust.
          </span>
        </p>
      </div>
    </div>
  );
}
