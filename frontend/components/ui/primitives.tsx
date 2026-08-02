import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Badge                                                                      */
/* -------------------------------------------------------------------------- */
const badge = cva(
  "inline-flex items-center gap-1 rounded-full font-medium leading-none whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "bg-[var(--surface-0)] text-[color:var(--text-2)] border border-[var(--border-1)]",
        brand: "bg-[var(--brand-soft)] text-[color:var(--text-brand)]",
        // Emerald-700 — the AA-passing token. See design system §3.
        gain: "bg-[var(--signal-gain-soft)] text-[color:var(--signal-gain)]",
        solid: "bg-[var(--brand-base)] text-[color:var(--brand-on)]",
        danger: "bg-[var(--surface-0)] text-[color:var(--signal-danger)]",
        glass: "glass-panel !rounded-full text-[color:var(--text-1)]",
      },
      size: {
        sm: "px-2 py-1 text-[length:var(--text-2xs)]",
        md: "px-2.5 py-1.5 text-[length:var(--text-xs)]",
      },
    },
    defaultVariants: { variant: "neutral", size: "sm" },
  },
);

export function Badge({
  className,
  variant,
  size,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ variant, size }), className)} {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Input / Textarea                                                           */
/* -------------------------------------------------------------------------- */
const fieldBase = [
  "w-full rounded-[var(--radius-md)] bg-[var(--surface-1)]",
  "border border-[var(--border-1)] px-3.5 text-[length:var(--text-base)]",
  "text-[color:var(--text-1)] placeholder:text-[color:var(--text-3)]",
  "transition-[border-color,box-shadow] duration-[var(--duration-fast)]",
  "focus:border-[var(--focus-ring)] focus:outline-none",
  "focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--focus-ring)_18%,transparent)]",
  "disabled:opacity-60 aria-[invalid=true]:border-[var(--signal-danger)]",
].join(" ");

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldBase, "h-11", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldBase, "min-h-28 py-3 resize-y", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("block text-[length:var(--text-sm)] font-medium text-[color:var(--text-2)] mb-1.5", className)}
      {...props}
    />
  );
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1.5 text-[length:var(--text-xs)] text-[color:var(--signal-danger)]">
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton — must match the final layout exactly, or it trades a spinner for  */
/* a layout shift.                                                            */
/* -------------------------------------------------------------------------- */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-[var(--radius-md)] bg-[var(--surface-0)]",
        "motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Rating                                                                     */
/* -------------------------------------------------------------------------- */
export function Rating({
  value,
  count,
  size = 14,
  className,
}: {
  value: number;
  count?: number;
  size?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div className="flex items-center gap-0.5" role="img" aria-label={`Rated ${value} out of 5`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            width={size}
            height={size}
            aria-hidden
            className={
              i <= Math.round(value)
                ? "fill-[var(--signal-rating)] text-[color:var(--signal-rating)]"
                : "text-[color:var(--border-2)]"
            }
          />
        ))}
      </div>
      <span className="tabular text-[length:var(--text-xs)] text-[color:var(--text-2)]">
        {value.toFixed(1)}
        {count !== undefined && (
          <span className="text-[color:var(--text-3)]"> ({count})</span>
        )}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section — enforces the whitespace + rhythm contract (design system §5.1)    */
/* -------------------------------------------------------------------------- */
export function Section({
  band = "canvas",
  width = "container",
  spacing = "md",
  className,
  children,
  ...props
}: React.ComponentProps<"section"> & {
  band?: "canvas" | "white" | "brand-dark" | "brand-soft";
  width?: "container" | "prose" | "full";
  spacing?: "sm" | "md" | "lg";
}) {
  const bands = {
    canvas: "bg-[var(--surface-canvas)]",
    white: "bg-[var(--surface-1)]",
    // .on-dark-band forces the dark glass recipe for descendants — see
    // glass.css. Without it, glass buttons and badges here render white-on-
    // white in light mode.
    "brand-dark":
      "on-dark-band bg-[var(--color-indigo-950)] text-[color:var(--color-ink-100)]",
    "brand-soft": "bg-[var(--brand-soft)]",
  } as const;
  const widths = {
    container: "container-page",
    prose: "container-prose",
    full: "w-full",
  } as const;
  const spacings = { sm: "section-y-sm", md: "section-y", lg: "section-y-lg" } as const;

  return (
    <section className={cn("relative", bands[band], spacings[spacing], className)} {...props}>
      <div className={widths[width]}>{children}</div>
    </section>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
  align = "left",
  invert,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  align?: "left" | "center";
  invert?: boolean;
}) {
  return (
    <div
      className={cn(
        "mb-10 flex flex-col gap-4 md:mb-14",
        align === "center" ? "items-center text-center" : "md:flex-row md:items-end md:justify-between",
      )}
    >
      <div className={cn("max-w-2xl", align === "center" && "mx-auto")}>
        {eyebrow && (
          <p
            className={cn(
              "mb-3 text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-wide)]",
              invert ? "text-[color:var(--color-indigo-300)]" : "text-[color:var(--text-brand)]",
            )}
          >
            {eyebrow}
          </p>
        )}
        <h2
          className={cn(
            "text-[length:var(--text-3xl)]",
            invert ? "text-white" : "text-[color:var(--text-1)]",
          )}
        >
          {title}
        </h2>
        {description && (
          <p
            className={cn(
              "mt-3 text-[length:var(--text-body)] leading-[var(--leading-relaxed)]",
              invert ? "text-[color:var(--color-ink-300)]" : "text-[color:var(--text-2)]",
            )}
          >
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
