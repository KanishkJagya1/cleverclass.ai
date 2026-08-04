"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Small selectable pill — class, medium, subject, active filter.
 *
 * The same six-line `cn()` block was duplicated across the class hub, the combo
 * landing page, the account settings screen and the purchase panel, each with
 * slightly different padding and hover states. One component, one set of rules.
 *
 * `asChild` renders the chip as whatever you pass (usually a `Link`), so
 * navigation chips stay real anchors — middle-clickable, and announced as links.
 */
const chipVariants = cva(
  [
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium",
    "transition-[background-color,border-color,color] duration-[var(--duration-fast)]",
    // Global CSS already gives .chip-tap a 44px hit area on coarse pointers.
    "chip-tap",
  ].join(" "),
  {
    variants: {
      tone: {
        neutral:
          "border-[var(--border-1)] bg-[var(--surface-1)] text-[color:var(--text-2)]",
        brand:
          "border-[var(--brand-base)] bg-[var(--brand-soft)] text-[color:var(--text-brand)]",
        gain: "border-transparent bg-[var(--signal-gain-soft)] text-[color:var(--signal-gain)]",
        ai: "border-transparent bg-[var(--ai-soft)] text-[color:var(--color-ai)]",
        locked:
          "border-[var(--border-1)] bg-[var(--surface-0)] text-[color:var(--text-3)]",
        outline: "border-[var(--border-2)] bg-transparent text-[color:var(--text-2)]",
      },
      size: {
        sm: "px-2.5 py-1 text-[length:var(--text-2xs)]",
        md: "px-3.5 py-1.5 text-[length:var(--text-sm)]",
      },
      interactive: {
        true: "cursor-pointer hover:border-[var(--brand-base)] hover:text-[color:var(--text-brand)] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--focus-ring)_25%,transparent)]",
        false: "",
      },
      selected: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      // A selected chip must not also show the hover-to-select affordance.
      {
        selected: true,
        interactive: true,
        class:
          "border-[var(--brand-base)] bg-[var(--brand-soft)] text-[color:var(--text-brand)] hover:border-[var(--brand-base)]",
      },
    ],
    defaultVariants: { tone: "neutral", size: "md", interactive: false, selected: false },
  },
);

export interface ChipProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "color">,
    VariantProps<typeof chipVariants> {
  asChild?: boolean;
  /** Renders a remove affordance — used by the active-filter row. */
  onRemove?: () => void;
  removeLabel?: string;
}

export const Chip = React.forwardRef<HTMLElement, ChipProps>(function Chip(
  {
    className,
    tone,
    size,
    interactive,
    selected,
    asChild,
    onRemove,
    removeLabel,
    children,
    ...props
  },
  ref,
) {
  const Comp = (asChild ? Slot : "span") as React.ElementType;

  return (
    <Comp
      ref={ref}
      // Selection state must reach assistive tech, not just the eye.
      aria-current={selected ? "true" : undefined}
      className={cn(chipVariants({ tone, size, interactive, selected }), className)}
      {...props}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          aria-label={removeLabel ?? "Remove filter"}
          className="-mr-1 grid size-4 place-items-center rounded-full text-current opacity-60 transition-opacity hover:opacity-100"
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </Comp>
  );
});

export { chipVariants };
