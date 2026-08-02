import type { Metadata } from "next";
import Link from "next/link";
import { FAQS } from "@/components/home/sections";
import { SITE } from "@/constants/catalog";

export const metadata: Metadata = {
  title: "Frequently asked questions",
  description:
    "Delivery times, choosing a medium, syllabus editions, returns and bulk supply — answered.",
  alternates: { canonical: "/faqs" },
};

/* The same FAQ source as the home page, so the two can never drift apart —
   and both emit the schema from one array. */
const EXTRA = [
  {
    q: "Do you publish CBSE books as well as State Board?",
    a: "Yes. Use the board switcher in the navigation to see only the board you need — the whole catalogue adapts to your choice.",
  },
  {
    q: "What is the difference between Kohinoor, Spark, Vidyamitra, WinWings and Ekatmik?",
    a: "Kohinoor is the complete guide across every class. Spark is English-medium science for Classes 11 and 12. Vidyamitra serves the middle years in Marathi and Semi-English. WinWings is exam-focused sets for Classes 9 and 10. Ekatmik is integrated curriculum workbooks.",
  },
  {
    q: "Can I see inside a book before buying?",
    a: "Yes. Every product page has a free preview of several pages, and Key Notes previews are free too. No sign-up needed for either.",
  },
];

const ALL = [...FAQS, ...EXTRA];

export default function FaqsPage() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: ALL.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className="container-prose py-12 md:py-16">
      <h1 className="text-[length:var(--text-4xl)]">Frequently asked questions</h1>
      <p className="mt-3 text-[length:var(--text-body)] text-[color:var(--text-2)]">
        If your question isn't here, the assistant can answer it — or call us.
      </p>

      <div className="mt-10 divide-y divide-[var(--border-1)]">
        {ALL.map((f) => (
          <details key={f.q} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[length:var(--text-base)] font-medium text-[color:var(--text-1)]">
              {f.q}
              <span
                aria-hidden
                className="grid size-6 shrink-0 place-items-center rounded-full border border-[var(--border-1)] text-[color:var(--text-3)] transition-transform duration-[var(--duration-base)] group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-3 text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]">
              {f.a}
            </p>
          </details>
        ))}
      </div>

      <div className="surface-card mt-12 p-6 text-center">
        <p className="text-[length:var(--text-base)] text-[color:var(--text-1)]">Still stuck?</p>
        <p className="mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          Call{" "}
          <a href={`tel:${SITE.phones[0]}`} className="font-medium text-[color:var(--text-brand)]">
            {SITE.phones[0].replace("+91", "+91 ")}
          </a>{" "}
          or{" "}
          <Link href="/contact" className="font-medium text-[color:var(--text-brand)] underline underline-offset-4">
            send us a message
          </Link>
          .
        </p>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
    </div>
  );
}
