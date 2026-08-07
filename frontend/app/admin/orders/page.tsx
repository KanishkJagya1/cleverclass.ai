"use client";

import * as React from "react";
import Link from "next/link";
import { Package, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAdminAuth } from "@/features/admin/auth-context";
import { adminFetch, AdminApiError } from "@/features/admin/api";

import { Input, Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import {
  Pagination,
  usePaginatedAdminData,
} from "@/features/admin/pagination";
import { formatPrice } from "@/lib/utils";
import { SITE } from "@/constants/catalog";

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  customer_name: string;
  phone: string;
  city: string;
  pincode: string;
  total: number;
  created_at: string;
  items: { slug: string; title: string; qty: number; line_total: number }[];
}

const STATUSES = [
  "",
  "requested",
  "confirmed",
  "packed",
  "shipped",
  "delivered",
  "cancelled",
] as const;

const PAYMENT_STATUSES = ["", "unpaid", "paid", "refunded"] as const;

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "highest", label: "Highest value" },
  { value: "lowest", label: "Lowest value" },
] as const;

export default function AdminOrdersPage() {
  const [status, setStatus] = React.useState("");
  const [paymentStatus, setPaymentStatus] = React.useState("");
  const [sort, setSort] = React.useState<string>("newest");
  const [search, setSearch] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const { csrf } = useAdminAuth();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [bulkResult, setBulkResult] = React.useState<string | null>(null);

  // Debounced so typing a phone number does not fire a request per keystroke.
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, error, loading, reload, page, setPage } =
    usePaginatedAdminData<OrderRow>("/orders", {
      status,
      paymentStatus,
      sort,
      q: debounced,
      dateFrom,
      dateTo,
    }, 10);

  if (error) {
    return (
      <ErrorState
        title="Couldn't load orders"
        description={error}
        onRetry={reload}
        showPhone={false}
      />
    );
  }

  const orders = data?.items ?? [];
  const filtered =
    status || paymentStatus || debounced || dateFrom || dateTo;

  return (
    <>
      <AdminPageHeader
        title="Order requests"
        description="No online payment yet — every order here is a request to confirm by phone."
      />

      <div className="mb-4 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--text-3)]" />
          {/* One box for all four, because a customer phoning about an order
              almost never knows its number. */}
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Order number, name, email or phone"
            className="pl-9"
            aria-label="Search orders"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Select
            label="Status"
            value={status}
            onChange={setStatus}
            options={STATUSES.map((s) => ({
              value: s,
              label: s === "" ? "All statuses" : s,
            }))}
          />
          <Select
            label="Payment"
            value={paymentStatus}
            onChange={setPaymentStatus}
            options={PAYMENT_STATUSES.map((s) => ({
              value: s,
              label: s === "" ? "Any payment" : s,
            }))}
          />
          <Select
            label="Sort"
            value={sort}
            onChange={setSort}
            options={SORTS.map((s) => ({ value: s.value, label: s.label }))}
          />
          <DateInput label="From" value={dateFrom} onChange={setDateFrom} />
          <DateInput label="To" value={dateTo} onChange={setDateTo} />
          {filtered ? (
            <button
              type="button"
              onClick={() => {
                setStatus("");
                setPaymentStatus("");
                setSearch("");
                setDateFrom("");
                setDateTo("");
              }}
              className="min-h-11 text-[length:var(--text-sm)] font-medium text-[color:var(--text-brand)]"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={Package}
          title={filtered ? "No orders match those filters" : "No orders yet"}
          description={
            filtered
              ? "Try widening the date range or clearing the search."
              : "Requests placed through checkout will appear here."
          }
        />
      ) : (
        <>
          {selected.size > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-1)] bg-[var(--surface-1)] p-3">
              <span className="text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                {selected.size} selected
              </span>
              {/* Cancel is deliberately absent: it releases stock and is not
                  something to offer behind a checkbox and one click. */}
              {(["confirmed", "packed", "shipped", "delivered"] as const).map(
                (target) => (
                  <Button
                    key={target}
                    size="sm"
                    variant="outline"
                    disabled={bulkBusy}
                    onClick={async () => {
                      setBulkBusy(true);
                      setBulkResult(null);
                      try {
                        const res = await adminFetch<{
                          movedCount: number;
                          failedCount: number;
                          failed: { orderNumber: string; reason: string }[];
                        }>("/orders/bulk/status", {
                          method: "POST",
                          body: {
                            orderNumbers: [...selected],
                            status: target,
                          },
                          csrf,
                        });
                        // Failures are named, not just counted — "3 failed"
                        // is not something an operator can act on.
                        setBulkResult(
                          res.failedCount === 0
                            ? `Moved ${res.movedCount} to ${target}.`
                            : `Moved ${res.movedCount}. ${res.failedCount} did not move: ` +
                              res.failed
                                .map((f) => `${f.orderNumber} (${f.reason})`)
                                .join("; "),
                        );
                        setSelected(new Set());
                        reload();
                      } catch (err) {
                        setBulkResult(
                          err instanceof AdminApiError || err instanceof Error
                            ? err.message
                            : "That didn't work",
                        );
                      } finally {
                        setBulkBusy(false);
                      }
                    }}
                  >
                    Mark {target}
                  </Button>
                ),
              )}
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="min-h-11 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
              >
                Clear
              </button>
            </div>
          ) : null}

          {bulkResult ? (
            <p className="mb-3 rounded-[var(--radius-md)] border border-[var(--border-1)] p-3 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
              {bulkResult}
            </p>
          ) : null}

          <ul className="space-y-3">
            {orders.map((o) => (
              <li key={o.id} className="surface-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 shrink-0"
                      aria-label={`Select ${o.order_number}`}
                      checked={selected.has(o.order_number)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(o.order_number);
                          else next.delete(o.order_number);
                          return next;
                        })
                      }
                    />
                  <div className="min-w-0">
                    <Link
                      href={`/admin/orders/${encodeURIComponent(o.order_number)}`}
                      className="tabular font-medium text-[color:var(--text-brand)]"
                    >
                      {o.order_number}
                    </Link>
                    <p className="mt-0.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                      {o.customer_name} · {o.phone}
                    </p>
                    <p className="text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                      {o.city} {o.pincode} ·{" "}
                      {new Date(o.created_at).toLocaleString("en-IN")}
                    </p>
                  </div>
                  </div>
                  <div className="text-right">
                    <p className="tabular font-semibold text-[color:var(--text-1)]">
                      {formatPrice(o.total)}
                    </p>
                    <div className="mt-1 flex flex-wrap justify-end gap-1">
                      <Badge>{o.status}</Badge>
                      {/* Shown next to the status because "confirmed" and
                          "unpaid" together is the combination worth chasing. */}
                      {o.payment_status ? (
                        <Badge tone={o.payment_status === "paid" ? "good" : "warn"}>
                          {o.payment_status}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </div>

                <ul className="mt-3 space-y-1 border-t border-[var(--border-1)] pt-3 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                  {o.items.map((it) => (
                    <li key={it.slug} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {it.title} × {it.qty}
                      </span>
                      <span className="tabular shrink-0">
                        {formatPrice(it.line_total)}
                      </span>
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

          <div className="mt-4">
            <Pagination
              page={page}
              totalPages={data?.totalPages ?? 0}
              total={data?.total ?? 0}
              perPage={data?.perPage ?? 50}
              onPage={setPage}
              noun="order"
            />
          </div>
        </>
      )}
    </>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-[length:var(--text-sm)]">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--border-1)]
                   bg-[var(--surface-1)] px-3 text-[color:var(--text-1)]"
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
      {label}
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--border-1)]
                   bg-[var(--surface-1)] px-3 text-[color:var(--text-1)]"
      />
    </label>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn";
}) {
  const tones = {
    neutral: "bg-[var(--surface-0)] text-[color:var(--text-2)]",
    good: "bg-emerald-500/10 text-emerald-600",
    warn: "bg-amber-500/10 text-amber-700",
  } as const;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[length:var(--text-2xs)] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
