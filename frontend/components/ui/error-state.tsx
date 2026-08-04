"use client";

import { AlertTriangle, Phone, RotateCw } from "lucide-react";
import { SITE } from "@/constants/catalog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What a failed data fetch looks like.
 *
 * Three rules, learned from the states this codebase used to have:
 *   1. Never blame the user. "Search is unavailable" not "no results".
 *   2. Always give a way forward — retry, or the phone number.
 *   3. Never show a raw error message. It means nothing to a parent buying a
 *      textbook and it leaks stack shape to everyone else.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "This is on us, not you. Try again in a moment.",
  onRetry,
  retryLabel = "Try again",
  showPhone = true,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  showPhone?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn("mx-auto max-w-md py-14 text-center", className)}
    >
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--signal-danger-soft)] text-[color:var(--signal-danger)]">
        <AlertTriangle className="size-5" aria-hidden />
      </span>
      <h2 className="mt-5 font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-semibold text-[color:var(--text-1)]">
        {title}
      </h2>
      <p className="mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
        {description}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {onRetry && (
          <Button onClick={onRetry}>
            <RotateCw className="size-4" aria-hidden />
            {retryLabel}
          </Button>
        )}
        {showPhone && (
          <Button asChild variant="secondary">
            <a href={`tel:${SITE.phones[0]}`}>
              <Phone className="size-4" aria-hidden />
              Call {SITE.phones[0]}
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
