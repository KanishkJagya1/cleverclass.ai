import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SERIES, seriesById } from "@/constants/catalog";
import { catalog } from "@/lib/data";
import { BookCard } from "@/features/catalog/book-card";
import { EmptyState } from "@/components/ui/empty-state";
import type { Series } from "@/types/catalog";

export const revalidate = 43200;

export function generateStaticParams() {
  return SERIES.map((s) => ({ series: s.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ series: string }>;
}): Promise<Metadata> {
  const { series } = await params;
  const s = seriesById(series as Series);
  if (!s) return {};

  return {
    title: `${s.label} series`,
    description: s.positioning,
    alternates: { canonical: `/series/${series}` },
  };
}

/** The fifth taxonomy axis — a teacher who says "get the Spark books" needs a
    route that isn't search. */
export default async function SeriesPage({
  params,
}: {
  params: Promise<{ series: string }>;
}) {
  const { series } = await params;
  const s = seriesById(series as Series);
  if (!s) notFound();

  const books = await catalog.getBooks({ series: [s.id], perPage: 48 });

  return (
    <div className="container-page py-8 md:py-12">
      <nav aria-label="Breadcrumb" className="mb-5 text-[length:var(--text-sm)] text-[var(--text-3)]">
        <Link href="/" className="hover:text-[var(--text-2)]">Home</Link>
        <span className="mx-2">/</span>
        <span className="text-[var(--text-2)]">{s.label}</span>
      </nav>

      <header className="mb-10 max-w-2xl">
        <span
          aria-hidden
          className="mb-5 block h-1 w-12 rounded-full"
          style={{ backgroundColor: s.accent }}
        />
        <h1 className="text-[length:var(--text-4xl)]">{s.label}</h1>
        <p className="mt-3 text-[length:var(--text-lg)] leading-[var(--leading-relaxed)] text-[var(--text-2)]">
          {s.positioning}
        </p>
        <p className="tabular mt-4 text-[length:var(--text-sm)] text-[var(--text-3)]">
          {books.total} titles in this series
        </p>
      </header>

      {books.items.length === 0 ? (
        <EmptyState title="No titles in this series yet" action={{ label: "Browse all books", href: "/shop" }} />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {books.items.map((b, i) => (
            <li key={b.slug}>
              <BookCard book={b} priority={i < 4} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
