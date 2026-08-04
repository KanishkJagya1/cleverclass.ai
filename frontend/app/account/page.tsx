"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Download, Heart, MailWarning, ShoppingBag } from "lucide-react";
import { auth, type OrderSummary, type User } from "@/lib/auth/provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";

/**
 * Account overview, backed by the real session.
 *
 * This page previously announced that "accounts are not connected yet" and
 * named NextAuth/Clerk/Supabase as future work, with a hardcoded 0 in every
 * tile. Auth is real now, so the copy was false — and the zeroes were the worse
 * half, because a customer with three orders was being told they had none.
 */
export default function AccountOverviewPage() {
  const router = useRouter();
  const [user, setUser] = React.useState<User | null>(null);
  const [orders, setOrders] = React.useState<OrderSummary[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [resent, setResent] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const session = await auth.getSession().catch(() => null);
      if (!alive) return;
      if (!session) {
        // middleware.ts does not gate /account — it was written while the auth
        // provider was still a stub, so gating it would have locked everyone
        // out of pages that worked. The redirect lives here until that changes.
        router.replace("/login?next=/account");
        return;
      }
      setUser(session);
      const list = await auth.orders().catch(() => []);
      if (!alive) return;
      setOrders(list);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  const tiles = [
    {
      href: "/account/orders",
      label: "Orders",
      value: orders ? String(orders.length) : "—",
      icon: ShoppingBag,
      hint: orders?.length ? "View and track" : "No orders yet",
    },
    { href: "/account/wishlist", label: "Wishlist", value: "—", icon: Heart, hint: "Saved books" },
    { href: "/account/downloads", label: "Downloads", value: "0", icon: Download, hint: "Purchased notes" },
  ];

  if (loading && !user) {
    return (
      <div>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="mt-3 h-4 w-80" />
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 rounded-[var(--radius-lg)]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[length:var(--text-3xl)]">
        {user?.name ? `Hello, ${user.name.split(" ")[0]}` : "Your account"}
      </h1>
      <p className="mt-2 text-[length:var(--text-body)] text-[color:var(--text-2)]">
        Orders, saved books and downloads in one place.
      </p>

      {/* Verification does not gate sign-in, but it IS what lets guest orders
          placed with this address appear here — so the prompt states the
          benefit rather than just nagging. */}
      {user && !user.emailVerified && (
        <div
          role="status"
          className="surface-card mt-6 flex flex-wrap items-start gap-3 border-[var(--brand-base)] p-4"
        >
          <MailWarning className="mt-0.5 size-5 shrink-0 text-[color:var(--brand-base)]" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
              Confirm your email address
            </p>
            <p className="mt-1 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
              Once confirmed, any order placed as a guest using {user.email} shows
              up here automatically.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={resent}
            onClick={async () => {
              await auth.resendVerification().catch(() => {});
              setResent(true);
            }}
          >
            {resent ? "Email sent" : "Resend email"}
          </Button>
        </div>
      )}

      <ul className="mt-8 grid gap-4 sm:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.href}>
            <Link href={t.href} className="surface-card lift flex h-full flex-col p-5">
              <t.icon className="size-5 text-[color:var(--brand-base)]" aria-hidden />
              <span className="tabular mt-4 font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-bold text-[color:var(--text-1)]">
                {t.value}
              </span>
              <span className="mt-0.5 text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                {t.label}
              </span>
              <span className="mt-0.5 text-[length:var(--text-xs)] text-[color:var(--text-3)]">{t.hint}</span>
            </Link>
          </li>
        ))}
      </ul>

      {orders && orders.length === 0 && (
        <div className="surface-card mt-8 p-6">
          <h2 className="text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
            No orders yet
          </h2>
          <p className="mt-2 max-w-lg text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]">
            When you place an order it appears here with its status and delivery
            tracking.
          </p>
          <Button asChild variant="secondary" className="mt-5">
            <Link href="/shop">
              Browse books
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      )}

      {orders && orders.length > 0 && (
        <section className="mt-8" aria-labelledby="recent-orders">
          <div className="flex items-baseline justify-between">
            <h2
              id="recent-orders"
              className="text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]"
            >
              Recent orders
            </h2>
            <Link
              href="/account/orders"
              className="text-[length:var(--text-sm)] text-[color:var(--text-brand)] hover:underline"
            >
              See all
            </Link>
          </div>
          <ul className="mt-4 space-y-3">
            {orders.slice(0, 3).map((o) => (
              <li key={o.orderNumber}>
                <Link
                  href="/account/orders"
                  className="surface-card lift flex items-center justify-between gap-4 p-4"
                >
                  <div className="min-w-0">
                    <p className="tabular text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                      {o.orderNumber}
                    </p>
                    <p className="mt-0.5 truncate text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                      {o.itemCount} item{o.itemCount === 1 ? "" : "s"} ·{" "}
                      {new Date(o.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular text-[length:var(--text-sm)] font-semibold text-[color:var(--text-1)]">
                      ₹{o.total}
                    </p>
                    <p className="mt-0.5 text-[length:var(--text-xs)] capitalize text-[color:var(--text-3)]">
                      {o.status.replace(/_/g, " ")}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
