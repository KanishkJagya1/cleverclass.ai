"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  IndianRupee,
  Layers,
  LifeBuoy,
  MessageSquare,
  PackageCheck,
  Percent,
  ShieldCheck,
  TrendingUp,
  Package,
  ScrollText,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { useAdminAuth } from "./auth-context";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/books", label: "Books", icon: BookOpen },
  { href: "/admin/orders", label: "Orders", icon: Package },
  { href: "/admin/payments", label: "Payments", icon: IndianRupee },
  { href: "/admin/customers", label: "Users", icon: Users },
  { href: "/admin/support", label: "Support", icon: LifeBuoy },
  { href: "/admin/leads", label: "Enquiries", icon: Mail },
  { href: "/admin/reviews", label: "Reviews", icon: MessageSquare },
  { href: "/admin/stock", label: "Stock", icon: PackageCheck },
  { href: "/admin/coupons", label: "Coupons", icon: Percent },
  { href: "/admin/masters", label: "Master data", icon: Layers },
  { href: "/admin/analytics", label: "Analytics", icon: TrendingUp },
  { href: "/admin/templates", label: "Email templates", icon: Mail },
  { href: "/admin/staff", label: "Staff", icon: ShieldCheck },
  { href: "/admin/audit", label: "Activity", icon: ScrollText },
];

/**
 * The admin frame: sidebar on desktop, a drawer under lg.
 *
 * Deliberately plain. This is a tool — no glass, no parallax, no reveal
 * animations. It reads the same design tokens so light/dark and spacing stay
 * consistent with the storefront, and nothing else.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, status, signOut } = useAdminAuth();
  const [navOpen, setNavOpen] = React.useState(false);

  // Close the mobile drawer whenever navigation happens.
  React.useEffect(() => setNavOpen(false), [pathname]);

  // The login page renders its own full-screen layout.
  if (pathname === "/admin/login") return <>{children}</>;

  if (status === "loading") {
    return (
      <div className="container-page py-16">
        <Skeleton className="h-8 w-48" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (status === "anonymous") {
    return (
      <div className="container-prose py-24 text-center">
        <h1 className="text-[length:var(--text-2xl)]">Sign in required</h1>
        <p className="mt-3 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          Your session has ended.
        </p>
        <Button asChild className="mt-6">
          <Link href="/admin/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  const nav = (
    <nav aria-label="Admin sections" className="space-y-0.5">
      {NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] px-3 text-[length:var(--text-sm)]",
              "transition-colors duration-[var(--duration-fast)]",
              active
                ? "bg-[var(--brand-soft)] font-medium text-[color:var(--text-brand)]"
                : "text-[color:var(--text-2)] hover:bg-[var(--surface-0)] hover:text-[color:var(--text-1)]",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[var(--surface-canvas)]">
      {/* Top bar */}
      <header className="sticky top-0 z-[var(--z-nav)] border-b border-[var(--border-1)] bg-[var(--surface-1)]">
        <div className="flex h-14 items-center gap-3 px-4">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 lg:hidden"
            onClick={() => setNavOpen((o) => !o)}
            aria-label={navOpen ? "Close menu" : "Open menu"}
            aria-expanded={navOpen}
          >
            {navOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </Button>

          <Link href="/admin" className="flex min-h-11 items-center font-[family-name:var(--font-display)] text-[length:var(--text-base)] font-semibold text-[color:var(--text-1)]">
            CleverClass
            <span className="ml-2 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[length:var(--text-2xs)] font-semibold uppercase tracking-[var(--tracking-wide)] text-[color:var(--text-brand)]">
              Admin
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <a href="/" target="_blank" rel="noreferrer">
                View site
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </Button>
            <span className="hidden max-w-[14rem] truncate text-[length:var(--text-xs)] text-[color:var(--text-3)] md:block">
              {user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              <LogOut className="size-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[90rem] gap-6 px-4 py-6">
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-[calc(3.5rem+1.5rem)]">{nav}</div>
        </aside>

        {navOpen && (
          <div className="fixed inset-0 z-[var(--z-overlay)] lg:hidden">
            <button
              className="absolute inset-0 bg-black/40"
              onClick={() => setNavOpen(false)}
              aria-label="Close menu"
            />
            <div className="absolute inset-y-0 left-0 w-64 overflow-y-auto bg-[var(--surface-1)] p-4 pt-16">
              {nav}
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

/** Page heading used by every admin screen, so they can't drift apart. */
export function AdminPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-semibold text-[color:var(--text-1)]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
