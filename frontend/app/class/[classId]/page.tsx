import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, FileText } from "lucide-react";
import { CLASSES, MEDIUMS, classById } from "@/constants/catalog";
import { catalog } from "@/lib/data";
import { BookCard } from "@/features/catalog/book-card";
import { ComboBanner } from "@/features/catalog/combo-card";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { ClassId, Medium } from "@/types/catalog";

export const revalidate = 43200;

export function generateStaticParams() {
  return CLASSES.map((c) => ({ classId: c.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ classId: string }>;
}): Promise<Metadata> {
  const { classId } = await params;
  const cls = classById(classId as ClassId);
  if (!cls) return {};

  return {
    title: `${cls.label} books, notes & combo packs`,
    description: `${cls.description} Available in Marathi, Semi-English and English medium from CleverClass.AI.`,
    alternates: { canonical: `/class/${classId}` },
  };
}

/**
 * The primary SEO landing pages (11 of them) and the primary revenue path.
 * The combo sits ABOVE individual books: the parent persona should not have
 * to assemble a basket themselves — that friction is what loses the sale.
 */
export default async function ClassHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ medium?: string }>;
}) {
  const { classId } = await params;
  const { medium } = await searchParams;
  const cls = classById(classId as ClassId);
  if (!cls) notFound();

  const activeMedium = MEDIUMS.find((m) => m.id === medium)?.id;

  const [books, combos, notes] = await Promise.all([
    catalog.getBooks({
      classId: cls.id,
      medium: activeMedium ? [activeMedium as Medium] : undefined,
      perPage: 24,
    }),
    catalog.getCombos({
      classId: cls.id,
      medium: activeMedium ? [activeMedium as Medium] : undefined,
      perPage: 3,
    }),
    catalog.getKeyNotes({ classId: cls.id }),
  ]);

  const featuredCombo = combos.items[0] ? await catalog.getCombo(combos.items[0].slug) : null;

  return (
    <div className="container-page py-8 md:py-12">
      <nav aria-label="Breadcrumb" className="mb-5 text-[length:var(--text-sm)] text-[color:var(--text-3)]">
        <Link href="/" className="hover:text-[color:var(--text-2)]">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/class" className="hover:text-[color:var(--text-2)]">Classes</Link>
        <span className="mx-2">/</span>
        <span className="text-[color:var(--text-2)]">{cls.label}</span>
      </nav>

      <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          {cls.highlight && <Badge variant="brand">Board year</Badge>}
          <h1 className="mt-3 text-[length:var(--text-4xl)]">{cls.label}</h1>
          <p lang="mr" className="mt-1 text-[length:var(--text-lg)] text-[color:var(--text-3)]">
            {cls.labelMr}
          </p>
          <p className="mt-3 text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]">
            {cls.description}
          </p>
        </div>

        {/* Medium switch filters the whole page. A Marathi-medium family has
            no use for the English SKUs, and showing them creates doubt. */}
        <div role="group" aria-label="Filter by medium" className="flex flex-wrap gap-2">
          <Link
            href={`/class/${cls.id}`}
            aria-current={!activeMedium ? "true" : undefined}
            className={cn(
              "chip-tap rounded-[var(--radius-md)] border px-3.5 py-2 text-[length:var(--text-sm)] font-medium transition-colors",
              !activeMedium
                ? "border-[var(--brand-base)] bg-[var(--brand-soft)] text-[color:var(--text-brand)]"
                : "border-[var(--border-1)] text-[color:var(--text-2)] hover:border-[var(--border-2)]",
            )}
          >
            All
          </Link>
          {MEDIUMS.map((m) => (
            <Link
              key={m.id}
              href={`/class/${cls.id}?medium=${m.id}`}
              aria-current={activeMedium === m.id ? "true" : undefined}
              className={cn(
                "chip-tap rounded-[var(--radius-md)] border px-3.5 py-2 text-[length:var(--text-sm)] font-medium transition-colors",
                activeMedium === m.id
                  ? "border-[var(--brand-base)] bg-[var(--brand-soft)] text-[color:var(--text-brand)]"
                  : "border-[var(--border-1)] text-[color:var(--text-2)] hover:border-[var(--border-2)]",
              )}
            >
              <span lang={m.id === "english" ? undefined : "mr"}>{m.labelNative}</span>
            </Link>
          ))}
        </div>
      </header>

      {/* Combo first — Phase 1 Flow A */}
      {featuredCombo && (
        <div className="mt-10">
          <ComboBanner combo={featuredCombo} />
        </div>
      )}

      {/* Subjects */}
      <section className="mt-12" aria-labelledby="subjects">
        <h2 id="subjects" className="text-[length:var(--text-xl)]">Subjects</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {cls.subjects.map((s) => (
            <li key={s}>
              <Link
                href={`/shop?class=${cls.id}&subject=${encodeURIComponent(s)}`}
                className="inline-block rounded-full border border-[var(--border-1)] bg-[var(--surface-1)] px-4 py-2 text-[length:var(--text-sm)] text-[color:var(--text-2)] transition-colors hover:border-[var(--border-2)] hover:text-[color:var(--text-1)]"
              >
                {s}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Books */}
      <section className="mt-12" aria-labelledby="books">
        <div className="mb-5 flex items-end justify-between gap-4">
          <h2 id="books" className="text-[length:var(--text-xl)]">
            All {cls.label} books
            <span className="tabular ml-2 text-[length:var(--text-base)] font-normal text-[color:var(--text-3)]">
              {books.total}
            </span>
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/shop?class=${cls.id}${activeMedium ? `&medium=${activeMedium}` : ""}`}>
              Open in shop
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>

        {books.items.length === 0 ? (
          <EmptyState
            title="No titles for this medium yet"
            description="The same subjects are published in other mediums — try switching above."
            action={{ label: "See all mediums", href: `/class/${cls.id}` }}
          />
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {books.items.map((b, i) => (
              <li key={b.slug}>
                <BookCard book={b} priority={i < 4} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Key notes */}
      {notes.length > 0 && (
        <section className="mt-14" aria-labelledby="notes">
          <div className="surface-card flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="notes" className="text-[length:var(--text-xl)]">
                {cls.label} key notes
              </h2>
              <p className="mt-2 max-w-lg text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                Chapter-wise summaries for {notes.length} subject sets. Preview
                free — no sign-up needed.
              </p>
            </div>
            <Button asChild>
              <Link href={`/key-notes/${cls.id}`}>
                <FileText className="size-4" aria-hidden />
                Browse notes
              </Link>
            </Button>
          </div>
        </section>
      )}

      {/* Assistant handoff */}
      <section className="mt-12 rounded-[var(--radius-xl)] bg-[var(--brand-soft)] p-6 text-center">
        <p className="text-[length:var(--text-base)] text-[color:var(--text-1)]">
          Not sure which set your child needs for {cls.label}?
        </p>
        <p className="mt-1.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          Ask the assistant — it knows the syllabus and the catalogue.
        </p>
      </section>
    </div>
  );
}
