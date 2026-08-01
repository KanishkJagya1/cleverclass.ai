import type { Metadata, Viewport } from "next";
import dynamic from "next/dynamic";
import { Inter, Mukta, Noto_Sans_Devanagari, Space_Grotesk } from "next/font/google";
import { SITE } from "@/constants/catalog";
import { Providers } from "@/providers";
import { Navbar } from "@/components/layout/navbar";
import { MobileBottomNav } from "@/components/layout/mobile-nav";
import { Footer } from "@/components/layout/footer";
import { absoluteUrl } from "@/lib/utils";
import "./globals.css";

/* --------------------------------------------------------------------------
   Fonts.

   `adjustFontFallback` keeps the metric-compatible fallback Next generates,
   so there is no layout shift when the webfont swaps in. The Devanagari faces
   carry their own variable so they can be *added to the same CSS stack* —
   a mixed-script string then renders at one weight without a wrapper.
   -------------------------------------------------------------------------- */
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const notoDeva = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto-deva",
  display: "swap",
});

const mukta = Mukta({
  subsets: ["devanagari", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mukta",
  display: "swap",
});

/* Below-the-fold chrome. Neither is needed for first paint, and the palette
   pulls in cmdk while the assistant pulls in the markdown renderer. */
const SearchDialog = dynamic(() =>
  import("@/features/search/search-dialog").then((m) => m.SearchDialog),
);
const AssistantWidget = dynamic(() =>
  import("@/features/assistant/assistant-widget").then((m) => m.AssistantWidget),
);

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  authors: [{ name: SITE.legalName }],
  keywords: [
    "Maharashtra State Board books",
    "SSC guide",
    "HSC guide",
    "Marathi medium books",
    "semi English medium guide",
    "CBSE guide",
    "key notes",
    "combo pack books",
    "Nagpur publisher",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: SITE.url,
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8FAFC" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0C14" },
  ],
};

/** Organization + WebSite, emitted once site-wide. */
const orgSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": absoluteUrl("/#organization"),
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
      sameAs: Object.values(SITE.social),
    },
    {
      "@type": "WebSite",
      "@id": absoluteUrl("/#website"),
      url: SITE.url,
      name: SITE.name,
      publisher: { "@id": absoluteUrl("/#organization") },
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: absoluteUrl("/search?q={search_term_string}") },
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* next-themes writes the theme class here before first paint. Light is the
       default; suppressHydrationWarning is required because that script runs
       before React hydrates. */
    <html
      lang="en-IN"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${inter.variable} ${notoDeva.variable} ${mukta.variable}`}
    >
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>

        <Providers>
          <Navbar />

          {/* Offsets: fixed navbar above, fixed bottom nav below on mobile. */}
          <main
            id="main"
            className="min-h-screen pt-[var(--nav-h)] pb-[var(--bottom-nav-h)] lg:pb-0"
          >
            {children}
          </main>

          <Footer />
          <MobileBottomNav />
          <SearchDialog />
          <AssistantWidget />
        </Providers>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />
      </body>
    </html>
  );
}
