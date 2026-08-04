"use client";

import * as React from "react";
import { useWishlist } from "@/lib/store/wishlist";
import { BookCard } from "@/features/catalog/book-card";
import { BookCardSkeleton } from "@/features/catalog/book-card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Heart } from "lucide-react";
import type { Book } from "@/types/catalog";

export default function WishlistPage() {
  const { slugs, ready } = useWishlist();
  const [books, setBooks] = React.useState<Book[]>([]);
  const [status, setStatus] = React.useState<"idle" | "loading" | "ok" | "error">("idle");

  /**
   * Resolve the saved slugs against the real catalogue.
   *
   * This used to filter the bundled SEED_BOOKS module, which meant the wishlist
   * showed generated books with generated prices no matter what the catalogue
   * actually contained — and silently dropped anything the seed didn't happen
   * to include. `/api/ai/*` is the rewrite to the backend (next.config.ts).
   */
  React.useEffect(() => {
    if (!ready) return;
    if (slugs.length === 0) {
      setBooks([]);
      setStatus("ok");
      return;
    }

    const controller = new AbortController();
    setStatus("loading");
    fetch(`/api/ai/catalog/books/by-slugs?slugs=${encodeURIComponent(slugs.join(","))}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: Book[]) => {
        setBooks(data);
        setStatus("ok");
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        setStatus("error");
      });

    return () => controller.abort();
  }, [ready, slugs]);

  const loading = !ready || status === "loading" || status === "idle";

  return (
    <div>
      <h1 className="text-[length:var(--text-3xl)]">Wishlist</h1>
      <p className="tabular mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
        {status === "ok" ? `${books.length} saved` : "Loading…"}
      </p>

      <div className="mt-8">
        {status === "error" ? (
          <ErrorState
            title="Couldn't load your wishlist"
            description="Your saved books are safe — we just couldn't reach the catalogue."
            onRetry={() => setStatus("idle")}
          />
        ) : loading ? (
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
            {books.map((b) => (
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
