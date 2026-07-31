import type { Metadata } from "next";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { SITE } from "@/constants/catalog";
import { ContactForm } from "@/components/forms/contact-form";
import { MapEmbed } from "@/components/ui/map-embed";
import { MeshBackground } from "@/components/motion";
import { absoluteUrl } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Contact us",
  description: `Contact ${SITE.legalName} in Nagpur — ${SITE.phones.join(", ")}, ${SITE.email}. Bulk and school supply enquiries welcome.`,
  alternates: { canonical: "/contact" },
};

/** NAP here matches the footer and the JSON-LD exactly — inconsistent
    name/address/phone across a site is a genuine local-SEO penalty. */
const localBusiness = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": absoluteUrl("/#localbusiness"),
  name: SITE.name,
  legalName: SITE.legalName,
  url: SITE.url,
  email: SITE.email,
  telephone: SITE.phones,
  address: {
    "@type": "PostalAddress",
    streetAddress: SITE.address.street,
    addressLocality: SITE.address.city,
    addressRegion: SITE.address.state,
    postalCode: SITE.address.postalCode,
    addressCountry: SITE.address.country,
  },
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      opens: "10:00",
      closes: "19:00",
    },
  ],
};

export default function ContactPage() {
  return (
    <div className="relative isolate">
      <MeshBackground />

      <div className="container-page py-10 md:py-16">
        <header className="mb-12 max-w-2xl">
          <h1 className="text-[length:var(--text-4xl)]">Talk to us</h1>
          <p className="mt-3 text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[var(--text-2)]">
            Questions about an order, unsure which book fits your syllabus, or
            supplying a school? We answer within one working day — and the phone
            is always faster.
          </p>
        </header>

        <div className="grid gap-10 lg:grid-cols-[1.25fr_1fr]">
          <ContactForm />

          <aside className="space-y-4">
            <div className="surface-card p-6">
              <h2 className="text-[length:var(--text-lg)] font-semibold text-[var(--text-1)]">
                Reach us directly
              </h2>

              <ul className="mt-5 space-y-5">
                <li className="flex gap-3.5">
                  <Phone className="mt-0.5 size-4 shrink-0 text-[var(--brand-base)]" aria-hidden />
                  <div>
                    <p className="text-[length:var(--text-xs)] uppercase tracking-[var(--tracking-wide)] text-[var(--text-3)]">
                      Phone
                    </p>
                    {SITE.phones.map((p) => (
                      <a
                        key={p}
                        href={`tel:${p}`}
                        className="tabular block text-[length:var(--text-base)] font-medium text-[var(--text-1)] hover:text-[var(--brand-base)]"
                      >
                        {p.replace("+91", "+91 ")}
                      </a>
                    ))}
                  </div>
                </li>

                <li className="flex gap-3.5">
                  <Mail className="mt-0.5 size-4 shrink-0 text-[var(--brand-base)]" aria-hidden />
                  <div>
                    <p className="text-[length:var(--text-xs)] uppercase tracking-[var(--tracking-wide)] text-[var(--text-3)]">
                      Email
                    </p>
                    <a
                      href={`mailto:${SITE.email}`}
                      className="text-[length:var(--text-base)] font-medium text-[var(--text-1)] hover:text-[var(--brand-base)]"
                    >
                      {SITE.email}
                    </a>
                  </div>
                </li>

                <li className="flex gap-3.5">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-[var(--brand-base)]" aria-hidden />
                  <div>
                    <p className="text-[length:var(--text-xs)] uppercase tracking-[var(--tracking-wide)] text-[var(--text-3)]">
                      Office
                    </p>
                    <address className="not-italic text-[length:var(--text-base)] text-[var(--text-1)]">
                      {SITE.legalName}
                      <br />
                      {SITE.address.street}
                      <br />
                      {SITE.address.city}, {SITE.address.state} {SITE.address.postalCode}
                    </address>
                  </div>
                </li>

                <li className="flex gap-3.5">
                  <Clock className="mt-0.5 size-4 shrink-0 text-[var(--brand-base)]" aria-hidden />
                  <div>
                    <p className="text-[length:var(--text-xs)] uppercase tracking-[var(--tracking-wide)] text-[var(--text-3)]">
                      Hours
                    </p>
                    <p className="text-[length:var(--text-base)] text-[var(--text-1)]">
                      Mon–Sat, 10:00 – 19:00
                    </p>
                  </div>
                </li>
              </ul>
            </div>

            <MapEmbed />
          </aside>
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusiness) }}
      />
    </div>
  );
}
