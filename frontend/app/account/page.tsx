import Link from "next/link";
import { ArrowRight, Download, Heart, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AccountOverviewPage() {
  const tiles = [
    { href: "/account/orders", label: "Orders", value: "0", icon: ShoppingBag, hint: "No orders yet" },
    { href: "/account/wishlist", label: "Wishlist", value: "—", icon: Heart, hint: "Saved books" },
    { href: "/account/downloads", label: "Downloads", value: "0", icon: Download, hint: "Purchased notes" },
  ];

  return (
    <div>
      <h1 className="text-[length:var(--text-3xl)]">Your account</h1>
      <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-2)]">
        Orders, saved books and downloads in one place.
      </p>

      <ul className="mt-8 grid gap-4 sm:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.href}>
            <Link href={t.href} className="surface-card lift flex h-full flex-col p-5">
              <t.icon className="size-5 text-[var(--brand-base)]" aria-hidden />
              <span className="tabular mt-4 font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-bold text-[var(--text-1)]">
                {t.value}
              </span>
              <span className="mt-0.5 text-[length:var(--text-sm)] font-medium text-[var(--text-1)]">
                {t.label}
              </span>
              <span className="mt-0.5 text-[length:var(--text-xs)] text-[var(--text-3)]">{t.hint}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="surface-card mt-8 p-6">
        <h2 className="text-[length:var(--text-lg)] font-semibold text-[var(--text-1)]">
          Accounts are not connected yet
        </h2>
        <p className="mt-2 max-w-lg text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-[var(--text-2)]">
          Every account screen is built against a typed <code>AuthProvider</code>{" "}
          interface backed by a stub. Connecting NextAuth, Clerk or Supabase Auth
          replaces one module — no screen changes.
        </p>
        <Button asChild variant="secondary" className="mt-5">
          <Link href="/shop">
            Browse books
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}
