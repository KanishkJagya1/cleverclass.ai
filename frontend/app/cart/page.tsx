"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Minus, Plus, Trash2, Truck } from "lucide-react";
import { SITE, classById, mediumById } from "@/constants/catalog";
import { useCart, useCartTotals } from "@/lib/store/cart";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/primitives";
import { formatPrice } from "@/lib/utils";
import type { ClassId } from "@/types/catalog";

/**
 * The free-shipping meter is the highest-ROI element in this cart. With ASP
 * around ₹60 against a ₹200 threshold, closing a ₹40 gap by selling another
 * ₹30 book is strictly better business than absorbing the shipping cost.
 */
export default function CartPage() {
  const { items, ready, setQty, remove } = useCart();
  const totals = useCartTotals();

  if (!ready) {
    return (
      <div className="container-page py-12">
        <Skeleton className="h-10 w-40" />
        <div className="mt-8 space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="container-page py-16">
        <h1 className="mb-8 text-[length:var(--text-3xl)]">Your cart</h1>
        <EmptyState
          title="Your cart is empty"
          description="Combo packs are the quickest way to get a full year of books — and they ship free."
          action={{ label: "Browse combo packs", href: "/combo-packs" }}
        />
      </div>
    );
  }

  return (
    <div className="container-page py-8 md:py-12">
      <h1 className="text-[length:var(--text-3xl)]">Your cart</h1>
      <p className="tabular mt-1.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
        {items.reduce((n, i) => n + i.qty, 0)} item
        {items.reduce((n, i) => n + i.qty, 0) === 1 ? "" : "s"}
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
        {/* ------------------------------------------------------- lines -- */}
        <div>
          <ul className="divide-y divide-[var(--border-1)] border-y border-[var(--border-1)]">
            {items.map((item) => {
              const cls = classById(item.classId as ClassId);
              const href =
                item.format === "combo" ? `/combo-packs/${item.slug}` : `/shop/${item.slug}`;

              return (
                <li key={item.slug} className="flex gap-4 py-5">
                  <Link
                    href={href}
                    className="relative aspect-cover w-20 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--surface-0)]"
                  >
                    {item.image && (
                      <Image src={item.image} alt="" fill sizes="80px" className="object-cover" />
                    )}
                  </Link>

                  <div className="flex min-w-0 flex-1 flex-col">
                    <Link href={href}>
                      <p className="clamp-2 text-[length:var(--text-base)] font-medium text-[color:var(--text-1)]">
                        {item.title}
                      </p>
                    </Link>
                    <p className="mt-1 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                      {cls?.label} · {mediumById(item.medium)?.label}
                    </p>

                    <div className="mt-auto flex flex-wrap items-center gap-3 pt-3">
                      <div className="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--border-1)]">
                        <button
                          onClick={() => setQty(item.slug, item.qty - 1)}
                          aria-label={`Decrease quantity of ${item.title}`}
                          className="grid size-9 place-items-center text-[color:var(--text-2)] hover:bg-[var(--surface-0)]"
                        >
                          <Minus className="size-3.5" aria-hidden />
                        </button>
                        <span className="tabular w-8 text-center text-[length:var(--text-sm)]">
                          {item.qty}
                        </span>
                        <button
                          onClick={() => setQty(item.slug, item.qty + 1)}
                          aria-label={`Increase quantity of ${item.title}`}
                          className="grid size-9 place-items-center text-[color:var(--text-2)] hover:bg-[var(--surface-0)]"
                        >
                          <Plus className="size-3.5" aria-hidden />
                        </button>
                      </div>

                      <button
                        onClick={() => remove(item.slug)}
                        className="inline-flex items-center gap-1.5 text-[length:var(--text-xs)] text-[color:var(--text-3)] hover:text-[color:var(--signal-danger)]"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        Remove
                      </button>
                    </div>
                  </div>

                  <p className="tabular shrink-0 text-[length:var(--text-base)] font-semibold text-[color:var(--text-1)]">
                    {formatPrice(item.price * item.qty)}
                  </p>
                </li>
              );
            })}
          </ul>

          <Button asChild variant="ghost" size="sm" className="mt-5">
            <Link href="/shop">Continue shopping</Link>
          </Button>
        </div>

        {/* ----------------------------------------------------- summary -- */}
        <aside className="lg:sticky lg:top-[calc(var(--nav-h)+1.5rem)] lg:self-start">
          <div className="surface-card p-5">
            {/* Free-shipping meter */}
            <div className="mb-5">
              {totals.qualifies ? (
                <p className="flex items-center gap-2 text-[length:var(--text-sm)] font-medium text-[color:var(--signal-gain)]">
                  <Truck className="size-4" aria-hidden />
                  Free shipping unlocked
                </p>
              ) : (
                <p className="text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                  Add{" "}
                  <span className="tabular font-semibold text-[color:var(--text-1)]">
                    {formatPrice(totals.amountToFreeShipping)}
                  </span>{" "}
                  more for free shipping
                </p>
              )}
              <div
                className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-0)]"
                role="progressbar"
                aria-valuenow={Math.round(totals.progress)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progress toward free shipping"
              >
                <div
                  className="h-full rounded-full bg-[var(--signal-gain)] transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-standard)]"
                  style={{ width: `${totals.progress}%` }}
                />
              </div>
            </div>

            <dl className="space-y-2.5 border-t border-[var(--border-1)] pt-4 text-[length:var(--text-sm)]">
              <div className="flex justify-between">
                <dt className="text-[color:var(--text-2)]">Subtotal</dt>
                <dd className="tabular font-medium">{formatPrice(totals.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[color:var(--text-2)]">Shipping</dt>
                <dd className="tabular font-medium">
                  {totals.shipping === 0 ? (
                    <span className="text-[color:var(--signal-gain)]">Free</span>
                  ) : (
                    formatPrice(totals.shipping)
                  )}
                </dd>
              </div>
              <div className="flex justify-between border-t border-[var(--border-1)] pt-3 text-[length:var(--text-lg)]">
                <dt className="font-semibold">Total</dt>
                <dd className="tabular font-semibold">{formatPrice(totals.total)}</dd>
              </div>
            </dl>

            <Button asChild size="lg" full className="mt-5">
              <Link href="/checkout">
                Checkout
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>

            <p className="mt-3 text-center text-[length:var(--text-xs)] text-[color:var(--text-3)]">
              7-day returns · Ships from Nagpur
            </p>
          </div>

          {!totals.qualifies && (
            <p className="mt-4 text-center text-[length:var(--text-xs)] text-[color:var(--text-3)]">
              Tip: most combo packs ship free on their own.{" "}
              <Link href="/combo-packs" className="text-[color:var(--text-brand)] underline underline-offset-2">
                See packs
              </Link>
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
