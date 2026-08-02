"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { classById, mediumById } from "@/constants/catalog";
import { TiltCard } from "@/components/motion";
import { Badge, Rating, Skeleton } from "@/components/ui/primitives";
import { AddToCartButton, PriceBlock, WishlistButton } from "./atoms";
import { cn, discountPct } from "@/lib/utils";
import type { Book } from "@/types/catalog";

export type BookCardVariant = "grid" | "list" | "compact" | "rank";

/**
 * The catalog's workhorse. Four structurally different renderings share one
 * data contract — which is how the home page shows books five times without
 * looking like five copies of the same section.
 *
 * Cover art sits on `.aspect-cover` (3:4, fixed) because this catalog's images
 * vary in size; without a locked ratio every grid row shifts as images land.
 */
export function BookCard({
  book,
  variant = "grid",
  priority,
  index,
  className,
}: {
  book: Book;
  variant?: BookCardVariant;
  /** Set on above-the-fold covers only — priority on all of them is priority on none. */
  priority?: boolean;
  index?: number;
  className?: string;
}) {
  const cls = classById(book.classId);
  const medium = mediumById(book.medium);
  const off = discountPct(book.price, book.mrp);
  const href = `/shop/${book.slug}`;
  const cover = book.images[0];

  /* ---------------------------------------------------------------- rank -- */
  if (variant === "rank") {
    return (
      <li
        className={cn(
          "group flex items-center gap-4 border-b border-[var(--border-1)] py-3.5 last:border-0",
          className,
        )}
      >
        <span
          className="tabular w-8 shrink-0 text-right font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-bold text-[color:var(--text-3)] transition-colors group-hover:text-[color:var(--brand-base)]"
          aria-hidden
        >
          {String((index ?? 0) + 1).padStart(2, "0")}
        </span>
        <Link href={href} className="relative aspect-cover w-11 shrink-0 overflow-hidden rounded-[var(--radius-xs)] bg-[var(--surface-0)]">
          {cover && (
            <Image src={cover.src} alt="" fill sizes="44px" className="object-cover" />
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={href} className="block">
            <p className="clamp-2 text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)] group-hover:text-[color:var(--brand-base)]">
              {book.title}
            </p>
          </Link>
          <p className="mt-0.5 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
            {book.subject} · {medium?.label}
          </p>
        </div>
        <Rating value={book.rating} size={12} className="hidden sm:flex" />
        <PriceBlock price={book.price} mrp={book.mrp} size="sm" className="shrink-0" />
        <AddToCartButton item={book} size="icon-sm" variant="secondary" aria-label={`Add ${book.title} to cart`}>
          <span aria-hidden>+</span>
        </AddToCartButton>
      </li>
    );
  }

  /* ---------------------------------------------------------------- list -- */
  if (variant === "list") {
    return (
      <article className={cn("surface-card flex gap-5 p-4 sm:p-5", className)}>
        <Link href={href} className="relative aspect-cover w-24 shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-[var(--surface-0)] sm:w-32">
          {cover && (
            <Image src={cover.src} alt={cover.alt} fill sizes="(max-width: 640px) 96px, 128px" className="object-cover" />
          )}
        </Link>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="brand">{cls?.label}</Badge>
            <Badge>{medium?.label}</Badge>
            {off !== null && <Badge variant="gain">{off}% off</Badge>}
          </div>
          <Link href={href} className="mt-2">
            <h3 className="clamp-2 text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
              {book.title}
            </h3>
          </Link>
          {book.titleMr && (
            <p lang="mr" className="clamp-2 mt-0.5 text-[length:var(--text-sm)] text-[color:var(--text-3)]">
              {book.titleMr}
            </p>
          )}
          <p className="clamp-2 mt-2 hidden text-[length:var(--text-sm)] text-[color:var(--text-2)] sm:block">
            {book.description}
          </p>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
            <div>
              <Rating value={book.rating} count={book.reviewCount} />
              <PriceBlock price={book.price} mrp={book.mrp} className="mt-1.5" />
            </div>
            <div className="flex items-center gap-2">
              <WishlistButton slug={book.slug} title={book.title} />
              <AddToCartButton item={book} size="sm" />
            </div>
          </div>
        </div>
      </article>
    );
  }

  /* ------------------------------------------------------------- compact -- */
  if (variant === "compact") {
    return (
      <Link href={href} className={cn("group flex w-36 shrink-0 flex-col gap-2.5", className)}>
        <div className="relative aspect-cover overflow-hidden rounded-[var(--radius-md)] bg-[var(--surface-0)] shadow-[var(--shadow-sm)] transition-shadow group-hover:shadow-[var(--shadow-lg)]">
          {cover && (
            <Image src={cover.src} alt={cover.alt} fill sizes="144px" className="object-cover" />
          )}
        </div>
        <p className="clamp-2 text-[length:var(--text-sm)] font-medium leading-snug text-[color:var(--text-1)]">
          {book.title}
        </p>
        <PriceBlock price={book.price} mrp={book.mrp} size="sm" />
      </Link>
    );
  }

  /* ---------------------------------------------------------------- grid -- */
  return (
    <TiltCard max={6} className={cn("h-full", className)}>
      <article className="surface-card group flex h-full flex-col overflow-hidden">
        <div className="relative aspect-cover overflow-hidden bg-[var(--surface-0)]">
          {cover && (
            <Image
              src={cover.src}
              alt={cover.alt}
              fill
              priority={priority}
              sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 22vw"
              className="object-cover transition-transform duration-[var(--duration-slow)] ease-[var(--ease-standard)] group-hover:scale-[1.03] motion-reduce:group-hover:scale-100"
            />
          )}

          {/* Spine shadow. A flat cover JPEG on a white card reads as a
              database record; a 2px gradient at the binding edge reads as a
              physical book. Cheapest premium cue on the whole site. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-black/18 to-transparent"
          />

          <div className="absolute left-2.5 top-2.5 flex flex-col gap-1.5">
            {off !== null && <Badge variant="solid">{off}% off</Badge>}
            {!book.inStock && <Badge variant="danger">Out of stock</Badge>}
          </div>

          <div className="absolute right-2.5 top-2.5 opacity-0 transition-opacity duration-[var(--duration-fast)] focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
            <WishlistButton slug={book.slug} title={book.title} floating />
          </div>
        </div>

        <div className="flex flex-1 flex-col p-4">
          <p className="text-[length:var(--text-2xs)] font-medium uppercase tracking-[var(--tracking-wide)] text-[color:var(--text-3)]">
            {cls?.short === "Nur" ? "Nursery" : `Class ${cls?.short}`} · {book.subject}
          </p>

          <Link href={href} className="mt-1.5 focus-visible:outline-none">
            {/* Stretched link: the whole card is the hit target, but the
                accessible name stays just the title. */}
            <span className="absolute inset-0" aria-hidden />
            <h3 className="clamp-2 text-[length:var(--text-base)] font-semibold leading-snug text-[color:var(--text-1)]">
              {book.title}
            </h3>
          </Link>

          {book.titleMr && (
            <p lang="mr" className="clamp-2 mt-1 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
              {book.titleMr}
            </p>
          )}

          <Rating value={book.rating} count={book.reviewCount} className="mt-2.5" />

          <div className="mt-auto flex items-end justify-between gap-2 pt-3.5">
            <PriceBlock price={book.price} mrp={book.mrp} size="sm" />
            <div className="relative z-10">
              <AddToCartButton
                item={book}
                size="icon-sm"
                variant="secondary"
                aria-label={`Add ${book.title} to cart`}
              >
                <span className="sr-only">Add to cart</span>
              </AddToCartButton>
            </div>
          </div>
        </div>
      </article>
    </TiltCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton — mirrors the grid variant's box model exactly, so swapping the    */
/* real card in shifts nothing.                                               */
/* -------------------------------------------------------------------------- */
export function BookCardSkeleton() {
  return (
    <div className="surface-card overflow-hidden">
      <Skeleton className="aspect-cover w-full rounded-none" />
      <div className="space-y-2.5 p-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-20" />
        <div className="flex items-center justify-between pt-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="size-9 rounded-full" />
        </div>
      </div>
    </div>
  );
}
