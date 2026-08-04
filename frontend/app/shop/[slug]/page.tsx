import type { Metadata } from "next";
import Link from "next/link";
import { catalog } from "@/lib/data";
import { classById, mediumById, seriesById, SITE } from "@/constants/catalog";
import { ProductGallery } from "@/features/catalog/product-gallery";
import {
  FrequentlyBoughtTogether,
  MobileBuyBar,
  PurchasePanel,
} from "@/features/catalog/purchase-panel";
import { BookCard } from "@/features/catalog/book-card";
import { Badge, Rating } from "@/components/ui/primitives";
import { absoluteUrl } from "@/lib/utils";
import type { Book } from "@/types/catalog";
import { notFound } from "next/navigation";

export const revalidate = 43200;

/**
 * Prerender the head of the catalogue only; the rest is ISR on first request.
 * Building all ~324 product pages against a live API turns a backend blip into
 * a failed deploy, and most of those pages see no traffic between deploys.
 * `getAllBookSlugs` is ordered best-seller-first, so this prerenders the pages
 * that actually get hit.
 */
export const dynamicParams = true;
const PRERENDER_COUNT = 40;

export async function generateStaticParams() {
  const slugs = await catalog.getAllBookSlugs();
  return slugs.slice(0, PRERENDER_COUNT).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const book = await catalog.getBook(slug);
  if (!book) return {};

  const cls = classById(book.classId);
  const title = `${book.title} — ${cls?.label}`;

  return {
    title,
    description: book.description.slice(0, 160),
    alternates: { canonical: `/shop/${slug}` },
    openGraph: {
      title,
      description: book.description.slice(0, 160),
      type: "website",
      images: book.images[0] ? [{ url: book.images[0].src }] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const book = await catalog.getBook(slug);
  if (!book) notFound();

  const [variants, related, fbt, reviews] = await Promise.all([
    Promise.all((book.variants ?? []).map((s) => catalog.getBook(s))).then((v) =>
      v.filter((b): b is Book => Boolean(b)),
    ),
    catalog.getRelated(slug, 6),
    catalog.getFrequentlyBoughtTogether(slug, 2),
    catalog.getReviews(slug),
  ]);

  const cls = classById(book.classId);
  const medium = mediumById(book.medium);
  const series = seriesById(book.series);

  const specs: [string, string][] = [
    ["Class", cls?.label ?? "—"],
    ["Board", book.board === "cbse" ? "CBSE" : "Maharashtra State Board"],
    ["Medium", medium?.label ?? "—"],
    ["Subject", book.subject],
    ["Series", series?.label ?? "—"],
    ["Pages", String(book.pages)],
    ["Edition", book.edition],
    ["ISBN", book.isbn ?? "—"],
    ["Publisher", SITE.legalName],
  ];

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        name: book.title,
        description: book.description,
        image: book.images.map((i) => absoluteUrl(i.src)),
        sku: book.id,
        isbn: book.isbn,
        brand: { "@type": "Brand", name: series?.label },
        publisher: { "@id": absoluteUrl("/#organization") },
        offers: {
          "@type": "Offer",
          url: absoluteUrl(`/shop/${book.slug}`),
          priceCurrency: "INR",
          price: book.price,
          availability: book.inStock
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
        },
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: book.rating,
          reviewCount: book.reviewCount,
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: "Shop", item: absoluteUrl("/shop") },
          {
            "@type": "ListItem",
            position: 3,
            name: cls?.label,
            item: absoluteUrl(`/class/${book.classId}`),
          },
          { "@type": "ListItem", position: 4, name: book.title },
        ],
      },
    ],
  };

  return (
    <div className="container-page py-8 md:py-12">
      <nav aria-label="Breadcrumb" className="mb-6 text-[length:var(--text-sm)] text-[color:var(--text-3)]">
        <Link href="/" className="hover:text-[color:var(--text-2)]">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/shop" className="hover:text-[color:var(--text-2)]">Shop</Link>
        <span className="mx-2">/</span>
        <Link href={`/class/${book.classId}`} className="hover:text-[color:var(--text-2)]">
          {cls?.label}
        </Link>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,0.8fr)] lg:gap-8">
        <ProductGallery
          images={book.images}
          title={book.title}
          titleMr={book.titleMr}
          series={book.series}
          slug={book.slug}
        />

        {/* ------------------------------------------------------- details -- */}
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge variant="brand">{cls?.label}</Badge>
            <Badge>{medium?.label}</Badge>
            <Badge>{series?.label}</Badge>
          </div>

          <h1 className="mt-4 text-[length:var(--text-3xl)]">{book.title}</h1>
          {book.titleMr && (
            <p lang="mr" className="mt-1.5 text-[length:var(--text-lg)] text-[color:var(--text-2)]">
              {book.titleMr}
            </p>
          )}

          <Rating value={book.rating} count={book.reviewCount} size={16} className="mt-4" />

          <p className="mt-6 text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]">
            {book.description}
          </p>

          <ul className="mt-6 space-y-2.5">
            {book.highlights.map((h) => (
              <li
                key={h}
                className="flex items-start gap-2.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
              >
                <span className="mt-1 grid size-4 shrink-0 place-items-center rounded-full bg-[var(--signal-gain-soft)] text-[color:var(--signal-gain)]">
                  <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
                    <path d="M2 5l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {h}
              </li>
            ))}
          </ul>

          <section className="mt-10" aria-labelledby="specs">
            <h2 id="specs" className="text-[length:var(--text-xl)]">Specifications</h2>
            <dl className="mt-4 divide-y divide-[var(--border-1)] border-y border-[var(--border-1)]">
              {specs.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-6 py-2.5">
                  <dt className="text-[length:var(--text-sm)] text-[color:var(--text-3)]">{k}</dt>
                  <dd className="text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        {/* ------------------------------------------------------ purchase -- */}
        <div id="primary-buy">
          <PurchasePanel book={book} variants={variants} />
        </div>
      </div>

      {fbt.length > 0 && (
        <div className="mt-14">
          <FrequentlyBoughtTogether anchor={book} others={fbt} />
        </div>
      )}

      {/* ------------------------------------------------------- reviews -- */}
      {reviews.length > 0 && (
        <section className="mt-14" aria-labelledby="reviews">
          <h2 id="reviews" className="text-[length:var(--text-2xl)]">
            Customer reviews
          </h2>
          <ul className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {reviews.map((r) => (
              <li key={r.id} className="surface-card p-5">
                <Rating value={r.rating} />
                <p className="mt-3 text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                  {r.title}
                </p>
                <p className="mt-2 text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]">
                  {r.body}
                </p>
                <p className="mt-4 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                  {r.author}
                  {r.verified && (
                    <span className="ml-2 text-[color:var(--signal-gain)]">Verified purchase</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-14" aria-labelledby="related">
          <h2 id="related" className="text-[length:var(--text-2xl)]">
            More for {cls?.label}
          </h2>
          <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {related.map((b) => (
              <li key={b.slug}>
                <BookCard book={b} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <MobileBuyBar book={book} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
    </div>
  );
}
