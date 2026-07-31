import Link from "next/link";
import type { Metadata } from "next";
import { Download, Heart, LayoutDashboard, MapPin, Settings, ShoppingBag, User } from "lucide-react";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

const LINKS = [
  { href: "/account", label: "Overview", icon: LayoutDashboard },
  { href: "/account/orders", label: "Orders", icon: ShoppingBag },
  { href: "/account/track", label: "Track order", icon: MapPin },
  { href: "/account/wishlist", label: "Wishlist", icon: Heart },
  { href: "/account/downloads", label: "Downloads", icon: Download },
  { href: "/account/profile", label: "Profile", icon: User },
  { href: "/account/settings", label: "Settings", icon: Settings },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-page py-8 md:py-12">
      <div className="grid gap-8 lg:grid-cols-[14rem_1fr]">
        {/* Sidebar on desktop; a horizontal scrolling rail on mobile, because
            a 7-item vertical nav above content pushes the page off-screen. */}
        <nav aria-label="Account" className="lg:sticky lg:top-[calc(var(--nav-h)+1.5rem)] lg:self-start">
          <ul className="rail -mx-[var(--gutter)] flex gap-2 px-[var(--gutter)] pb-2 lg:mx-0 lg:block lg:space-y-0.5 lg:px-0 lg:pb-0">
            {LINKS.map((l) => (
              <li key={l.href} className="shrink-0">
                <Link
                  href={l.href}
                  className="flex items-center gap-2.5 whitespace-nowrap rounded-[var(--radius-md)] px-3.5 py-2.5 text-[length:var(--text-sm)] text-[var(--text-2)] transition-colors hover:bg-[var(--surface-0)] hover:text-[var(--text-1)]"
                >
                  <l.icon className="size-4 shrink-0" aria-hidden />
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
