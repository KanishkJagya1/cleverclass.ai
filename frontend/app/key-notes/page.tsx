import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";
import { catalog } from "@/lib/data";
import { CLASSES } from "@/constants/catalog";
import { Section } from "@/components/ui/primitives";
import { slugify } from "@/lib/utils";

export const revalidate = 43200;

export const metadata: Metadata = {
  title: "Key Notes — free chapter-wise study notes",
  description:
    "Concise chapter-wise notes aligned to the Maharashtra State Board syllabus for Classes 5 to 10, in Marathi and Semi-English medium. Preview free, no sign-up.",
  alternates: { canonical: "/key-notes" },
};

const NOTE_CLASSES = ["5", "6", "7", "8", "9", "10"];

/**
 * `?subject=` is honoured here. The mega menu has always linked to
 * `/key-notes?subject=Science`, but this page accepted no search params at all,
 * so four navigation entries landed silently on the unfiltered index.
 */
export default async function KeyNotesPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>;
}) {
  const { subject } = await searchParams;
  const notes = await catalog.getKeyNotes();

  const scoped = subject
    ? notes.filter((n) => n.subject.toLowerCase() === subject.toLowerCase())
    : notes;
  // Fall back to everything rather than rendering a blank page for a subject
  // that has no notes yet; the banner below explains what happened.
  const source = scoped.length > 0 ? scoped : notes;
  const noMatches = Boolean(subject) && scoped.length === 0;

  // class → distinct subjects
  const matrix = NOTE_CLASSES.map((id) => {
    const cls = CLASSES.find((c) => c.id === id)!;
    const subjects = [...new Set(source.filter((n) => n.classId === id).map((n) => n.subject))];
    return { cls, subjects };
  }).filter((r) => r.subjects.length > 0);

  return (
    <>
      <Section band="brand-soft" spacing="sm">
        <div className="max-w-2xl">
          <p className="text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-wide)] text-[color:var(--text-brand)]">
            Key Notes
          </p>
          <h1 className="mt-4 text-[length:var(--text-4xl)]">
            Read the chapter before you buy the book.
          </h1>
          <p className="mt-4 text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]">
            Chapter-wise summaries aligned to the Maharashtra State Board
            syllabus for Classes 5 to 10, in Marathi and Semi-English medium.
            Preview any set free — no sign-up, no email required.
          </p>
        </div>
      </Section>

      <div className="container-page py-10 md:py-14">
        {noMatches && (
          <p
            role="status"
            className="mb-8 rounded-[var(--radius-md)] bg-[var(--surface-0)] px-4 py-3 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
          >
            No key notes for <strong>{subject}</strong> yet — showing every subject
            instead.{" "}
            <Link href="/key-notes" className="text-[color:var(--text-brand)] underline underline-offset-4">
              Clear filter
            </Link>
          </p>
        )}

        <div className="space-y-10">
          {matrix.map(({ cls, subjects }) => (
            <section key={cls.id} aria-labelledby={`kn-${cls.id}`}>
              <div className="mb-4 flex items-end justify-between gap-4">
                <h2 id={`kn-${cls.id}`} className="text-[length:var(--text-xl)]">
                  {cls.label}
                  <span lang="mr" className="ml-2 text-[length:var(--text-sm)] font-normal text-[color:var(--text-3)]">
                    {cls.labelMr}
                  </span>
                </h2>
                <Link
                  href={`/key-notes/${cls.id}`}
                  // min-h-11 on touch: this is a standalone navigation link in
                  // a section header, not a link inside a sentence, so the
                  // WCAG inline exception does not apply. It measured 21px.
                  className="inline-flex min-h-0 items-center gap-1 text-[length:var(--text-sm)] font-medium text-[color:var(--text-brand)] coarse:min-h-11"
                >
                  All {cls.label} notes
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </div>

              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {subjects.map((s) => (
                  <li key={s}>
                    <Link
                      href={`/key-notes/${cls.id}/${slugify(s)}`}
                      className="surface-card lift flex items-center gap-3 p-4"
                    >
                      <FileText className="size-4 shrink-0 text-[color:var(--brand-base)]" aria-hidden />
                      <span className="text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                        {s}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
