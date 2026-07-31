"use client";

import * as React from "react";
import { Check, Heart, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { useCart } from "@/lib/store/cart";
import { useWishlist } from "@/lib/store/wishlist";
import { Badge } from "@/components/ui/primitives";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn, discountPct, formatPrice } from "@/lib/utils";
import type { Book, CartItem, Combo } from "@/types/catalog";

/* -------------------------------------------------------------------------- */
/* PriceBlock                                                                 */
/* -------------------------------------------------------------------------- */
export function PriceBlock({
  price,
  mrp,
  size = "md",
  className,
}: {
  price: number;
  mrp?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const off = discountPct(price, mrp);
  const sizes = {
    sm: "text-[length:var(--text-base)]",
    md: "text-[length:var(--text-xl)]",
    lg: "text-[length:var(--text-3xl)]",
  } as const;

  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-1", className)}>
      <span className={cn("tabular font-semibold text-[var(--text-1)]", sizes[size])}>
        {formatPrice(price)}
      </span>
      {off !== null && (
        <>
          <span className="tabular text-[length:var(--text-sm)] text-[var(--text-3)] line-through">
            {formatPrice(mrp!)}
          </span>
          {/* Emerald-700 token — the AA-passing one. See design system §3. */}
          <span className="tabular text-[length:var(--text-sm)] font-semibold text-[var(--signal-gain)]">
            {off}% off
          </span>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* WishlistButton                                                             */
/* -------------------------------------------------------------------------- */
export function WishlistButton({
  slug,
  title,
  className,
  floating,
}: {
  slug: string;
  title: string;
  className?: string;
  floating?: boolean;
}) {
  const { slugs, toggle, ready } = useWishlist();
  const saved = ready && slugs.includes(slug);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(slug);
        toast(saved ? "Removed from wishlist" : "Saved to wishlist", { description: title });
      }}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${title} from wishlist` : `Save ${title} to wishlist`}
      className={cn(
        "grid place-items-center rounded-full transition-all duration-[var(--duration-fast)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        floating
          ? "glass-panel !rounded-full size-9 !border-[var(--border-glass)] hover:scale-105 motion-reduce:hover:scale-100"
          : "size-11 hover:bg-[var(--surface-0)]",
        className,
      )}
    >
      <Heart
        className={cn(
          "size-4 transition-colors",
          saved ? "fill-[var(--signal-danger)] text-[var(--signal-danger)]" : "text-[var(--text-2)]",
        )}
        aria-hidden
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* AddToCartButton                                                            */
/* -------------------------------------------------------------------------- */
type Addable = Pick<Book, "slug" | "title" | "titleMr" | "price" | "mrp" | "classId" | "medium" | "images" | "inStock">;

export function toCartItem(item: Addable, format: CartItem["format"] = "book"): Omit<CartItem, "qty"> {
  return {
    slug: item.slug,
    format,
    title: item.title,
    titleMr: item.titleMr,
    price: item.price,
    mrp: item.mrp,
    image: item.images[0]?.src ?? "",
    classId: item.classId,
    medium: item.medium,
  };
}

export function AddToCartButton({
  item,
  format = "book",
  qty = 1,
  children,
  ...props
}: {
  item: Addable;
  format?: CartItem["format"];
  qty?: number;
} & Omit<ButtonProps, "children"> & { children?: React.ReactNode }) {
  const add = useCart((s) => s.add);
  const [added, setAdded] = React.useState(false);

  // The confirmation reverts after 1.6s. A button that stays "Added" forever
  // can't be used to add a second copy, which people genuinely try to do.
  React.useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(false), 1600);
    return () => clearTimeout(t);
  }, [added]);

  if (!item.inStock) {
    return (
      <Button disabled variant="secondary" {...props}>
        Out of stock
      </Button>
    );
  }

  return (
    <Button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        add(toCartItem(item, format), qty);
        setAdded(true);
        toast.success("Added to cart", { description: item.title });
      }}
      {...props}
    >
      {added ? (
        <>
          <Check className="size-4" aria-hidden />
          Added
        </>
      ) : (
        children ?? (
          <>
            <ShoppingBag className="size-4" aria-hidden />
            Add to cart
          </>
        )
      )}
      {/* Announced to screen readers without changing the visible label twice. */}
      <span aria-live="polite" className="sr-only">
        {added ? `${item.title} added to cart` : ""}
      </span>
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* StockBadge                                                                 */
/* -------------------------------------------------------------------------- */
export function StockBadge({ inStock }: { inStock: boolean }) {
  return inStock ? (
    <Badge variant="gain">
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      In stock
    </Badge>
  ) : (
    <Badge variant="danger">Out of stock</Badge>
  );
}

/* -------------------------------------------------------------------------- */
/* SavingsMeter — the combo persuasion unit. Rupees, not percentages.         */
/* -------------------------------------------------------------------------- */
export function SavingsMeter({
  itemsTotal,
  price,
  savings,
  savingsPct,
  invert,
}: Pick<
  { itemsTotal: number; price: number; savings: number; savingsPct: number },
  "itemsTotal" | "price" | "savings" | "savingsPct"
> & { invert?: boolean }) {
  const rows = [
    { label: "Bought separately", value: formatPrice(itemsTotal), strike: true },
    { label: "Combo price", value: formatPrice(price) },
  ];

  return (
    <div className={cn("text-[length:var(--text-sm)]", invert ? "text-[var(--color-ink-300)]" : "text-[var(--text-2)]")}>
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between py-1.5">
          <span>{r.label}</span>
          <span className={cn("tabular", r.strike && "line-through opacity-70")}>{r.value}</span>
        </div>
      ))}
      <div
        className={cn(
          "mt-1 flex items-baseline justify-between border-t pt-2.5 font-semibold",
          invert ? "border-white/15 text-white" : "border-[var(--border-1)] text-[var(--signal-gain)]",
        )}
      >
        <span>You save</span>
        <span className="tabular">
          {formatPrice(savings)} <span className="opacity-70">({savingsPct}%)</span>
        </span>
      </div>
    </div>
  );
}
