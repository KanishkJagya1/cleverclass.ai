"use client";

/**
 * My orders.
 *
 * This replaced a hardcoded empty state that said order history "appears here
 * once order management is connected" — it had been connected for a while, and
 * the endpoint behind it was raising `no such column: price`, so a customer
 * with real orders was told they had none.
 */

import * as React from "react";
import Link from "next/link";
import { Package, ShoppingBag } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { formatPrice } from "@/lib/utils";

interface OrderItem {
  slug: string;
  title: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  cover: string | null;
}

interface Order {
  orderNumber: string;
  status: string;
  statusLabel: string;
  paymentStatus: string;
  total: number;
  subtotal: number;
  shipping: number;
  createdAt: string;
  itemCount: number;
  items: OrderItem[];
}

export default function OrdersPage() {
  const [orders, setOrders] = React.useState<Order[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/orders", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (res.status === 401) {
          if (!cancelled) setError("signed-out");
          return;
        }
        if (!res.ok) throw new Error("Couldn't load your orders");
        const data = (await res.json()) as { orders: Order[] };
        if (!cancelled) setOrders(data.orders ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Something went wrong");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error === "signed-out") {
    return (
      <div>
        <Heading />
        <div className="mt-8">
          <EmptyState
            icon={ShoppingBag}
            title="Sign in to see your orders"
            description="Your order history is tied to your account."
            action={{ label: "Sign in", href: "/login" }}
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Heading />
        <p className="mt-6 rounded-[var(--radius-md)] border border-[var(--border-1)] p-4 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          {error}
        </p>
      </div>
    );
  }

  if (orders === null) {
    return (
      <div>
        <Heading />
        <p className="mt-6 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          Loading…
        </p>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div>
        <Heading />
        <div className="mt-8">
          <EmptyState
            icon={ShoppingBag}
            title="No orders yet"
            description="Books you order will appear here with their delivery status."
            action={{ label: "Start shopping", href: "/shop" }}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <Heading />
      <ul className="mt-8 space-y-4">
        {orders.map((o) => (
          <li
            key={o.orderNumber}
            className="rounded-[var(--radius-lg)] border border-[var(--border-1)] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-1)] pb-3">
              <div>
                <p className="tabular font-medium text-[color:var(--text-1)]">
                  {o.orderNumber}
                </p>
                <p className="text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                  {new Date(o.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}{" "}
                  · {o.itemCount} item{o.itemCount === 1 ? "" : "s"}
                </p>
              </div>
              <div className="text-right">
                <p className="tabular font-semibold text-[color:var(--text-1)]">
                  {formatPrice(o.total)}
                </p>
                <div className="mt-1 flex flex-wrap justify-end gap-1">
                  <Badge tone="neutral">{o.statusLabel || o.status}</Badge>
                  {/* Payment and delivery are different questions, so they get
                      different badges rather than one merged "status". */}
                  <Badge tone={o.paymentStatus === "paid" ? "good" : "warn"}>
                    {o.paymentStatus === "paid" ? "Paid" : o.paymentStatus}
                  </Badge>
                </div>
              </div>
            </div>

            <ul className="mt-3 space-y-3">
              {o.items.map((it) => (
                <li key={`${o.orderNumber}-${it.slug}`} className="flex gap-3">
                  <span className="relative h-16 w-12 shrink-0 overflow-hidden rounded-[var(--radius-xs)] bg-[var(--surface-0)]">
                    {it.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.cover}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="grid h-full w-full place-items-center">
                        <Package className="size-4 text-[color:var(--text-3)]" />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link
                      href={`/shop/${it.slug}`}
                      className="block truncate font-medium text-[color:var(--text-1)]"
                    >
                      {it.title}
                    </Link>
                    <span className="block text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                      Qty {it.qty} · {formatPrice(it.unitPrice)} each
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-[color:var(--text-1)]">
                    {formatPrice(it.lineTotal)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex justify-between border-t border-[var(--border-1)] pt-3 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
              <span>
                Subtotal {formatPrice(o.subtotal)}
                {o.shipping > 0 ? ` · Shipping ${formatPrice(o.shipping)}` : " · Free shipping"}
              </span>
              <Link
                href={`/account/track?order=${encodeURIComponent(o.orderNumber)}`}
                className="font-medium text-[color:var(--text-brand)]"
              >
                Track
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Heading() {
  return (
    <>
      <h1 className="text-[length:var(--text-3xl)]">Orders</h1>
      <p className="mt-2 text-[length:var(--text-body)] text-[color:var(--text-2)]">
        Every order you place, with its delivery status.
      </p>
    </>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "neutral" | "good" | "warn";
}) {
  const tones = {
    neutral: "bg-[var(--surface-0)] text-[color:var(--text-2)]",
    good: "bg-emerald-500/10 text-emerald-600",
    warn: "bg-amber-500/10 text-amber-700",
  } as const;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[length:var(--text-2xs)] font-medium capitalize ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
