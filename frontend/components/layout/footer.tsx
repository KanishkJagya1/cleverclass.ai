import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";
import { CLASSES, SERIES, SITE } from "@/constants/catalog";
import { Logo } from "@/components/brand/logo";
import { NewsletterForm } from "@/components/forms/newsletter-form";

/**
 * The footer is the site's internal-linking backbone: every class and every
 * series is a crawlable link from every page. That matters more for a
 * 380-page catalog site than any single on-page optimisation.
 */
export function Footer() {
  const columns = [
    {
      title: "Shop by class",
      links: CLASSES.map((c) => ({ label: c.label, href: `/class/${c.id}` })),
    },
    {
      title: "Shop by series",
      links: [
        ...SERIES.map((s) => ({ label: s.label, href: `/series/${s.id}` })),
        { label: "All books", href: "/shop" },
        { label: "Combo packs", href: "/combo-packs" },
        { label: "Key notes", href: "/key-notes" },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "About us", href: "/about" },
        { label: "Contact", href: "/contact" },
        { label: "FAQs", href: "/faqs" },
        { label: "Shipping", href: "/shipping" },
        { label: "Returns", href: "/returns" },
        { label: "Track order", href: "/account/track" },
      ],
    },
  ];

  return (
    <footer className="relative border-t border-[var(--border-1)] bg-[var(--color-indigo-950)] text-[var(--color-ink-300)]">
      <div className="container-page py-16 md:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_repeat(3,1fr)]">
          {/* Brand + newsletter */}
          <div>
            {/* Full lockup here — the footer has room for the wordmark and
                tagline, which the navbar does not. */}
            <Link href="/" className="inline-flex py-1" aria-label={`${SITE.name} — home`}>
              <Logo variant="full" width={190} onDarkSurface />
            </Link>
            <p className="mt-4 max-w-xs text-[length:var(--text-sm)] leading-[var(--leading-relaxed)]">
              {SITE.description}
            </p>

            <div className="mt-7">
              <p className="mb-3 text-[length:var(--text-sm)] font-medium text-white">
                New editions and offers, twice a term.
              </p>
              <NewsletterForm variant="dark" />
            </div>
          </div>

          {columns.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h2 className="mb-4 text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-wide)] text-white">
                {col.title}
              </h2>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-[length:var(--text-sm)] transition-colors hover:text-white"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* NAP — matches the LocalBusiness JSON-LD exactly. Inconsistent
            name/address/phone across a site is a real local-SEO penalty. */}
        <div className="mt-14 grid gap-6 border-t border-white/10 pt-10 sm:grid-cols-3">
          <p className="flex items-start gap-3 text-[length:var(--text-sm)]">
            <MapPin className="mt-0.5 size-4 shrink-0 text-[var(--color-indigo-300)]" aria-hidden />
            <span>
              {SITE.legalName}
              <br />
              {SITE.address.street}, {SITE.address.city}
              <br />
              {SITE.address.state} {SITE.address.postalCode}
            </span>
          </p>
          <p className="flex items-start gap-3 text-[length:var(--text-sm)]">
            <Phone className="mt-0.5 size-4 shrink-0 text-[var(--color-indigo-300)]" aria-hidden />
            <span>
              {SITE.phones.map((p) => (
                <a key={p} href={`tel:${p}`} className="block hover:text-white">
                  {p.replace("+91", "+91 ")}
                </a>
              ))}
            </span>
          </p>
          <p className="flex items-start gap-3 text-[length:var(--text-sm)]">
            <Mail className="mt-0.5 size-4 shrink-0 text-[var(--color-indigo-300)]" aria-hidden />
            <a href={`mailto:${SITE.email}`} className="hover:text-white">
              {SITE.email}
            </a>
          </p>
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-white/10 pt-8 text-[length:var(--text-xs)] sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {SITE.legalName}. All rights reserved.
          </p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {[
              { label: "Privacy", href: "/privacy" },
              { label: "Terms", href: "/terms" },
              { label: "Returns", href: "/returns" },
              { label: "Shipping", href: "/shipping" },
            ].map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-white">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
