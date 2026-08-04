import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { catalog } from "@/lib/data";
import { BookCard } from "@/features/catalog/book-card";
import {
  ActiveFilters,
  FilterRail,
  Pagination,
  ResultsToolbar,
} from "@/features/catalog/filters";
import {
  BookGridSkeleton,
  FilterRailSkeleton,
  ResultsToolbarSkeleton,
} from "@/features/catalog/skeletons";
import { EmptyState } from "@/components/ui/empty-state";
import { paramList } from "@/lib/utils";
import type { Board, CatalogQuery, ClassId, Medium, Series, SortKey } from "@/types/catalog";

export const metadata: Metadata = {
  title: "Shop all books",
  description:
    "Browse 325+ guides, key notes and combo packs for Maharashtra State Board and CBSE — Classes Nursery to 12 in Marathi, Semi-English and English medium.",
  alternates: { canonical: "/shop" },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** URL → typed query. One place where untrusted strings become domain types. */
function toQuery(sp: Record<string, string | string[] | undefined>): CatalogQuery {
  return {
    board: (sp.board as Board) || undefined,
    classId: paramList(sp.class) as ClassId[],
    medium: paramList(sp.medium) as Medium[],
    subject: paramList(sp.subject),
    series: paramList(sp.series) as Series[],
    inStockOnly: sp.inStock === "1",
    q: typeof sp.q === "string" ? sp.q : undefined,
    sort: (sp.sort as SortKey) || "relevance",
    page: Number(sp.page) || 1,
    perPage: 24,
  };
}

/**
 * The catalogue half of the page, split out so it can suspend.
 *
 * This used to be inline, with `app/shop/loading.tsx` covering the wait. That
 * file had to go: `loading.tsx` creates a Suspense boundary for its segment AND
 * every child, so it made `/shop/[slug]` start streaming before the route knew
 * whether the book existed. Once the first byte is flushed the status line is
 * already committed to 200, and `notFound()` can only swap the UI — a soft 404
 * that gets bogus URLs indexed and writes an ISR entry per bad request.
 *
 * A `<Suspense>` *inside* this page does not extend to child routes, so the
 * skeleton is preserved here and `/shop/[slug]` still returns a real 404.
 */
async function ShopResults({ sp }: { sp: Awaited<SearchParams> }) {
  const query = toQuery(sp);
  const view = sp.view === "list" ? "list" : "grid";

  const [results, facets] = await Promise.all([
    catalog.getBooks(query),
    // Facets are computed without the pagination window so counts reflect the
    // whole result set, not the current page.
    catalog.getFacets({ ...query, page: undefined, perPage: undefined }),
  ]);

  return (
    <>
      <FilterRail facets={facets} />

      <div className="min-w-0">
        <ResultsToolbar total={results.total} shown={results.items.length} facets={facets} />
        <ActiveFilters facets={facets} />
        {results.items.length === 0 ? (
          <EmptyState
            title="No books match these filters"
            description="Try removing the medium or subject filter — the same title is often published in another medium."
            action={{ label: "Clear all filters", href: "/shop" }}
          />
        ) : view === "list" ? (
          <div className="space-y-4">
            {results.items.map((b) => (
              <BookCard key={b.slug} book={b} variant="list" />
            ))}
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {results.items.map((b, i) => (
              <li key={b.slug}>
                {/* Only the first row is above the fold on any viewport. */}
                <BookCard book={b} priority={i < 4} />
              </li>
            ))}
          </ul>
        )}
        <Pagination page={results.page} totalPages={results.totalPages} />
      </div>
    </>
  );
}

export default async function ShopPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  return (
    <div className="container-page py-8 md:py-12">
      <nav aria-label="Breadcrumb" className="mb-4 text-[length:var(--text-sm)] text-[color:var(--text-3)]">
        <Link href="/" className="hover:text-[color:var(--text-2)]">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-[color:var(--text-2)]">Shop</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-[length:var(--text-4xl)]">All books</h1>
        <p className="mt-2 max-w-2xl text-[length:var(--text-body)] text-[color:var(--text-2)]">
          Every guide, note and combo pack we publish — filter by class, medium,
          subject or series.
        </p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[16rem_1fr]">
        {/* Keyed on the query so changing a filter re-suspends and shows the
            skeleton again, rather than leaving the previous results on screen
            with no indication that anything is loading. */}
        <Suspense
          key={JSON.stringify(sp)}
          fallback={
            <>
              <FilterRailSkeleton />
              <div className="min-w-0">
                <ResultsToolbarSkeleton />
                <BookGridSkeleton />
              </div>
            </>
          }
        >
          <ShopResults sp={sp} />
        </Suspense>
      </div>
    </div>
  );
}

// BookGridSkeleton moved to features/catalog/skeletons.tsx — exporting a
// component from a route module means importing it drags this file's metadata,
// data fetches and generateStaticParams along, which is why nothing ever did.
