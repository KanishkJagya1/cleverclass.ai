"use client";

import { Package } from "lucide-react";
import { Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminData } from "@/features/admin/auth-context";
import { formatPrice } from "@/lib/utils";
import { SITE } from "@/constants/catalog";

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  customer_name: string;
  phone: string;
  city: string;
  pincode: string;
  total: number;
  created_at: string;
  items: { slug: string; title: string; qty: number; line_total: number }[];
}

export default function AdminOrdersPage() {
  const { data, error, loading, reload } = useAdminData<OrderRow[]>("/orders");

  if (error) {
    return (
      <ErrorState title="Couldn't load orders" description={error} onRetry={reload} showPhone={false} />
    );
  }

  return (
    <>
      <AdminPageHeader
        title="Order requests"
        description="No online payment yet — every order here is a request to confirm by phone."
      />

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : !data?.length ? (
        <EmptyState
          icon={Package}
          title="No orders yet"
          description="Requests placed through checkout will appear here."
        />
      ) : (
        <ul className="space-y-3">
          {data.map((o) => (
            <li key={o.id} className="surface-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="tabular font-medium text-[color:var(--text-1)]">{o.order_number}</p>
                  <p className="mt-0.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                    {o.customer_name} · {o.phone}
                  </p>
                  <p className="text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                    {o.city} {o.pincode} · {new Date(o.created_at).toLocaleString("en-IN")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="tabular font-semibold text-[color:var(--text-1)]">
                    {formatPrice(o.total)}
                  </p>
                  <span className="mt-1 inline-flex rounded-full bg-[var(--surface-0)] px-2 py-0.5 text-[length:var(--text-2xs)] font-medium text-[color:var(--text-2)]">
                    {o.status}
                  </span>
                </div>
              </div>

              <ul className="mt-3 space-y-1 border-t border-[var(--border-1)] pt-3 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                {o.items.map((it) => (
                  <li key={it.slug} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">
                      {it.title} × {it.qty}
                    </span>
                    <span className="tabular shrink-0">{formatPrice(it.line_total)}</span>
                  </li>
                ))}
              </ul>

              {/* One tap to do the thing this screen exists for. */}
              <a
                href={`https://wa.me/${SITE.phones[0].replace(/\D/g, "")}?text=${encodeURIComponent(
                  `Hello ${o.customer_name}, this is CleverClass about order ${o.order_number}.`,
                )}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex min-h-11 items-center text-[length:var(--text-sm)] font-medium text-[color:var(--text-brand)]"
              >
                Message on WhatsApp
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
