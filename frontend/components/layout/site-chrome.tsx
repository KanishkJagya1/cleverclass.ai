"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { MobileBottomNav } from "@/components/layout/mobile-nav";

// Still lazy, as they were in the root layout: neither is needed for first
// paint, and the assistant pulls react-markdown with it.
const SearchDialog = dynamic(() =>
  import("@/features/search/search-dialog").then((m) => m.SearchDialog),
);
const AssistantWidget = dynamic(() =>
  import("@/features/assistant/assistant-widget").then((m) => m.AssistantWidget),
);

/**
 * The marketing shell — navbar, footer, bottom nav, search palette, assistant.
 *
 * Skipped entirely under /admin. A CRUD table and a storefront want opposite
 * things: the admin panel has no use for a shop navbar, a sales assistant, or
 * a bottom nav that covers the last row of a data table, and the smooth-scroll
 * hijack actively fights a long form.
 *
 * The textbook App Router answer is two root layouts via route groups. That
 * would mean relocating every existing route into `app/(site)/` — a large
 * mechanical move for the same user-visible result. This gets there with one
 * pathname check; if the admin panel ever grows its own fonts or providers,
 * that is the point to do the split properly.
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  if (isAdmin) return <>{children}</>;

  return (
    <>
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
    </>
  );
}
