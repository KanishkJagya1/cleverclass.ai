import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { catalog } from "@/lib/data";
import { SEED_BOOKS } from "@/lib/data/seed";
import { SUBJECTS } from "@/constants/catalog";
import { Hero } from "@/components/home/hero";
import {
  BestSellers,
  ClassRail,
  ComboSpotlight,
  FAQ,
  FAQS,
  FeaturedBooks,
  KeyNotesFunnel,
  NewArrivals,
  SeriesStrip,
  SubjectGrid,
} from "@/components/home/sections";
import { Section } from "@/components/ui/primitives";
import { NewsletterForm } from "@/components/forms/newsletter-form";

/* Below-the-fold sections. Splitting them out keeps the home page's initial
   JS to the hero + the first three sections; the rest streams in as the user
   scrolls. §12 pulls in the marquee, §13 the assistant preview. */
const Statistics = dynamic(() => import("@/components/home/sections").then((m) => m.Statistics));
const Resources = dynamic(() => import("@/components/home/sections").then((m) => m.Resources));
const Testimonials = dynamic(() => import("@/components/home/sections").then((m) => m.Testimonials));
const AssistantPromo = dynamic(() => import("@/components/home/sections").then((m) => m.AssistantPromo));

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Rebuild twice a day — the catalogue changes by term, not by minute.
export const revalidate = 43200;

export default async function HomePage() {
  const [featured, bestSellers, newArrivals, combos] = await Promise.all([
    catalog.getFeatured(5),
    catalog.getBestSellers(8),
    catalog.getNewArrivals(10),
    catalog.getCombos({ classId: "10", medium: "marathi", perPage: 1 }),
  ]);

  const heroCombo = combos.items[0] ? await catalog.getCombo(combos.items[0].slug) : null;

  // Subject counts are computed once at build, not per request.
  const subjectCounts = Object.fromEntries(
    SUBJECTS.map((s) => [s, SEED_BOOKS.filter((b) => b.subject === s).length]),
  );

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <>
      {/* §1 */}
      <Hero books={featured} />

      {/* §2 — class before product: the first decision is never "which book" */}
      <ClassRail />

      {/* §3 — first dark band, highest-value section */}
      <ComboSpotlight combo={heroCombo} />

      {/* §4 */}
      <FeaturedBooks books={featured} />

      {/* §5 */}
      <SubjectGrid counts={subjectCounts} />

      {/* §6 — ranked chart, structurally unlike §4 and §7 */}
      <BestSellers books={bestSellers} />

      {/* §7 */}
      <NewArrivals books={newArrivals} />

      {/* §8 — the funnel that the old site was missing entirely */}
      <KeyNotesFunnel />

      {/* §9 */}
      <SeriesStrip />

      {/* §10 — second dark band, page midpoint */}
      <Statistics />

      {/* §11 */}
      <Resources />

      {/* §12 */}
      <Testimonials />

      {/* §13 */}
      <AssistantPromo />

      {/* §14 */}
      <FAQ />

      {/* §15 */}
      <Section band="brand-dark" width="prose" spacing="sm">
        <div className="text-center">
          <h2 className="text-[length:var(--text-2xl)] text-white">
            New editions, twice a term.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[length:var(--text-sm)] text-[color:var(--color-ink-300)]">
            Syllabus changes, new titles and combo offers. No more than four
            emails a year.
          </p>
          <div className="mt-7 flex justify-center">
            <NewsletterForm variant="dark" />
          </div>
        </div>
      </Section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
    </>
  );
}
