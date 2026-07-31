"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Drawer } from "vaul";
import * as Accordion from "@radix-ui/react-accordion";
import { ChevronDown, Home, Search, ShoppingBag, Store, User, X } from "lucide-react";
import { CLASSES, MEDIUMS, SERIES } from "@/constants/catalog";
import { useCartCount } from "@/lib/store/cart";
import { useSearch } from "@/features/search/search-context";
import { BoardSwitcher, MediumSwitcher } from "./switchers";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------------------
   Bottom navigation (D12).
   Five destinations in the natural thumb arc. This REPLACES the top nav on
   mobile rather than supplementing it — a top hamburger on a 6.7" phone
   requires a grip change to reach.
   -------------------------------------------------------------------------- */
const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/shop", label: "Shop", icon: Store },
  { href: "__search", label: "Search", icon: Search },
  { href: "/cart", label: "Cart", icon: ShoppingBag },
  { href: "/account", label: "Account", icon: User },
] as const;

export function MobileBottomNav() {
  const pathname = usePathname();
  const cartCount = useCartCount();
  const { setOpen } = useSearch();

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "glass-chrome fixed inset-x-0 bottom-0 z-[var(--z-bottom-nav)] lg:hidden",
        "!border-b-0 border-t border-[var(--border-glass)]",
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex h-[var(--bottom-nav-h)] items-stretch">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href !== "__search" && (href === "/" ? pathname === "/" : pathname.startsWith(href));
          const inner = (
            <>
              <span className="relative">
                <Icon className="size-5" aria-hidden />
                {href === "/cart" && cartCount > 0 && (
                  <span className="tabular absolute -right-2 -top-1 grid min-w-4 place-items-center rounded-full bg-[var(--brand-base)] px-1 text-[length:var(--text-2xs)] font-semibold leading-4 text-[var(--brand-on)]">
                    {cartCount > 9 ? "9+" : cartCount}
                  </span>
                )}
              </span>
              <span className="text-[length:var(--text-2xs)] font-medium">{label}</span>
            </>
          );
          const cls = cn(
            "flex h-full w-full flex-col items-center justify-center gap-1",
            "transition-colors duration-[var(--duration-fast)]",
            active ? "text-[var(--brand-base)]" : "text-[var(--text-3)]",
          );

          return (
            <li key={href} className="flex-1">
              {href === "__search" ? (
                <button className={cls} onClick={() => setOpen(true)} aria-label="Search">
                  {inner}
                </button>
              ) : (
                <Link href={href} className={cls} aria-current={active ? "page" : undefined}>
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* --------------------------------------------------------------------------
   Full menu drawer — the mega menu's mobile form: accordions, not columns.
   -------------------------------------------------------------------------- */
export function MobileNav({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const groups = [
    { id: "class", title: "Shop by class", links: CLASSES.map((c) => ({ label: c.label, href: `/class/${c.id}` })) },
    { id: "series", title: "Shop by series", links: SERIES.map((s) => ({ label: s.label, href: `/series/${s.id}` })) },
    { id: "medium", title: "Shop by medium", links: MEDIUMS.map((m) => ({ label: m.label, href: `/shop?medium=${m.id}` })) },
  ];
  const direct = [
    { label: "Combo Packs", href: "/combo-packs" },
    { label: "Key Notes", href: "/key-notes" },
    { label: "About Us", href: "/about" },
    { label: "Contact", href: "/contact" },
  ];

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction="right">
      <Drawer.Portal>
        <Drawer.Overlay className="glass-veil fixed inset-0 z-[var(--z-overlay)]" />
        <Drawer.Content
          className={cn(
            "glass-panel fixed inset-y-0 right-0 z-[var(--z-modal)] flex w-[88%] max-w-sm flex-col",
            "!rounded-l-[var(--radius-2xl)] !rounded-r-none",
          )}
        >
          <Drawer.Title className="sr-only">Navigation menu</Drawer.Title>
          <div className="flex items-center justify-between border-b border-[var(--border-1)] p-4">
            <div className="flex gap-2">
              <BoardSwitcher />
              <MediumSwitcher />
            </div>
            <button
              onClick={() => onOpenChange(false)}
              aria-label="Close menu"
              className="grid size-11 place-items-center rounded-[var(--radius-md)] text-[var(--text-2)] hover:bg-[var(--surface-0)]"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain p-4">
            <Accordion.Root type="single" collapsible className="space-y-1">
              {groups.map((g) => (
                <Accordion.Item key={g.id} value={g.id} className="border-b border-[var(--border-1)]">
                  <Accordion.Trigger className="group flex w-full items-center justify-between py-3.5 text-left text-[length:var(--text-lg)] font-medium text-[var(--text-1)]">
                    {g.title}
                    <ChevronDown
                      className="size-4 text-[var(--text-3)] transition-transform duration-[var(--duration-base)] group-data-[state=open]:rotate-180"
                      aria-hidden
                    />
                  </Accordion.Trigger>
                  <Accordion.Content className="overflow-hidden data-[state=closed]:animate-[collapse_var(--duration-base)_var(--ease-standard)] data-[state=open]:animate-[expand_var(--duration-base)_var(--ease-standard)]">
                    <ul className="grid grid-cols-2 gap-1 pb-3">
                      {g.links.map((l) => (
                        <li key={l.href}>
                          <Link
                            href={l.href}
                            onClick={() => onOpenChange(false)}
                            className="block rounded-[var(--radius-sm)] px-2 py-2.5 text-[length:var(--text-sm)] text-[var(--text-2)] hover:bg-[var(--surface-0)]"
                          >
                            {l.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Accordion.Content>
                </Accordion.Item>
              ))}
            </Accordion.Root>

            <ul className="mt-2">
              {direct.map((l) => (
                <li key={l.href} className="border-b border-[var(--border-1)]">
                  <Link
                    href={l.href}
                    onClick={() => onOpenChange(false)}
                    className="block py-3.5 text-[length:var(--text-lg)] font-medium text-[var(--text-1)]"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
