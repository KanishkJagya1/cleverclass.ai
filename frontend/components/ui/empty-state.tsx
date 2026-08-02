import * as React from "react";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

/**
 * Empty states carry the *nearest useful action*, never just an apology.
 * "No Class 9 English books" is a dead end; "no Class 9 English books —
 * 14 exist in Marathi" is a recovery path.
 */
export function EmptyState({
  icon: Icon = SearchX,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ElementType;
  title: string;
  description?: string;
  action?: { label: string; href: string } | React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--radius-xl)] border border-dashed",
        "border-[var(--border-2)] bg-[var(--surface-0)]/50 px-6 py-16 text-center",
        className,
      )}
    >
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-[var(--surface-1)] text-[color:var(--text-3)] shadow-[var(--shadow-sm)]">
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
        {title}
      </p>
      {description && (
        <p className="mt-2 max-w-sm text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]">
          {description}
        </p>
      )}
      {action && (
        <div className="mt-6">
          {React.isValidElement(action) ? (
            action
          ) : (
            <Button asChild variant="secondary" size="sm">
              <Link href={(action as { href: string }).href}>
                {(action as { label: string }).label}
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
