import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Calculator,
  Download,
  FileText,
  FlaskConical,
  Globe2,
  Landmark,
  Languages,
  Quote,
  Sparkles,
} from "lucide-react";
import { CLASSES, SERIES, SUBJECTS } from "@/constants/catalog";
import { Badge, Section, SectionHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { CountUp, Reveal, RevealItem } from "@/components/motion";
import { BookCard } from "@/features/catalog/book-card";
import { ComboCard } from "@/features/catalog/combo-card";
import { PriceBlock } from "@/features/catalog/atoms";
import type { Book, ComboResolved } from "@/types/catalog";

/* ==========================================================================
   §2 Shop by class — full-bleed, dense, white
   Placed before any product: the first decision is never "which book", it is
   "which class". Numeric tiles scan in one saccade.
   ========================================================================== */
export function ClassRail() {
  return (
    <Section band="white" spacing="sm">
      <SectionHeader
        eyebrow="Start here"
        title="Find your class"
        description="Every guide, note and combo pack, organised the way you actually shop."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/class">
              All classes
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        }
      />
      <ul className="rail -mx-[var(--gutter)] flex gap-3 px-[var(--gutter)] pb-2 lg:mx-0 lg:grid lg:grid-cols-11 lg:px-0">
        {CLASSES.map((c, i) => (
          <li key={c.id} className="shrink-0">
            <Link
              href={`/class/${c.id}`}
              className="surface-card lift group flex h-24 w-20 flex-col items-center justify-center gap-1 lg:w-full"
            >
              <span className="font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-bold text-[var(--text-1)] transition-colors group-hover:text-[var(--brand-base)]">
                {c.short}
              </span>
              <span className="text-[length:var(--text-2xs)] text-[var(--text-3)]">
                {c.id === "nursery" ? "Pre-primary" : c.id === "board-exam" ? "Special" : "Class"}
              </span>
              {c.highlight && (
                <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[var(--brand-base)]" aria-hidden />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ==========================================================================
   §3 Combo packs — full-bleed, airy, BRAND-DARK (the page's first rhythm break)
   The highest-value section on the site, third from the top, impossible to
   scroll past. Savings shown as rupees, not a percentage badge.
   ========================================================================== */
export function ComboSpotlight({ combo }: { combo: ComboResolved | null }) {
  if (!combo) return null;

  return (
    <Section band="brand-dark" spacing="md" className="overflow-hidden">
      <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
        <Reveal>
          <Badge variant="glass" size="md" className="!text-white">
            Save up to 30%
          </Badge>
          <h2 className="mt-5 text-[length:var(--text-4xl)] text-white">
            One pack. Every subject. One delivery.
          </h2>
          <p className="mt-4 max-w-md text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[var(--color-ink-300)]">
            Assembling a full year of books one title at a time is how families
            end up with mismatched editions and three separate shipments. The
            combo packs solve both — and they clear the free-shipping threshold
            on their own.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" variant="glass">
              <Link href="/combo-packs">
                Browse all combo packs
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          {/* The card renders on a light surface inside the dark band — the
              contrast is the point, it reads as an object placed on the band. */}
          <ComboCard combo={combo} featured />
        </Reveal>
      </div>
    </Section>
  );
}

/* ==========================================================================
   §4 Featured — container, medium, canvas. Asymmetric 1-large + 4-small.
   Editorial hierarchy signals curation; a 5-up equal grid signals a query.
   ========================================================================== */
export function FeaturedBooks({ books }: { books: Book[] }) {
  const [lead, ...rest] = books;
  if (!lead) return null;

  return (
    <Section spacing="md">
      <SectionHeader
        eyebrow="Editor's picks"
        title="Chosen by our editorial team"
        description="The titles our teachers reach for first — highest rated across the catalogue."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/shop?sort=rating">
              See all
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        <Reveal className="h-full">
          <article className="surface-card relative flex h-full flex-col overflow-hidden lg:flex-row">
            <div className="relative aspect-[4/3] shrink-0 bg-[var(--brand-soft)] lg:aspect-auto lg:w-1/2">
              {lead.images[0] && (
                <Image
                  src={lead.images[0].src}
                  alt={lead.images[0].alt}
                  fill
                  sizes="(max-width: 1024px) 100vw, 30vw"
                  className="object-cover"
                />
              )}
            </div>
            <div className="flex flex-1 flex-col p-6 lg:p-8">
              <Badge variant="brand">Editor's pick</Badge>
              <h3 className="mt-4 font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-semibold text-[var(--text-1)]">
                {lead.title}
              </h3>
              <p className="clamp-3 mt-3 text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-[var(--text-2)]">
                {lead.description}
              </p>
              <ul className="mt-5 space-y-1.5">
                {lead.highlights.slice(0, 3).map((h) => (
                  <li key={h} className="flex items-start gap-2 text-[length:var(--text-sm)] text-[var(--text-2)]">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--brand-base)]" aria-hidden />
                    {h}
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex items-center justify-between gap-4 pt-6">
                <PriceBlock price={lead.price} mrp={lead.mrp} />
                <Button asChild>
                  <Link href={`/shop/${lead.slug}`}>
                    View book
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              </div>
            </div>
          </article>
        </Reveal>

        <div className="grid grid-cols-2 gap-5">
          {rest.slice(0, 4).map((b, i) => (
            <RevealItem key={b.slug} index={i}>
              <BookCard book={b} />
            </RevealItem>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ==========================================================================
   §5 Browse by subject — container, dense, white. Counts are the point:
   they prove depth and set expectations before the click.
   ========================================================================== */
const SUBJECT_ICONS: Record<string, React.ElementType> = {
  Mathematics: Calculator,
  Science: FlaskConical,
  Physics: FlaskConical,
  Chemistry: FlaskConical,
  Biology: FlaskConical,
  Geography: Globe2,
  History: Landmark,
  "Political Science": Landmark,
  English: Languages,
  Marathi: Languages,
  Hindi: Languages,
  Sanskrit: Languages,
};

export function SubjectGrid({ counts }: { counts: Record<string, number> }) {
  return (
    <Section band="white" spacing="md">
      <SectionHeader
        eyebrow="Browse"
        title="Shop by subject"
        description="Fourteen subjects across three mediums and two boards."
      />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {SUBJECTS.map((s, i) => {
          const Icon = SUBJECT_ICONS[s] ?? BookOpen;
          return (
            <RevealItem key={s} index={i} className="h-full">
              <li className="h-full">
                <Link
                  href={`/shop?subject=${encodeURIComponent(s)}`}
                  className="surface-card lift flex h-full items-center gap-3 p-4"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-soft)] text-[var(--text-brand)]">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[length:var(--text-sm)] font-medium text-[var(--text-1)]">
                      {s}
                    </span>
                    <span className="tabular block text-[length:var(--text-xs)] text-[var(--text-3)]">
                      {counts[s] ?? 0} titles
                    </span>
                  </span>
                </Link>
              </li>
            </RevealItem>
          );
        })}
      </ul>
    </Section>
  );
}

/* ==========================================================================
   §6 Best sellers — RANKED CHART, not a grid.
   Large ordinals carry information a grid physically cannot: popularity order.
   Dense rows also fit 8 items in the space 3 cards would take.
   ========================================================================== */
export function BestSellers({ books }: { books: Book[] }) {
  return (
    <Section spacing="md">
      <SectionHeader
        eyebrow="This term"
        title="Best sellers"
        description="Ranked by orders across the last three months."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/shop?sort=popularity">
              Full chart
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        }
      />
      <ol className="surface-card px-5 py-2 md:px-7">
        {books.map((b, i) => (
          <BookCard key={b.slug} book={b} variant="rank" index={i} />
        ))}
      </ol>
    </Section>
  );
}

/* ==========================================================================
   §7 New arrivals — full-bleed swipeable rail with edge peel.
   Cards run off the right edge on purpose: a contained carousel with tidy
   padding looks finished, and therefore un-swipeable.
   ========================================================================== */
export function NewArrivals({ books }: { books: Book[] }) {
  return (
    <Section band="white" width="full" spacing="md">
      <div className="container-page">
        <SectionHeader
          eyebrow="Just published"
          title="New arrivals"
          description="Latest editions, matched to the current syllabus."
        />
      </div>
      <ul className="rail flex gap-4 px-[var(--gutter)] pb-4">
        {books.map((b) => (
          <li key={b.slug} className="w-[16rem] shrink-0 sm:w-[18rem]">
            <BookCard book={b} />
          </li>
        ))}
        <li className="grid w-[16rem] shrink-0 place-items-center sm:w-[18rem]">
          <Button asChild variant="secondary">
            <Link href="/shop?sort=newest">
              See everything new
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </li>
      </ul>
    </Section>
  );
}

/* ==========================================================================
   §8 Key Notes funnel — container, airy, brand-soft.
   The site's largest organic entry point, routed toward the paid guide.
   "No sign-up to preview" answers the friction objection before it forms.
   ========================================================================== */
export function KeyNotesFunnel() {
  return (
    <Section band="brand-soft" spacing="md">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <div className="relative mx-auto max-w-sm">
            <div className="surface-card aspect-[1/1.25] overflow-hidden p-6">
              <div className="space-y-2.5">
                <div className="h-2.5 w-1/3 rounded bg-[var(--brand-soft)]" />
                <div className="h-2 w-full rounded bg-[var(--surface-0)]" />
                <div className="h-2 w-full rounded bg-[var(--surface-0)]" />
                <div className="h-2 w-4/5 rounded bg-[var(--surface-0)]" />
                <div className="h-16 rounded-[var(--radius-sm)] bg-[var(--brand-soft)]/60" />
                <div className="h-2 w-full rounded bg-[var(--surface-0)]" />
                <div className="h-2 w-full rounded bg-[var(--surface-0)]" />
                <div className="h-2 w-2/3 rounded bg-[var(--surface-0)]" />
                <div className="h-2 w-full rounded bg-[var(--surface-0)]" />
                <div className="h-2 w-3/4 rounded bg-[var(--surface-0)]" />
              </div>
              <p className="tabular mt-6 text-center text-[length:var(--text-xs)] text-[var(--text-3)]">
                page 12 of 96
              </p>
            </div>
            <div className="glass-panel glass-edge absolute -right-3 top-8 !rounded-[var(--radius-md)] px-3 py-2 md:-right-8">
              <p className="text-[length:var(--text-xs)] font-medium text-[var(--signal-gain)]">
                Free to read
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <Badge variant="brand" size="md">
            Key Notes
          </Badge>
          <h2 className="mt-5 text-[length:var(--text-3xl)]">
            Read the chapter before you buy the book.
          </h2>
          <p className="mt-4 max-w-md text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[var(--text-2)]">
            Concise, chapter-wise notes aligned to the Maharashtra State Board
            syllabus — Classes 5 to 10, in Marathi and Semi-English medium.
          </p>
          <ul className="mt-6 space-y-2.5">
            {[
              "Chapter-wise summaries for every unit",
              "Marathi and Semi-English medium",
              "No sign-up needed to preview",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-[length:var(--text-sm)] text-[var(--text-2)]">
                <span className="mt-1 grid size-4 shrink-0 place-items-center rounded-full bg-[var(--signal-gain)] text-white">
                  <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
                    <path d="M2 5l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/key-notes">
                <FileText className="size-4" aria-hidden />
                Browse key notes
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/key-notes/10">Class 10 notes</Link>
            </Button>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ==========================================================================
   §9 Series strip — the fifth taxonomy axis, invisible on the old site.
   A teacher who says "get the Spark books" needs a route that isn't search.
   ========================================================================== */
export function SeriesStrip() {
  return (
    <Section spacing="sm">
      <SectionHeader
        eyebrow="Our imprints"
        title="Five series, one publisher"
        description="Each series is written for a different stage and medium."
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {SERIES.map((s, i) => (
          <RevealItem key={s.id} index={i} className="h-full">
            <li className="h-full">
              <Link href={`/series/${s.id}`} className="surface-card lift flex h-full flex-col p-5">
                <span
                  aria-hidden
                  className="mb-4 h-1 w-9 rounded-full"
                  style={{ backgroundColor: s.accent }}
                />
                <span className="font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-[var(--text-1)]">
                  {s.label}
                </span>
                <span className="mt-2 text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-[var(--text-2)]">
                  {s.positioning}
                </span>
                <span className="mt-4 inline-flex items-center gap-1 text-[length:var(--text-sm)] font-medium text-[var(--text-brand)]">
                  Browse series
                  <ArrowRight className="size-3.5" aria-hidden />
                </span>
              </Link>
            </li>
          </RevealItem>
        ))}
      </ul>
    </Section>
  );
}

/* ==========================================================================
   §10 Statistics — second dark band at the page midpoint, resetting scroll
   fatigue before the lighter content below.
   ========================================================================== */
export function Statistics() {
  const stats = [
    { to: 325, suffix: "+", label: "Titles in print" },
    { to: 180000, suffix: "+", label: "Students served" },
    { to: 27, suffix: "", label: "Years publishing" },
    { to: 1400, suffix: "+", label: "Schools & retailers" },
  ];

  return (
    <Section band="brand-dark" spacing="sm">
      <ul className="grid grid-cols-2 gap-8 lg:grid-cols-4">
        {stats.map((s, i) => (
          <RevealItem key={s.label} index={i}>
            <li className="text-center lg:text-left">
              <p className="font-[family-name:var(--font-display)] text-[length:var(--text-4xl)] font-bold text-white">
                <CountUp to={s.to} suffix={s.suffix} />
              </p>
              <p className="mt-1.5 text-[length:var(--text-sm)] text-[var(--color-ink-400)]">
                {s.label}
              </p>
            </li>
          </RevealItem>
        ))}
      </ul>
    </Section>
  );
}

/* ==========================================================================
   §11 Educational resources — utility content that earns links and returns.
   ========================================================================== */
export function Resources() {
  const items = [
    { title: "Syllabus PDFs", desc: "Current State Board syllabus for every class.", href: "/resources/syllabus", icon: FileText },
    { title: "Exam calendar", desc: "SSC and HSC timetables as they are announced.", href: "/resources/calendar", icon: Calculator },
    { title: "Guessing papers", desc: "Board-pattern practice sets for Class 10 and 12.", href: "/class/board-exam", icon: Sparkles },
    { title: "Study planners", desc: "Printable revision schedules for the final term.", href: "/resources/planners", icon: Download },
  ];

  return (
    <Section band="white" spacing="md">
      <SectionHeader
        eyebrow="Free resources"
        title="Beyond the books"
        description="Reference material we keep updated each academic year."
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((r, i) => (
          <RevealItem key={r.title} index={i} className="h-full">
            <li className="h-full">
              <Link href={r.href} className="surface-card lift flex h-full flex-col p-5">
                <r.icon className="size-5 text-[var(--brand-base)]" aria-hidden />
                <span className="mt-4 font-[family-name:var(--font-display)] text-[length:var(--text-base)] font-semibold text-[var(--text-1)]">
                  {r.title}
                </span>
                <span className="mt-1.5 text-[length:var(--text-sm)] text-[var(--text-2)]">{r.desc}</span>
              </Link>
            </li>
          </RevealItem>
        ))}
      </ul>
    </Section>
  );
}

/* ==========================================================================
   §12 Testimonials — two rows, opposite directions, different speeds.
   Reduced motion turns the marquee into a static grid.
   ========================================================================== */
const QUOTES = [
  { q: "Exactly matched my daughter's syllabus. The solved exercises saved us hours of tuition.", a: "Sunita P.", r: "Parent, Class 10" },
  { q: "The chapter summaries are the best part — I revise a whole unit in twenty minutes.", a: "Rohit M.", r: "Student, Class 12 Science" },
  { q: "Bought the whole set. Cheaper than each book separately and it all arrived together.", a: "Mahesh J.", r: "Parent, Class 8" },
  { q: "Board-pattern questions at the end of each chapter are very close to the actual paper.", a: "Anjali K.", r: "Teacher, Nagpur" },
  { q: "Marathi medium edition, clearly printed, no confusing translations.", a: "Vikram T.", r: "Parent, Class 9" },
  { q: "We stock Kohinoor every year. Editions are consistent and supply is reliable.", a: "Prakash B.", r: "Bookseller, Amravati" },
];

function QuoteCard({ q, a, r }: { q: string; a: string; r: string }) {
  return (
    <figure className="surface-card w-[19rem] shrink-0 p-5">
      <Quote className="size-4 text-[var(--brand-base)]" aria-hidden />
      <blockquote className="mt-3 text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-[var(--text-1)]">
        {q}
      </blockquote>
      <figcaption className="mt-4 text-[length:var(--text-xs)] text-[var(--text-3)]">
        <span className="font-medium text-[var(--text-2)]">{a}</span> · {r}
      </figcaption>
    </figure>
  );
}

export function Testimonials() {
  const rowA = QUOTES.slice(0, 3);
  const rowB = QUOTES.slice(3);

  return (
    <Section width="full" spacing="md" className="overflow-hidden">
      <div className="container-page">
        <SectionHeader
          eyebrow="What families say"
          title="Trusted across Maharashtra"
          align="center"
        />
      </div>

      {/* motion-reduce: the marquee stops and the rows simply wrap. */}
      <div className="space-y-4">
        {[
          { row: [...rowA, ...rowA, ...rowA], dur: "46s", dir: "normal" },
          { row: [...rowB, ...rowB, ...rowB], dur: "58s", dir: "reverse" },
        ].map((line, i) => (
          <div key={i} className="group relative flex overflow-hidden motion-reduce:overflow-x-auto">
            <div
              className="flex gap-4 pr-4 motion-reduce:animate-none"
              style={{
                animation: `marquee ${line.dur} linear infinite ${line.dir}`,
              }}
            >
              {line.row.map((t, j) => (
                <QuoteCard key={`${t.a}-${j}`} {...t} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ==========================================================================
   §13 Assistant promo — shows a real answer with an inline product card.
   People don't click chat bubbles they assume are canned support bots;
   demonstrating that it recommends actual books is what earns the first use.
   ========================================================================== */
export function AssistantPromo() {
  return (
    <Section band="brand-soft" spacing="md">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <Badge variant="brand" size="md">
            <Sparkles className="size-3" aria-hidden />
            AI Learning Assistant
          </Badge>
          <h2 className="mt-5 text-[length:var(--text-3xl)]">
            Not sure which book? Just ask.
          </h2>
          <p className="mt-4 max-w-md text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[var(--text-2)]">
            Ask about syllabus coverage, the difference between two series, which
            medium to choose, shipping, or returns. It answers from our own
            catalogue — and recommends the actual book, ready to add to your cart.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2">
            {[
              "Which book for 12th PCM?",
              "Difference between Kohinoor and Spark?",
              "Do you ship to Pune?",
            ].map((q) => (
              <li
                key={q}
                className="surface-card px-3 py-1.5 text-[length:var(--text-xs)] text-[var(--text-2)]"
              >
                {q}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="glass-panel glass-edge p-5">
            <div className="flex justify-end">
              <p className="max-w-[80%] rounded-[var(--radius-lg)] rounded-br-sm bg-[var(--brand-base)] px-4 py-2.5 text-[length:var(--text-sm)] text-[var(--brand-on)]">
                Which set should I buy for Class 12 Science, PCM?
              </p>
            </div>
            <div className="mt-4 flex gap-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--text-brand)]">
                <Sparkles className="size-3.5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-[var(--text-1)]">
                  For 12th Science PCM you need Physics, Chemistry and Mathematics.
                  The Spark series covers all three in English medium — and the
                  combo saves ₹95 over buying them separately.
                </p>
                <div className="surface-card mt-3 flex items-center gap-3 p-3">
                  <div className="aspect-cover w-10 shrink-0 rounded-[var(--radius-xs)] bg-[var(--brand-soft)]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[length:var(--text-sm)] font-medium text-[var(--text-1)]">
                      Class 12 Science PCM Set
                    </p>
                    <p className="tabular text-[length:var(--text-xs)] text-[var(--text-3)]">
                      3 books · ₹200
                    </p>
                  </div>
                  <Button size="sm" variant="secondary">
                    Add
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ==========================================================================
   §14 FAQ — prose width, dense. Emits FAQPage JSON-LD from the same source.
   ========================================================================== */
export const FAQS = [
  {
    q: "How long does delivery take?",
    a: "Orders within Maharashtra usually arrive in 3–5 working days. Elsewhere in India, allow 5–8 working days. Shipping is free on orders above ₹200; below that a flat ₹40 applies.",
  },
  {
    q: "How do I choose between Marathi, Semi-English and English medium?",
    a: "Pick the medium your school teaches in. Semi-English means Mathematics and Science are in English while other subjects remain in Marathi. Every product page has a medium switch so you can change without losing your place.",
  },
  {
    q: "Are the books matched to the current syllabus?",
    a: "Yes. Every title states its edition year on the product page, and we reprint whenever the Maharashtra State Board or CBSE revises a syllabus.",
  },
  {
    q: "Can I return a book?",
    a: "Unused books in original condition can be returned within 7 days of delivery. If we sent the wrong title or medium, we cover return shipping.",
  },
  {
    q: "Do you supply schools and bookshops in bulk?",
    a: "Yes. Call +91 71042 99010 for institutional pricing — we supply over 1,400 schools and retailers across Maharashtra.",
  },
  {
    q: "Are the Key Notes really free?",
    a: "The preview is free and needs no sign-up. Full printed notes and guides are paid products.",
  },
];

export function FAQ() {
  return (
    <Section width="prose" spacing="md">
      <SectionHeader eyebrow="Questions" title="Before you order" align="center" />
      <div className="divide-y divide-[var(--border-1)]">
        {FAQS.map((f) => (
          <details key={f.q} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[length:var(--text-base)] font-medium text-[var(--text-1)]">
              {f.q}
              <span
                aria-hidden
                className="grid size-6 shrink-0 place-items-center rounded-full border border-[var(--border-1)] text-[var(--text-3)] transition-transform duration-[var(--duration-base)] group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-3 text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-[var(--text-2)]">
              {f.a}
            </p>
          </details>
        ))}
      </div>
      <p className="mt-8 text-center text-[length:var(--text-sm)] text-[var(--text-2)]">
        Still have a question?{" "}
        <Link href="/contact" className="font-medium text-[var(--text-brand)] underline underline-offset-4">
          Contact us
        </Link>{" "}
        or ask the assistant.
      </p>
    </Section>
  );
}
