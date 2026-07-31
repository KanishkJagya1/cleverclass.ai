import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { catalog } from "@/lib/data";
import { classById, mediumById } from "@/constants/catalog";
import { Badge } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { slugify } from "@/lib/utils";
import type { ClassId } from "@/types/catalog";

export const revalidate = 43200;

const NOTE_CLASSES: ClassId[] = ["5", "6", "7", "8", "9", "10"];

export function generateStaticParams() {
  return NOTE_CLASSES.map((classId) => ({ classId }));
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
    title: `${cls.label} Key Notes — free chapter summaries`,
    description: `Chapter-wise key notes for ${cls.label}, Maharashtra State Board, in Marathi and Semi-English medium. Preview free.`,
    alternates: { canonical: `/key-notes/${classId}` },
  };
}

export default async function KeyNotesClassPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const cls = classById(classId as ClassId);
  if (!cls) notFound();

  const notes = await catalog.getKeyNotes({ classId: cls.id });

  // Group by subject; each subject may exist in two mediums.
  const bySubject = [...new Set(notes.map((n) => n.subject))].map((subject) => ({
    subject,
    entries: notes.filter((n) => n.subject === subject),
  }));

  return (
    <div className="container-page py-8 md:py-12">
      <nav aria-label="Breadcrumb" className="mb-5 text-[length:var(--text-sm)] text-[var(--text-3)]">
        <Link href="/" className="hover:text-[var(--text-2)]">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/key-notes" className="hover:text-[var(--text-2)]">Key Notes</Link>
        <span className="mx-2">/</span>
        <span className="text-[var(--text-2)]">{cls.label}</span>
      </nav>

      <header className="mb-10 max-w-2xl">
        <h1 className="text-[length:var(--text-4xl)]">{cls.label} Key Notes</h1>
        <p className="mt-3 text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[var(--text-2)]">
          Chapter-wise summaries for every unit of the {cls.label} syllabus.
          Preview free — no sign-up.
        </p>
      </header>

      {bySubject.length === 0 ? (
        <EmptyState
          title="No notes published for this class yet"
          description="Guides and combo packs are available in the shop."
          action={{ label: `Browse ${cls.label} books`, href: `/class/${cls.id}` }}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bySubject.map(({ subject, entries }) => (
            <li key={subject}>
              <Link
                href={`/key-notes/${cls.id}/${slugify(subject)}`}
                className="surface-card lift flex h-full flex-col p-5"
              >
                <FileText className="size-5 text-[var(--brand-base)]" aria-hidden />
                <h2 className="mt-4 font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-[var(--text-1)]">
                  {subject}
                </h2>
                <p className="tabular mt-1.5 text-[length:var(--text-sm)] text-[var(--text-2)]">
                  {entries[0]?.chapters.length ?? 0} chapters
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {entries.map((e) => (
                    <Badge key={e.slug}>{mediumById(e.medium)?.label.replace(" Medium", "")}</Badge>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
