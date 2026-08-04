"use client";

import * as React from "react";
import Link from "next/link";
import { Heart, Menu, Search, ShoppingCart, User } from "lucide-react";
import { CLASSES, MEDIUMS, SERIES, SUBJECTS } from "@/constants/catalog";
import { useCartCount } from "@/lib/store/cart";
import { useWishlistCount } from "@/lib/store/wishlist";
import { useSearch } from "@/features/search/search-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "./theme-toggle";
import { BoardSwitcher, MediumSwitcher } from "./switchers";
import { MobileNav } from "./mobile-nav";

/** `menu` is optional — About and Contact are direct links, not mega menus. */
const NAV: { label: string; href: string; menu?: string }[] = [
  { label: "Shop", href: "/shop", menu: "shop" },
  { label: "Combo Packs", href: "/combo-packs", menu: "combos" },
  { label: "Class", href: "/class", menu: "class" },
  { label: "Key Notes", href: "/key-notes", menu: "notes" },
  { label: "About Us", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export function Navbar() {
  const [scrolled, setScrolled] = React.useState(false);
  const [openMenu, setOpenMenu] = React.useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cartCount = useCartCount();
  const wishCount = useWishlistCount();
  const { setOpen: setSearchOpen } = useSearch();

  React.useEffect(() => {
    // Passive listener + a threshold check: this fires on every scroll frame,
    // so it must not read layout or set state redundantly.
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Hover intent: opening on pointerenter alone fires menus while the cursor
     merely travels across the bar. 110ms in, 180ms out to survive the gap
     between the trigger and the panel. */
  const openWithIntent = (menu: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenMenu(menu), 110);
  };
  const closeWithIntent = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenMenu(null), 180);
  };

  return (
    <>
      <header
        className={cn(
          "glass-chrome fixed inset-x-0 top-0 z-[var(--z-nav)]",
          "transition-[height,backdrop-filter] duration-[var(--duration-base)] ease-[var(--ease-standard)]",
        )}
        style={{ height: scrolled ? "var(--nav-h-scrolled)" : "var(--nav-h)" }}
        onMouseLeave={closeWithIntent}
      >
        <div className="container-page flex h-full items-center gap-2">
          {/* Logo. py-2 gives the link a 44px-tall hit area — the audit found
              the bare image was only 28px, well under WCAG 2.5.5. */}
          <Link
            href="/"
            className="mr-auto flex shrink-0 items-center py-2 lg:mr-8"
            aria-label="CleverClass.AI — home"
          >
            <Logo height={scrolled ? 30 : 36} priority />
          </Link>

          {/* Desktop nav — shrink-0 + nowrap so long switcher labels can never
              wrap these links onto a second line inside a fixed-height bar. */}
          <nav
            className="hidden shrink-0 items-center gap-0.5 whitespace-nowrap lg:flex"
            aria-label="Main"
          >
            {NAV.map((item) => (
              <div key={item.href} onMouseEnter={() => item.menu ? openWithIntent(item.menu) : closeWithIntent()}>
                <Link
                  href={item.href}
                  className={cn(
                    "rounded-[var(--radius-sm)] px-3 py-2 text-[length:var(--text-base)] font-medium",
                    "text-[color:var(--text-2)] transition-colors duration-[var(--duration-fast)]",
                    "hover:text-[color:var(--text-1)]",
                    openMenu === item.menu && "text-[color:var(--text-1)]",
                  )}
                  aria-expanded={item.menu ? openMenu === item.menu : undefined}
                  aria-haspopup={item.menu ? "true" : undefined}
                  onFocus={() => item.menu && setOpenMenu(item.menu)}
                >
                  {item.label}
                </Link>
              </div>
            ))}
          </nav>

          {/* Utilities. `min-w-0 shrink` on the switcher group makes it the
              designated shrink target: when space runs out the chips truncate
              rather than the nav collapsing. Everything else is shrink-0. */}
          <div className="ml-auto flex min-w-0 items-center gap-1">
            <div className="mr-2 hidden min-w-0 shrink items-center gap-1.5 xl:flex">
              <BoardSwitcher />
              <MediumSwitcher />
            </div>

            <button
              onClick={() => setSearchOpen(true)}
              className={cn(
                "hidden md:flex h-9 coarse:h-11 shrink-0 items-center gap-2 rounded-[var(--radius-md)] pl-3 pr-2",
                "border border-[var(--border-1)] bg-[var(--surface-1)]/60 text-[color:var(--text-3)]",
                "transition-colors hover:border-[var(--border-2)] hover:text-[color:var(--text-2)]",
              )}
              aria-label="Search books — press Control K"
            >
              <Search className="size-4" aria-hidden />
              <span className="text-[length:var(--text-sm)]">Search…</span>
              <kbd className="ml-4 rounded border border-[var(--border-1)] bg-[var(--surface-0)] px-1.5 py-0.5 text-[length:var(--text-2xs)] font-medium text-[color:var(--text-3)]">
                ⌘K
              </kbd>
            </button>

            {/* There is deliberately NO mobile search button here.
                One used to render below md — but MobileBottomNav is lg:hidden
                and already carries a Search tab, so every screen that showed
                this button showed that tab too. Two entry points for one
                action, and the cost was real: at 320px the four icon controls
                plus the 135px logo needed 323px of the 288px available, so the
                buttons squeezed to 35px (under the 44px minimum) AND the header
                still overflowed by 15px. Removing the duplicate fixes both. */}

            <ThemeToggle />

            <Button
              asChild
              variant="ghost"
              size="icon"
              className="relative hidden shrink-0 sm:inline-flex lg:size-9"
            >
              <Link href="/account/wishlist" aria-label={`Wishlist, ${wishCount} items`}>
                <Heart className="size-5" aria-hidden />
                {wishCount > 0 && <CountDot n={wishCount} />}
              </Link>
            </Button>

            <Button asChild variant="ghost" size="icon" className="relative shrink-0 lg:size-9">
              <Link href="/cart" aria-label={`Cart, ${cartCount} items`}>
                <ShoppingCart className="size-5" aria-hidden />
                {cartCount > 0 && <CountDot n={cartCount} />}
              </Link>
            </Button>

            <Button
              asChild
              variant="ghost"
              size="icon"
              className="hidden shrink-0 sm:inline-flex lg:size-9"
            >
              <Link href="/account" aria-label="Account">
                <User className="size-5" aria-hidden />
              </Link>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="size-5" aria-hidden />
            </Button>
          </div>
        </div>

        {openMenu && (
          <MegaMenu menu={openMenu} onClose={() => setOpenMenu(null)} />
        )}
      </header>

      <MobileNav open={mobileOpen} onOpenChange={setMobileOpen} />
    </>
  );
}

function CountDot({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="tabular absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-[var(--brand-base)] px-1 text-[length:var(--text-2xs)] font-semibold leading-4 text-[color:var(--brand-on)]"
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Mega menu                                                                  */
/* -------------------------------------------------------------------------- */
function MegaMenu({ menu, onClose }: { menu: string; onClose: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const content = {
    shop: {
      columns: [
        { title: "By class", links: CLASSES.map((c) => ({ label: c.label, href: `/shop?class=${c.id}` })) },
        { title: "By subject", links: SUBJECTS.slice(0, 10).map((s) => ({ label: s, href: `/shop?subject=${encodeURIComponent(s)}` })) },
        { title: "By series", links: SERIES.map((s) => ({ label: s.label, href: `/series/${s.id}` })) },
      ],
    },
    combos: {
      columns: [
        { title: "Primary", links: ["5", "6", "7", "8"].map((c) => ({ label: `Class ${c} sets`, href: `/combo-packs?class=${c}` })) },
        { title: "Secondary", links: ["9", "10"].map((c) => ({ label: `Class ${c} sets`, href: `/combo-packs?class=${c}` })) },
        { title: "Junior College", links: [
          { label: "Science (PCM)", href: "/combo-packs?stream=science-pcm" },
          { label: "Science (PCB)", href: "/combo-packs?stream=science-pcb" },
          { label: "Commerce", href: "/combo-packs?stream=commerce" },
          { label: "Arts", href: "/combo-packs?stream=arts" },
        ] },
      ],
    },
    class: {
      columns: [
        { title: "All classes", links: CLASSES.map((c) => ({ label: c.label, href: `/class/${c.id}` })) },
        { title: "By medium", links: MEDIUMS.map((m) => ({ label: m.label, href: `/shop?medium=${m.id}` })) },
      ],
    },
    notes: {
      columns: [
        { title: "By class", links: ["5", "6", "7", "8", "9", "10"].map((c) => ({ label: `Class ${c} notes`, href: `/key-notes/${c}` })) },
        { title: "Popular subjects", links: ["Science", "Mathematics", "English", "History"].map((s) => ({ label: s, href: `/key-notes?subject=${encodeURIComponent(s)}` })) },
      ],
    },
  }[menu];

  if (!content) return null;

  return (
    <div
      className="glass-panel panel-solid glass-edge absolute inset-x-0 top-full mx-auto hidden max-w-6xl origin-top animate-[fadeDown_var(--duration-base)_var(--ease-out-expo)] p-8 lg:block"
      style={{ marginTop: "0.5rem" }}
      role="region"
      aria-label={`${menu} menu`}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))_320px] gap-8">
        {content.columns.map((col) => (
          <div key={col.title}>
            <h3 className="mb-3 text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-wide)] text-[color:var(--text-3)]">
              {col.title}
            </h3>
            <ul className="space-y-0.5">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    onClick={onClose}
                    className="block rounded-[var(--radius-sm)] px-2 py-1.5 coarse:py-3 text-[length:var(--text-sm)] text-[color:var(--text-2)] transition-colors hover:bg-[var(--surface-0)] hover:text-[color:var(--text-1)]"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* Merchandising panel — a mega menu with dead space wastes the
            highest-traffic 400×300 area on the site. */}
        <div className="rounded-[var(--radius-lg)] bg-[var(--brand-soft)] p-6">
          <p className="text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-wide)] text-[color:var(--text-brand)]">
            Save up to 30%
          </p>
          <p className="mt-2 font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-semibold text-[color:var(--text-1)]">
            Class 10 Complete Set
          </p>
          <p className="mt-1.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            Every core subject in one pack. Free shipping included.
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link href="/combo-packs" onClick={onClose}>
              View combo packs
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
