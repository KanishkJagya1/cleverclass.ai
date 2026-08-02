"use client";

import * as React from "react";
import { useWishlist } from "@/lib/store/wishlist";
import { SEED_BOOKS } from "@/lib/data/seed";
import { BookCard } from "@/features/catalog/book-card";
import { BookCardSkeleton } from "@/features/catalog/book-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Heart } from "lucide-react";

export default function WishlistPage() {
  const { slugs, ready } = useWishlist();

  // Client-side resolution against the seed module. A remote adapter would
  // fetch by slug here — the component contract is identical either way.
  const books = React.useMemo(
    () => slugs.map((s) => SEED_BOOKS.find((b) => b.slug === s)).filter(Boolean),
    [slugs],
  );

  return (
    <div>
      <h1 className="text-[length:var(--text-3xl)]">Wishlist</h1>
      <p className="tabular mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
        {ready ? `${books.length} saved` : "Loading…"}
      </p>

      <div className="mt-8">
        {!ready ? (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <BookCardSkeleton />
              </li>
            ))}
          </ul>
        ) : books.length === 0 ? (
          <EmptyState
            icon={Heart}
            title="Nothing saved yet"
            description="Tap the heart on any book to keep it here for later."
            action={{ label: "Browse books", href: "/shop" }}
          />
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {books.map((b) => b && (
              <li key={b.slug}>
                <BookCard book={b} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
