"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const schema = z.object({
  email: z.string().min(1, "Enter your email address").email("That doesn't look like an email"),
});
type Values = z.infer<typeof schema>;

/**
 * No fake urgency, no popup, one field. The value proposition ("new editions
 * and offers, twice a term") is stated by the caller — a newsletter box that
 * doesn't say what it sends is why people don't subscribe.
 */
export function NewsletterForm({
  variant = "light",
  className,
}: {
  variant?: "light" | "dark";
  className?: string;
}) {
  const [done, setDone] = React.useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: "onBlur" });

  const onSubmit = async (_values: Values) => {
    // ponytail: no list provider wired yet. Swap for the ESP call when one is
    // chosen — the form contract does not change.
    await new Promise((r) => setTimeout(r, 400));
    setDone(true);
  };

  const dark = variant === "dark";

  if (done) {
    return (
      <p
        className={cn(
          "flex items-center gap-2 text-[length:var(--text-sm)]",
          dark ? "text-white" : "text-[var(--signal-gain)]",
          className,
        )}
        role="status"
      >
        <Check className="size-4" aria-hidden />
        You're on the list. Check your inbox to confirm.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className={cn("w-full max-w-sm", className)} noValidate>
      <div className="flex gap-2">
        <div className="flex-1">
          <label htmlFor={`nl-${variant}`} className="sr-only">
            Email address
          </label>
          <input
            id={`nl-${variant}`}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={errors.email ? "true" : undefined}
            aria-describedby={errors.email ? `nl-${variant}-err` : undefined}
            className={cn(
              "h-11 w-full rounded-[var(--radius-md)] px-3.5 text-[length:var(--text-base)]",
              "transition-[border-color,box-shadow] duration-[var(--duration-fast)]",
              "focus:outline-none focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--focus-ring)_25%,transparent)]",
              dark
                ? "border border-white/15 bg-white/10 text-white placeholder:text-white/45 focus:border-white/40"
                : "border border-[var(--border-1)] bg-[var(--surface-1)] text-[var(--text-1)] placeholder:text-[var(--text-3)] focus:border-[var(--focus-ring)]",
            )}
            {...register("email")}
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-[var(--radius-md)]",
            "transition-transform duration-[var(--duration-fast)] active:scale-95",
            "disabled:opacity-60 motion-reduce:active:scale-100",
            dark
              ? "bg-white text-[var(--color-indigo-950)] hover:bg-white/90"
              : "bg-[var(--brand-base)] text-[var(--brand-on)] hover:bg-[var(--brand-hover)]",
          )}
          aria-label="Subscribe"
        >
          <ArrowRight className="size-4" aria-hidden />
        </button>
      </div>
      {errors.email && (
        <p
          id={`nl-${variant}-err`}
          role="alert"
          className={cn(
            "mt-2 text-[length:var(--text-xs)]",
            dark ? "text-rose-300" : "text-[var(--signal-danger)]",
          )}
        >
          {errors.email.message}
        </p>
      )}
    </form>
  );
}
