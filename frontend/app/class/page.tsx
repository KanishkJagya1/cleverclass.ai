import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CLASSES } from "@/constants/catalog";
import { SEED_BOOKS } from "@/lib/data/seed";
import { RevealItem } from "@/components/motion";

export const metadata: Metadata = {
  title: "Shop by class",
  description:
    "Guides, key notes and combo packs for Nursery through Class 12 and Board Exam preparation — Maharashtra State Board and CBSE.",
  alternates: { canonical: "/class" },
};

export default function ClassIndexPage() {
  return (
    <div className="container-page py-10 md:py-16">
      <header className="mb-12 max-w-2xl">
        <h1 className="text-[length:var(--text-4xl)]">Shop by class</h1>
        <p className="mt-3 text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[var(--text-2)]">
          Every class has its own set of guides, key notes and combo packs.
          Start with the class, then choose your medium.
        </p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CLASSES.map((c, i) => {
          const count = SEED_BOOKS.filter((b) => b.classId === c.id).length;
          return (
            <RevealItem key={c.id} index={i} className="h-full">
              <li className="h-full">
                <Link href={`/class/${c.id}`} className="surface-card lift group flex h-full flex-col p-6">
                  <div className="flex items-start justify-between">
                    <span className="font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-bold text-[var(--text-1)] transition-colors group-hover:text-[var(--brand-base)]">
                      {c.short}
                    </span>
                    {c.highlight && (
                      <span className="rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-[length:var(--text-2xs)] font-semibold text-[var(--text-brand)]">
                        Board year
                      </span>
                    )}
                  </div>
                  <h2 className="mt-3 font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-[var(--text-1)]">
                    {c.label}
                  </h2>
                  <p lang="mr" className="mt-0.5 text-[length:var(--text-sm)] text-[var(--text-3)]">
                    {c.labelMr}
                  </p>
                  <p className="mt-3 text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-[var(--text-2)]">
                    {c.description}
                  </p>
                  <p className="tabular mt-auto flex items-center gap-1.5 pt-5 text-[length:var(--text-sm)] font-medium text-[var(--text-brand)]">
                    {count} titles
                    <ArrowRight className="size-3.5" aria-hidden />
                  </p>
                </Link>
              </li>
            </RevealItem>
          );
        })}
      </ul>
    </div>
  );
}
