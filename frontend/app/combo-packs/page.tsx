import type { Metadata } from "next";
import Link from "next/link";
import { catalog } from "@/lib/data";
import { CLASSES, STREAMS } from "@/constants/catalog";
import { ComboCard } from "@/features/catalog/combo-card";
import { Section, SectionHeader } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { ComboResolved } from "@/types/catalog";

export const revalidate = 43200;

export const metadata: Metadata = {
  title: "Combo packs — save up to 30%",
  description:
    "Complete class sets for Maharashtra State Board. Every core subject in one pack, one delivery, free shipping — save 15–30% against buying separately.",
  alternates: { canonical: "/combo-packs" },
};

const BANDS = [
  { id: "primary", label: "Classes 5–8", classes: ["5", "6", "7", "8"] },
  { id: "secondary", label: "Classes 9–10", classes: ["9", "10"] },
  { id: "junior", label: "Classes 11–12", classes: ["11", "12"] },
  { id: "board", label: "Board Exam", classes: ["board-exam"] },
] as const;

export default async function ComboPacksPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string; stream?: string }>;
}) {
  const sp = await searchParams;
  const page = await catalog.getCombos({ perPage: 200 });

  const resolved = (
    await Promise.all(page.items.map((c) => catalog.getCombo(c.slug)))
  ).filter((c): c is ComboResolved => Boolean(c));

  const filtered = sp.class
    ? resolved.filter((c) => c.classId === sp.class)
    : resolved;

  const byBand = BANDS.map((band) => ({
    ...band,
    combos: filtered.filter((c) => (band.classes as readonly string[]).includes(c.classId)),
  })).filter((b) => b.combos.length > 0);

  const totalSaving = resolved.reduce((s, c) => s + c.savings, 0);

  return (
    <>
      {/* Dark hero — combos are the site's highest-value surface. */}
      <Section band="brand-dark" spacing="sm">
        <div className="max-w-2xl">
          <p className="text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-wide)] text-[var(--color-indigo-300)]">
            Save 15–30%
          </p>
          <h1 className="mt-4 text-[length:var(--text-4xl)] text-white">
            One pack. Every subject. One delivery.
          </h1>
          <p className="mt-4 text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[var(--color-ink-300)]">
            Combo packs bundle every core subject for a class into a single
            order — matched editions, one shipment, and free shipping included.
            Across the catalogue they save families{" "}
            <span className="tabular font-semibold text-white">
              ₹{totalSaving.toLocaleString("en-IN")}
            </span>{" "}
            against buying title by title.
          </p>
        </div>
      </Section>

      <div className="container-page py-10 md:py-14">
        {/* Class filter */}
        <div className="mb-8 flex flex-wrap gap-2">
          <Link
            href="/combo-packs"
            aria-current={!sp.class ? "true" : undefined}
            className={cn(
              "rounded-full border px-4 py-2 text-[length:var(--text-sm)] font-medium transition-colors",
              !sp.class
                ? "border-[var(--brand-base)] bg-[var(--brand-soft)] text-[var(--text-brand)]"
                : "border-[var(--border-1)] text-[var(--text-2)] hover:border-[var(--border-2)]",
            )}
          >
            All classes
          </Link>
          {CLASSES.filter((c) => c.id !== "nursery").map((c) => (
            <Link
              key={c.id}
              href={`/combo-packs?class=${c.id}`}
              aria-current={sp.class === c.id ? "true" : undefined}
              className={cn(
                "rounded-full border px-4 py-2 text-[length:var(--text-sm)] font-medium transition-colors",
                sp.class === c.id
                  ? "border-[var(--brand-base)] bg-[var(--brand-soft)] text-[var(--text-brand)]"
                  : "border-[var(--border-1)] text-[var(--text-2)] hover:border-[var(--border-2)]",
              )}
            >
              {c.short === "Board" ? "Board Exam" : `Class ${c.short}`}
            </Link>
          ))}
        </div>

        {/* Stream configurator — "12th Science" is four different baskets. */}
        <section className="surface-card mb-12 p-6" aria-labelledby="streams">
          <h2 id="streams" className="text-[length:var(--text-lg)]">
            Classes 11 & 12 — choose your stream
          </h2>
          <p className="mt-1.5 text-[length:var(--text-sm)] text-[var(--text-2)]">
            Junior college sets differ by subject combination, so pick the one
            your college follows.
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {STREAMS.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/combo-packs?stream=${s.id}`}
                  className="lift block h-full rounded-[var(--radius-lg)] border border-[var(--border-1)] p-4"
                >
                  <span className="block text-[length:var(--text-sm)] font-semibold text-[var(--text-1)]">
                    {s.label}
                  </span>
                  <span className="mt-1.5 block text-[length:var(--text-xs)] leading-relaxed text-[var(--text-3)]">
                    {s.subjects.join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {byBand.length === 0 ? (
          <EmptyState
            title="No combo packs for this class yet"
            description="Individual titles are available in the shop, and we can suggest a set."
            action={{ label: "Browse all books", href: "/shop" }}
          />
        ) : (
          byBand.map((band) => (
            <section key={band.id} className="mb-14" aria-labelledby={`band-${band.id}`}>
              <SectionHeader title={band.label} />
              <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {band.combos.map((c) => (
                  <li key={c.slug}>
                    <ComboCard combo={c} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}
