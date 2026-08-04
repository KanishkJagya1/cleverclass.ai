import type { Metadata } from "next";
import Link from "next/link";
import { Compass, Eye, HeartHandshake, ShieldCheck } from "lucide-react";
import { SITE } from "@/constants/catalog";
import { Section, SectionHeader } from "@/components/ui/primitives";
import { CountUp, Reveal, RevealItem } from "@/components/motion";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "About us",
  description:
    "Adwani Publishing House has published study guides for Maharashtra students from Nagpur since 1998 — the Kohinoor, Spark, Vidyamitra, WinWings and Ekatmik series.",
  alternates: { canonical: "/about" },
};

const TIMELINE = [
  { year: "1998", title: "The first guide", body: "Adwani Publishing House prints its first Marathi-medium study guide for Class 10 students in Nagpur." },
  { year: "2004", title: "Kohinoor takes shape", body: "The Kohinoor series expands to cover every core subject from Class 5 through Class 10." },
  { year: "2011", title: "Semi-English arrives", body: "As schools shift to Semi-English instruction, every Kohinoor title is reset in a parallel edition." },
  { year: "2016", title: "Spark for junior college", body: "A dedicated English-medium science series launches for Classes 11 and 12." },
  { year: "2020", title: "Key Notes go free", body: "Chapter-wise notes are published free so students can revise regardless of what they can afford." },
  { year: "2026", title: "A new storefront", body: "The full catalogue moves online with search, combo packs and an AI learning assistant." },
];

const VALUES = [
  { icon: ShieldCheck, title: "Accuracy first", body: "Every edition is checked against the current board syllabus before it goes to press. A wrong answer in a study guide costs a student marks." },
  { icon: HeartHandshake, title: "Affordable by design", body: "Most titles are priced between ₹30 and ₹100. Combo packs exist so a full year of books stays within a family's budget." },
  { icon: Compass, title: "Written by teachers", body: "Our authors teach the same syllabus they write for, in the same classrooms our readers sit in." },
];

export default function AboutPage() {
  return (
    <>
      <Section spacing="md">
        <div className="max-w-3xl">
          <p className="text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-wide)] text-[color:var(--text-brand)]">
            {SITE.legalName} · Nagpur
          </p>
          <h1 className="mt-5 text-[length:var(--text-5xl)]">
            Twenty-seven years of getting students through the exam.
          </h1>
          <p className="mt-6 text-[length:var(--text-lg)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]">
            We publish study guides for the Maharashtra State Board and CBSE from
            a single building on Hingna Road. Five series, 325 titles, three
            mediums — written by teachers who take the same syllabus into a
            classroom every morning.
          </p>
        </div>
      </Section>

      {/* Statistics band */}
      <Section band="brand-dark" spacing="sm">
        {/* gap-6 until sm: at 320px two columns with gap-8 leave 132px each,
            and "1,75,960+" at text-4xl measures 147px. Grid items default to
            min-width:auto, so the column grew to fit its content and took the
            whole page sideways with it. The number also steps down one size on
            the narrowest screens. */}
        <ul className="grid grid-cols-2 gap-6 sm:gap-8 lg:grid-cols-4">
          {[
            { to: 27, suffix: "", label: "Years publishing" },
            { to: 325, suffix: "+", label: "Titles in print" },
            { to: 1400, suffix: "+", label: "Schools & retailers" },
            { to: 180000, suffix: "+", label: "Students served" },
          ].map((s, i) => (
            <RevealItem key={s.label} index={i} as="li" className="min-w-0">
              <div className="min-w-0">
                <p className="font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-bold text-[color:var(--color-ink-50)] sm:text-[length:var(--text-4xl)]">
                  <CountUp to={s.to} suffix={s.suffix} />
                </p>
                <p className="mt-1.5 text-[length:var(--text-sm)] text-[color:var(--color-ink-400)]">{s.label}</p>
              </div>
            </RevealItem>
          ))}
        </ul>
      </Section>

      {/* Timeline */}
      <Section band="white" spacing="md">
        <SectionHeader eyebrow="Our journey" title="From one guide to a catalogue" />
        <ol className="relative ml-3 border-l border-[var(--border-1)]">
          {TIMELINE.map((t, i) => (
            <RevealItem key={t.year} index={i} as="li">
              <div className="relative pb-10 pl-8 last:pb-0">
                <span
                  aria-hidden
                  className="absolute -left-[5px] top-1.5 size-2.5 rounded-full bg-[var(--brand-base)] ring-4 ring-[var(--surface-1)]"
                />
                <p className="tabular font-[family-name:var(--font-display)] text-[length:var(--text-sm)] font-bold text-[color:var(--text-brand)]">
                  {t.year}
                </p>
                <h3 className="mt-1 text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
                  {t.title}
                </h3>
                <p className="mt-2 max-w-xl text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]">
                  {t.body}
                </p>
              </div>
            </RevealItem>
          ))}
        </ol>
      </Section>

      {/* Vision / Mission — asymmetric, deliberately not three equal cards */}
      <Section spacing="md">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <Reveal>
            <div className="surface-card h-full p-8">
              <Eye className="size-5 text-[color:var(--brand-base)]" aria-hidden />
              <h2 className="mt-5 text-[length:var(--text-2xl)]">Our vision</h2>
              <p className="mt-4 text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]">
                That no student in Maharashtra fails an exam because the right
                book was too expensive, out of print, or written in a language
                they were never taught in.
              </p>
            </div>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="h-full rounded-[var(--radius-xl)] bg-[var(--brand-soft)] p-8">
              <Compass className="size-5 text-[color:var(--text-brand)]" aria-hidden />
              <h2 className="mt-5 text-[length:var(--text-2xl)]">Our mission</h2>
              <p className="mt-4 text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]">
                Publish accurate, syllabus-matched guides in every medium
                Maharashtra teaches in — and keep them affordable enough that
                buying the full set is a normal decision, not a stretch.
              </p>
            </div>
          </Reveal>
        </div>

        <ul className="mt-8 grid gap-5 md:grid-cols-3">
          {VALUES.map((v, i) => (
            <RevealItem key={v.title} index={i} className="h-full" as="li">
              <div className="surface-card h-full p-6">
                <v.icon className="size-5 text-[color:var(--brand-base)]" aria-hidden />
                <h3 className="mt-4 text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
                  {v.title}
                </h3>
                <p className="mt-2 text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]">
                  {v.body}
                </p>
              </div>
            </RevealItem>
          ))}
        </ul>
      </Section>

      <Section band="brand-dark" width="prose" spacing="sm">
        <div className="text-center">
          <h2 className="text-[length:var(--text-2xl)] text-white">
            Supplying a school or a bookshop?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[length:var(--text-sm)] text-[color:var(--color-ink-300)]">
            We supply over 1,400 schools and retailers across Maharashtra. Call
            us for institutional pricing.
          </p>
          <Button asChild variant="glass" size="lg" className="mt-6">
            <Link href="/contact">Contact us</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
