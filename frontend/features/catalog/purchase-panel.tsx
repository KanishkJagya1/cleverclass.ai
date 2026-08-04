"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { BookOpen, Minus, Plus, Truck } from "lucide-react";
import { SITE, mediumById } from "@/constants/catalog";
import { useCart } from "@/lib/store/cart";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { AddToCartButton, PriceBlock, StockBadge, WishlistButton, toCartItem } from "./atoms";
import { cn, formatPrice } from "@/lib/utils";
import type { Book } from "@/types/catalog";

/* --------------------------------------------------------------------------
   MediumSwitch — the highest-value control on the product page.

   Wrong-medium orders are the top support cost identified in Phase 1. The fix
   is placing the switch at the point of purchase; a "related products" link
   at the bottom of the page does not prevent the mistake, it only offers a
   remedy after it.
   -------------------------------------------------------------------------- */
export function MediumSwitch({ book, variants }: { book: Book; variants: Book[] }) {
  if (variants.length === 0) return null;
  const all = [book, ...variants].sort((a, b) => a.medium.localeCompare(b.medium));

  return (
    <div>
      <p className="mb-2 text-[length:var(--text-sm)] font-medium text-[color:var(--text-2)]">
        Medium
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Choose medium">
        {all.map((v) => {
          const m = mediumById(v.medium);
          const current = v.slug === book.slug;
          return (
            <Link
              key={v.slug}
              href={`/shop/${v.slug}`}
              aria-current={current ? "page" : undefined}
              className={cn(
                "rounded-[var(--radius-md)] border px-3.5 py-2 text-[length:var(--text-sm)] font-medium",
                "transition-colors duration-[var(--duration-fast)]",
                current
                  ? "border-[var(--brand-base)] bg-[var(--brand-soft)] text-[color:var(--text-brand)]"
                  : "border-[var(--border-1)] text-[color:var(--text-2)] hover:border-[var(--border-2)] hover:text-[color:var(--text-1)]",
              )}
            >
              <span lang={v.medium === "english" ? undefined : "mr"}>{m?.labelNative}</span>
              <span className="ml-1.5 text-[color:var(--text-3)]">{m?.label.replace(" Medium", "")}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* PurchasePanel                                                              */
/* -------------------------------------------------------------------------- */
export function PurchasePanel({ book, variants }: { book: Book; variants: Book[] }) {
  const [qty, setQty] = React.useState(1);
  const shortfall = Math.max(0, SITE.freeShippingThreshold - book.price * qty);

  return (
    <div className="surface-card p-5 lg:sticky lg:top-[calc(var(--nav-h)+1.5rem)] lg:p-6">
      <div className="flex items-start justify-between gap-4">
        <PriceBlock price={book.price} mrp={book.mrp} size="lg" />
        <StockBadge inStock={book.inStock} />
      </div>

      <div className="mt-5 space-y-5">
        <MediumSwitch book={book} variants={variants} />

        <div>
          <p className="mb-2 text-[length:var(--text-sm)] font-medium text-[color:var(--text-2)]">Quantity</p>
          <div className="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--border-1)]">
            <button
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty <= 1}
              aria-label="Decrease quantity"
              className="grid size-11 place-items-center text-[color:var(--text-2)] disabled:opacity-40 hover:bg-[var(--surface-0)] rounded-l-[var(--radius-md)]"
            >
              <Minus className="size-4" aria-hidden />
            </button>
            <span aria-live="polite" className="tabular w-10 text-center text-[length:var(--text-base)] font-medium">
              {qty}
            </span>
            <button
              onClick={() => setQty((q) => Math.min(20, q + 1))}
              aria-label="Increase quantity"
              className="grid size-11 place-items-center text-[color:var(--text-2)] hover:bg-[var(--surface-0)] rounded-r-[var(--radius-md)]"
            >
              <Plus className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        <div className="space-y-2.5">
          <AddToCartButton item={book} qty={qty} size="lg" full />

          {/* The sample CTA appears only when the book actually HAS one, and
              states the real page count rather than a guess. It used to render
              unconditionally against `book.previewPages`, which pointed at
              /previews/*.jpg files that had never existed — so every book on
              the site advertised a sample that opened a modal of broken images. */}
          {book.freePageCount ? (
            <Button asChild variant="secondary" size="lg" full className="lift-glow">
              <Link href={`/shop/${book.slug}/preview`}>
                <BookOpen className="size-4" aria-hidden />
                Read {book.freePageCount} pages free
              </Link>
            </Button>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border-1)] pt-4">
          <WishlistButton slug={book.slug} title={book.title} />
          <p className="flex items-center gap-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            <Truck className="size-4 text-[color:var(--signal-gain)]" aria-hidden />
            {shortfall === 0 ? (
              <span className="font-medium text-[color:var(--signal-gain)]">Free shipping on this order</span>
            ) : (
              <span>
                Add {formatPrice(shortfall)} more for free shipping
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Sticky mobile bar. Appears only once the main CTA scrolls out of view, so
   the two are never on screen together competing for the same tap.
   -------------------------------------------------------------------------- */
export function MobileBuyBar({ book }: { book: Book }) {
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    const target = document.getElementById("primary-buy");
    if (!target) return;
    const io = new IntersectionObserver(([entry]) => setShow(!entry?.isIntersecting), {
      rootMargin: "-120px 0px 0px 0px",
    });
    io.observe(target);
    return () => io.disconnect();
  }, []);

  // Publish this bar's height so the floating assistant launcher can sit above
  // it. Without this the launcher lands squarely on top of "Add to cart" — the
  // single most important tap target on the page.
  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--sticky-bar-h", show ? "4.75rem" : "0px");
    return () => root.style.setProperty("--sticky-bar-h", "0px");
  }, [show]);

  return (
    <div
      className={cn(
        "glass-chrome fixed inset-x-0 z-[var(--z-sticky)] flex items-center gap-3 p-3 lg:hidden",
        "!border-b-0 border-t border-[var(--border-glass)]",
        "transition-transform duration-[var(--duration-base)] ease-[var(--ease-standard)]",
        show ? "translate-y-0" : "translate-y-full",
      )}
      style={{ bottom: "var(--bottom-nav-h)" }}
      // `inert`, not `aria-hidden`. aria-hidden removed the bar from the
      // accessibility tree while leaving its buttons in the tab order, so a
      // keyboard user could focus an "Add to cart" button that was translated
      // off-screen and invisible. `inert` removes it from both.
      inert={!show}
    >
      <PriceBlock price={book.price} mrp={book.mrp} size="sm" className="flex-1" />
      <AddToCartButton item={book} size="md" className="flex-1" />
    </div>
  );
}

/* --------------------------------------------------------------------------
   FrequentlyBoughtTogether — the ₹200 threshold mechanism at item level.
   -------------------------------------------------------------------------- */
export function FrequentlyBoughtTogether({ anchor, others }: { anchor: Book; others: Book[] }) {
  const [selected, setSelected] = React.useState<string[]>(others.map((b) => b.slug));
  const add = useCart((s) => s.add);

  if (others.length === 0) return null;

  const chosen = others.filter((b) => selected.includes(b.slug));
  const total = anchor.price + chosen.reduce((s, b) => s + b.price, 0);
  const qualifies = total >= SITE.freeShippingThreshold;

  return (
    <section className="surface-card p-5 md:p-6" aria-labelledby="fbt-heading">
      <h2
        id="fbt-heading"
        className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-semibold text-[color:var(--text-1)]"
      >
        Frequently bought together
      </h2>

      <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="flex flex-wrap items-center gap-3">
          {[anchor, ...others].map((b, i) => (
            <React.Fragment key={b.slug}>
              {i > 0 && <Plus className="size-4 shrink-0 text-[color:var(--text-3)]" aria-hidden />}
              <div
                className={cn(
                  "relative aspect-cover w-20 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--surface-0)]",
                  i > 0 && !selected.includes(b.slug) && "opacity-40",
                )}
              >
                {b.images[0] && <Image src={b.images[0].src} alt="" fill sizes="80px" className="object-cover" />}
              </div>
            </React.Fragment>
          ))}
        </div>

        <ul className="flex-1 space-y-2.5">
          <li className="flex items-center gap-2.5 text-[length:var(--text-sm)]">
            <input type="checkbox" checked disabled className="size-4 accent-[var(--brand-base)]" />
            <span className="text-[color:var(--text-2)]">
              This item: <span className="text-[color:var(--text-1)]">{anchor.title}</span>
            </span>
            <span className="tabular ml-auto font-medium">{formatPrice(anchor.price)}</span>
          </li>
          {others.map((b) => (
            <li key={b.slug} className="flex items-center gap-2.5 text-[length:var(--text-sm)]">
              <input
                id={`fbt-${b.slug}`}
                type="checkbox"
                checked={selected.includes(b.slug)}
                onChange={(e) =>
                  setSelected((s) =>
                    e.target.checked ? [...s, b.slug] : s.filter((x) => x !== b.slug),
                  )
                }
                className="size-4 accent-[var(--brand-base)]"
              />
              <label htmlFor={`fbt-${b.slug}`} className="cursor-pointer text-[color:var(--text-2)]">
                {b.title}
              </label>
              <span className="tabular ml-auto font-medium">{formatPrice(b.price)}</span>
            </li>
          ))}
        </ul>

        <div className="shrink-0 border-t border-[var(--border-1)] pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <p className="text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            Total for {chosen.length + 1} item{chosen.length ? "s" : ""}
          </p>
          <p className="tabular mt-1 text-[length:var(--text-2xl)] font-semibold text-[color:var(--text-1)]">
            {formatPrice(total)}
          </p>
          {qualifies && (
            <Badge variant="gain" className="mt-2">
              <Truck className="size-3" aria-hidden />
              Free shipping
            </Badge>
          )}
          <Button
            className="mt-3"
            full
            onClick={() => {
              add(toCartItem(anchor));
              chosen.forEach((b) => add(toCartItem(b)));
            }}
          >
            Add {chosen.length + 1} to cart
          </Button>
        </div>
      </div>
    </section>
  );
}
