import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { catalog } from "@/lib/data";
import { BookCard, BookCardSkeleton } from "@/features/catalog/book-card";
import {
  ActiveFilters,
  FilterRail,
  Pagination,
  ResultsToolbar,
} from "@/features/catalog/filters";
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

export default async function ShopPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const query = toQuery(sp);
  const view = sp.view === "list" ? "list" : "grid";

  const [results, facets] = await Promise.all([
    catalog.getBooks(query),
    // Facets are computed without the pagination window so counts reflect the
    // whole result set, not the current page.
    catalog.getFacets({ ...query, page: undefined, perPage: undefined }),
  ]);

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
        <Suspense>
          <FilterRail facets={facets} />
        </Suspense>

        <div className="min-w-0">
          <Suspense>
            <ResultsToolbar total={results.total} shown={results.items.length} facets={facets} />
            <ActiveFilters facets={facets} />
          </Suspense>

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

          <Suspense>
            <Pagination page={results.page} totalPages={results.totalPages} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

/** Exported for reuse by class/series pages that render the same grid. */
export function BookGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <BookCardSkeleton />
        </li>
      ))}
    </ul>
  );
}
