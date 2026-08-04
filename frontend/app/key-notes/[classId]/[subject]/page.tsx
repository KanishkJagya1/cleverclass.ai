import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BookOpen, Check } from "lucide-react";
import { catalog } from "@/lib/data";
import { classById, mediumById } from "@/constants/catalog";
import { BookCard } from "@/features/catalog/book-card";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { slugify } from "@/lib/utils";
import type { ClassId, KeyNote } from "@/types/catalog";

export const revalidate = 43200;

export const dynamicParams = true;

/**
 * Read through the adapter, not from the seed module.
 *
 * This previously imported SEED_KEY_NOTES directly, which meant the route
 * prerendered the seed's class/subject pairs no matter which data source was
 * configured — so a key note added in the admin panel would never get a static
 * page, and one removed from the catalogue would still be built.
 */
export async function generateStaticParams() {
  // Never throw here. This runs during `next build`, and an unreachable API at
  // build time must degrade to "prerender nothing, render on demand" rather
  // than failing the whole deploy. `dynamicParams` above is what makes that
  // safe — every route still works, it is just built on first request.
  const notes = await catalog.getKeyNotes().catch(() => []);
  const seen = new Set<string>();
  const out: { classId: string; subject: string }[] = [];
  for (const n of notes) {
    const key = `${n.classId}/${slugify(n.subject)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ classId: n.classId, subject: slugify(n.subject) });
  }
  return out;
}

async function load(classId: string, subjectSlug: string) {
  const all = await catalog.getKeyNotes({ classId: classId as ClassId });
  const entries = all.filter((n) => slugify(n.subject) === subjectSlug);
  return entries;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ classId: string; subject: string }>;
}): Promise<Metadata> {
  const { classId, subject } = await params;
  const entries = await load(classId, subject);
  const cls = classById(classId as ClassId);
  const first = entries[0];
  if (!first || !cls) return {};

  return {
    title: `${cls.label} ${first.subject} Key Notes — free preview`,
    description: `Free chapter-wise ${first.subject} notes for ${cls.label}, Maharashtra State Board. ${first.chapters.length} chapters, Marathi and Semi-English medium.`,
    alternates: { canonical: `/key-notes/${classId}/${subject}` },
  };
}

/**
 * Phase 1 Flow C — the site's biggest untapped lever.
 *
 * The old site ended this page at a PDF link. Here the free preview is the
 * hook and the conversion block below it states precisely what the paid guide
 * adds that the notes do not.
 */
export default async function KeyNoteDetailPage({
  params,
}: {
  params: Promise<{ classId: string; subject: string }>;
}) {
  const { classId, subject } = await params;
  const entries = await load(classId, subject);
  const cls = classById(classId as ClassId);
  const primary: KeyNote | undefined = entries[0];
  if (!primary || !cls) notFound();

  const relatedBook = primary.relatedBookSlug
    ? await catalog.getBook(primary.relatedBookSlug)
    : null;

  return (
    <div className="container-page py-8 md:py-12">
      <nav aria-label="Breadcrumb" className="mb-5 text-[length:var(--text-sm)] text-[color:var(--text-3)]">
        <Link href="/key-notes" className="hover:text-[color:var(--text-2)]">Key Notes</Link>
        <span className="mx-2">/</span>
        <Link href={`/key-notes/${cls.id}`} className="hover:text-[color:var(--text-2)]">{cls.label}</Link>
        <span className="mx-2">/</span>
        <span className="text-[color:var(--text-2)]">{primary.subject}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <Badge variant="brand">Free preview</Badge>
          <h1 className="mt-4 text-[length:var(--text-4xl)]">
            {cls.label} {primary.subject} Key Notes
          </h1>
          {primary.titleMr && (
            <p lang="mr" className="mt-2 text-[length:var(--text-lg)] text-[color:var(--text-2)]">
              {primary.titleMr}
            </p>
          )}

          <p className="mt-5 max-w-xl text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]">
            Concise, chapter-wise notes covering the complete {cls.label}{" "}
            {primary.subject} syllabus — {primary.chapters.length} chapters, free
            to read, no account and no email.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {entries.map((e) => (
              <Badge key={e.slug} size="md">
                {mediumById(e.medium)?.label}
              </Badge>
            ))}
          </div>

          <div className="mt-8 max-w-sm">
            {/* Key notes have no PDF pipeline of their own, so there is no
                sample to open. Point at the paid guide, which does have one. */}
            {primary.relatedBookSlug ? (
              <Button asChild size="lg">
                <Link href={`/shop/${primary.relatedBookSlug}/preview`}>
                  <BookOpen className="size-4" aria-hidden />
                  Read a free sample of the full guide
                </Link>
              </Button>
            ) : (
              <Button asChild size="lg">
                <Link href={`/shop?class=${primary.classId}&subject=${encodeURIComponent(primary.subject)}`}>
                  <BookOpen className="size-4" aria-hidden />
                  See the guides for this subject
                </Link>
              </Button>
            )}
          </div>

          <section className="mt-12" aria-labelledby="chapters">
            <h2 id="chapters" className="text-[length:var(--text-xl)]">
              Chapters covered
              <span className="tabular ml-2 text-[length:var(--text-base)] font-normal text-[color:var(--text-3)]">
                {primary.chapters.length}
              </span>
            </h2>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {primary.chapters.map((c, i) => (
                <li
                  key={c}
                  className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--border-1)] px-3.5 py-2.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
                >
                  <span className="tabular text-[color:var(--text-3)]">{String(i + 1).padStart(2, "0")}</span>
                  {c}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* ------------------------------------------------- conversion -- */}
        <aside className="lg:sticky lg:top-[calc(var(--nav-h)+1.5rem)] lg:self-start">
          <div className="surface-card p-6">
            <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
              Notes cover the syllabus. The guide gets you through the exam.
            </h2>
            <ul className="mt-4 space-y-2.5">
              {[
                "Every textbook exercise solved",
                "Board-pattern questions per chapter",
                "Previous years' questions marked",
                "Full-length practice papers",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                  <Check className="mt-0.5 size-4 shrink-0 text-[color:var(--signal-gain)]" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>

            {relatedBook ? (
              <div className="mt-6">
                <BookCard book={relatedBook} variant="list" />
              </div>
            ) : (
              <Button asChild className="mt-6" full>
                <Link href={`/class/${cls.id}`}>
                  See {cls.label} guides
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
