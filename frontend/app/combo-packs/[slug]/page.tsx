import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Truck } from "lucide-react";
import { catalog } from "@/lib/data";
import { classById, mediumById, SITE } from "@/constants/catalog";
import { AddToCartButton, SavingsMeter } from "@/features/catalog/atoms";
import { Badge, Rating } from "@/components/ui/primitives";
import { absoluteUrl, formatPrice } from "@/lib/utils";
import type { ClassId } from "@/types/catalog";

export const revalidate = 43200;

export async function generateStaticParams() {
  const slugs = await catalog.getAllComboSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const combo = await catalog.getCombo(slug);
  if (!combo) return {};

  return {
    title: `${combo.title} — save ${formatPrice(combo.savings)}`,
    description: combo.description,
    alternates: { canonical: `/combo-packs/${slug}` },
  };
}

export default async function ComboDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const combo = await catalog.getCombo(slug);
  if (!combo) notFound();

  const cls = classById(combo.classId as ClassId);
  const medium = mediumById(combo.medium);

  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: combo.title,
    description: combo.description,
    image: combo.images.map((i) => absoluteUrl(i.src)),
    sku: combo.id,
    offers: {
      "@type": "Offer",
      url: absoluteUrl(`/combo-packs/${combo.slug}`),
      priceCurrency: "INR",
      price: combo.price,
      availability: "https://schema.org/InStock",
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: combo.rating,
      reviewCount: combo.reviewCount,
    },
  };

  return (
    <div className="container-page py-8 md:py-12">
      <nav aria-label="Breadcrumb" className="mb-6 text-[length:var(--text-sm)] text-[color:var(--text-3)]">
        <Link href="/" className="hover:text-[color:var(--text-2)]">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/combo-packs" className="hover:text-[color:var(--text-2)]">Combo packs</Link>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge variant="brand">{cls?.label}</Badge>
            <Badge>{medium?.label}</Badge>
            <Badge variant="gain">Save {combo.savingsPct}%</Badge>
          </div>

          <h1 className="mt-4 text-[length:var(--text-4xl)]">{combo.title}</h1>
          {combo.titleMr && (
            <p lang="mr" className="mt-1.5 text-[length:var(--text-lg)] text-[color:var(--text-2)]">
              {combo.titleMr}
            </p>
          )}

          <Rating value={combo.rating} count={combo.reviewCount} size={16} className="mt-4" />

          <p className="mt-6 max-w-2xl text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]">
            {combo.description}
          </p>

          <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
            {combo.highlights.map((h) => (
              <li key={h} className="flex items-start gap-2.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                <Check className="mt-0.5 size-4 shrink-0 text-[color:var(--signal-gain)]" aria-hidden />
                {h}
              </li>
            ))}
          </ul>

          {/* Contents manifest — buyers verify a bundle by checking its parts,
              so every item links to its own product page with its own price. */}
          <section className="mt-12" aria-labelledby="contents">
            <h2 id="contents" className="text-[length:var(--text-2xl)]">
              What's in this pack
              <span className="tabular ml-2 text-[length:var(--text-base)] font-normal text-[color:var(--text-3)]">
                {combo.items.length} books
              </span>
            </h2>

            <ul className="mt-5 divide-y divide-[var(--border-1)] border-y border-[var(--border-1)]">
              {combo.items.map((b) => (
                <li key={b.slug} className="flex items-center gap-4 py-4">
                  <Link
                    href={`/shop/${b.slug}`}
                    className="relative aspect-cover w-14 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--surface-0)]"
                  >
                    {b.images[0] && (
                      <Image src={b.images[0].src} alt="" fill sizes="56px" className="object-cover" />
                    )}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={`/shop/${b.slug}`} className="block">
                      <p className="clamp-2 text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)] hover:text-[color:var(--brand-base)]">
                        {b.title}
                      </p>
                    </Link>
                    <p className="mt-0.5 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                      {b.subject} · {b.pages} pages
                    </p>
                  </div>
                  <p className="tabular shrink-0 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                    {formatPrice(b.price)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Purchase panel */}
        <div className="lg:sticky lg:top-[calc(var(--nav-h)+1.5rem)] lg:self-start">
          <div className="surface-card p-6">
            <div className="relative mb-6 flex items-end justify-center">
              {combo.items.slice(0, 5).map((b, i) => (
                <div
                  key={b.slug}
                  className="relative aspect-cover w-14 shrink-0 overflow-hidden rounded-[var(--radius-xs)] bg-white shadow-[var(--shadow-md)]"
                  style={{
                    marginLeft: i === 0 ? 0 : "-1rem",
                    rotate: `${(i - 2) * 4}deg`,
                    zIndex: i,
                  }}
                >
                  {b.images[0] && (
                    <Image src={b.images[0].src} alt="" fill sizes="56px" className="object-cover" />
                  )}
                </div>
              ))}
            </div>

            <SavingsMeter
              itemsTotal={combo.itemsTotal}
              price={combo.price}
              savings={combo.savings}
              savingsPct={combo.savingsPct}
            />

            <AddToCartButton
              item={{
                slug: combo.slug,
                title: combo.title,
                titleMr: combo.titleMr,
                price: combo.price,
                mrp: combo.itemsTotal,
                classId: combo.classId,
                medium: combo.medium,
                images: combo.images,
                inStock: combo.inStock,
              }}
              format="combo"
              size="lg"
              full
              className="mt-6"
            />

            {combo.price >= SITE.freeShippingThreshold && (
              <p className="mt-3 flex items-center justify-center gap-2 text-[length:var(--text-sm)] font-medium text-[color:var(--signal-gain)]">
                <Truck className="size-4" aria-hidden />
                Free shipping included
              </p>
            )}

            <p className="mt-4 border-t border-[var(--border-1)] pt-4 text-center text-[length:var(--text-xs)] text-[color:var(--text-3)]">
              Matched editions · one delivery · 7-day returns
            </p>
          </div>
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
    </div>
  );
}
