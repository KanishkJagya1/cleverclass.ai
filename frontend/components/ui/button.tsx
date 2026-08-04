import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const button = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium",
    "rounded-[var(--radius-md)] select-none",
    "transition-[transform,box-shadow,background-color,border-color,color]",
    "duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
    "disabled:pointer-events-none disabled:opacity-50",
    // Touch feedback — the mobile equivalent of hover (D12).
    "active:scale-[0.98] motion-reduce:active:scale-100",
    "[&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--brand-base)] text-[color:var(--brand-on)] shadow-[var(--shadow-brand)] hover:bg-[var(--brand-hover)] hover:-translate-y-px motion-reduce:hover:translate-y-0",
        secondary:
          "bg-[var(--surface-1)] text-[color:var(--text-1)] border border-[var(--border-1)] shadow-[var(--shadow-sm)] hover:border-[var(--border-2)] hover:shadow-[var(--shadow-md)]",
        outline:
          "border border-[var(--border-2)] text-[color:var(--text-1)] hover:bg-[var(--surface-0)]",
        ghost: "text-[color:var(--text-2)] hover:bg-[var(--surface-0)] hover:text-[color:var(--text-1)]",
        // The only button that carries glass — it sits on chrome, not content.
        glass:
          "glass-panel !rounded-[var(--radius-md)] text-[color:var(--text-1)] hover:brightness-[1.04]",
        gain: "bg-[var(--signal-gain)] text-white hover:brightness-110",
        danger: "bg-[var(--signal-danger)] text-white hover:brightness-110",
        link: "text-[color:var(--brand-base)] underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        // 44px (h-11) minimum wherever a thumb is involved — WCAG 2.5.5.
        // `sm` and `icon-sm` are 36px, which is fine with a mouse and a
        // miss-tap machine on a phone, so they grow on coarse pointers. The
        // audit measured 36px targets on "Filters", "View combo", "Load map"
        // and the search button before this.
        sm: "h-9 coarse:h-11 px-3.5 text-[length:var(--text-sm)]",
        md: "h-11 px-5 text-[length:var(--text-base)]",
        lg: "h-[3.25rem] px-7 text-[length:var(--text-lg)]",
        icon: "size-11",
        "icon-sm": "size-9 coarse:size-11",
      },
      full: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, full, asChild, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(button({ variant, size, full }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            <span className="sr-only">Loading</span>
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { button as buttonVariants };
