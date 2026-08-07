"use client";

/**
 * Admin dashboard.
 *
 * Three bands, in the order someone actually needs them: what is waiting on
 * you, what has just happened, and the catalogue's health. The old version led
 * with catalogue counts, which are the numbers you check weekly, not the ones
 * you open the panel for.
 */

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  FileText,
  IndianRupee,
  Mail,
  Package,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminData } from "@/features/admin/auth-context";
import { formatPrice } from "@/lib/utils";

interface RecentOrder {
  orderNumber: string;
  customerName: string;
  status: string;
  paymentStatus: string;
  total: number;
  createdAt: string;
}

interface Stats {
  books: {
    total: number;
    published: number;
    draft: number;
    outOfStock: number;
    withPdf: number;
    withFreePages: number;
  };
  orders: {
    total: number;
    requested: number;
    revenue: number;
    unpaid: number;
  };
  customers: { total: number; active: number };
  leads: { contact: number; newsletter: number };
  recentOrders: RecentOrder[];
}

export default function AdminDashboard() {
  const { data, error, loading, reload } = useAdminData<Stats>("/stats");

  if (error) {
    return (
      <ErrorState
        title="Couldn't load the dashboard"
        description={error}
        onRetry={reload}
        showPhone={false}
      />
    );
  }

  if (loading || !data) {
    return (
      <>
        <AdminPageHeader title="Dashboard" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-[var(--radius-lg)]" />
          ))}
        </div>
      </>
    );
  }

  const { books, orders, customers, leads, recentOrders } = data;
  const missingPdf = Math.max(0, books.published - books.withPdf);
  const missingRanges = Math.max(0, books.withPdf - books.withFreePages);

  return (
    <>
      <AdminPageHeader
        title="Dashboard"
        description="What needs you, what just happened, and how the catalogue is doing."
        action={
          <Button asChild>
            <Link href="/admin/books/new">Add a book</Link>
          </Button>
        }
      />

      {/* ---------------------------------------------------- headline -- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Revenue"
          value={formatPrice(orders.revenue)}
          hint={`${orders.total} orders all time`}
          icon={IndianRupee}
          href="/admin/orders"
        />
        <Stat
          label="To confirm"
          value={orders.requested}
          hint="Order requests awaiting a call"
          icon={Package}
          href="/admin/orders?status=requested"
          tone={orders.requested > 0 ? "attention" : "default"}
        />
        <Stat
          label="Unpaid"
          value={orders.unpaid}
          hint="Confirmed but not yet paid"
          icon={AlertTriangle}
          href="/admin/orders?paymentStatus=unpaid"
          tone={orders.unpaid > 0 ? "warn" : "default"}
        />
        <Stat
          label="Users"
          value={customers.total}
          hint={`${customers.active} active`}
          icon={Users}
          href="/admin/customers"
        />
      </div>

      {/* ------------------------------------------------ recent orders -- */}
      <SectionHeading
        title="Latest orders"
        href="/admin/orders"
        linkLabel="All orders"
      />
      {recentOrders.length === 0 ? (
        <p className="surface-card p-5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          No orders yet.
        </p>
      ) : (
        <div className="surface-card overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-[length:var(--text-sm)]">
            <thead>
              <tr className="border-b border-[var(--border-1)] text-left text-[color:var(--text-3)]">
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((o) => (
                <tr
                  key={o.orderNumber}
                  className="border-b border-[var(--border-1)] last:border-0"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/orders/${encodeURIComponent(o.orderNumber)}`}
                      className="tabular font-medium text-[color:var(--text-brand)]"
                    >
                      {o.orderNumber}
                    </Link>
                    <span className="block text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                      {new Date(o.createdAt).toLocaleDateString("en-IN")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[color:var(--text-2)]">
                    {o.customerName}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex rounded-full bg-[var(--surface-0)] px-2 py-0.5 text-[length:var(--text-2xs)] font-medium capitalize text-[color:var(--text-2)]">
                      {o.status}
                    </span>
                    {o.paymentStatus !== "paid" ? (
                      <span className="ml-1 inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-[length:var(--text-2xs)] font-medium text-amber-700">
                        {o.paymentStatus}
                      </span>
                    ) : null}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right text-[color:var(--text-1)]">
                    {formatPrice(o.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------------------------------------------- catalogue -- */}
      <SectionHeading title="Catalogue" href="/admin/books" linkLabel="All books" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Published"
          value={books.published}
          hint={`${books.draft} draft · ${books.total} total`}
          icon={BookOpen}
          href="/admin/books?status=published"
        />
        <Stat
          label="Out of stock"
          value={books.outOfStock}
          hint="Won't be recommended by the assistant"
          icon={AlertTriangle}
          href="/admin/books"
          tone={books.outOfStock > 0 ? "warn" : "default"}
        />
        <Stat
          label="Need a PDF"
          value={missingPdf}
          hint="No PDF means no free sample"
          icon={FileText}
          tone={missingPdf > 0 ? "warn" : "default"}
        />
        <Stat
          label="No free pages set"
          value={missingRanges}
          hint="Uploaded, but nothing marked free yet"
          icon={AlertTriangle}
          tone={missingRanges > 0 ? "warn" : "default"}
        />
      </div>

      {/* ------------------------------------------------------ enquiries */}
      <SectionHeading title="Enquiries" href="/admin/leads" linkLabel="All enquiries" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          label="Unhandled"
          value={leads.contact}
          hint="Nobody has replied yet"
          icon={Mail}
          href="/admin/leads"
          tone={leads.contact > 0 ? "attention" : "default"}
        />
        <Stat
          label="Newsletter"
          value={leads.newsletter}
          hint="Signups all time"
          icon={Mail}
          href="/admin/leads?kind=newsletter"
        />
      </div>
    </>
  );
}

function SectionHeading({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="mb-4 mt-10 flex items-baseline justify-between gap-3">
      <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
        {title}
      </h2>
      <Link
        href={href}
        className="inline-flex min-h-11 items-center gap-1 text-[length:var(--text-sm)] font-medium text-[color:var(--text-brand)]"
      >
        {linkLabel}
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-2 text-[length:var(--text-xs)] font-medium uppercase tracking-wide ${className}`}
    >
      {children}
    </th>
  );
}

function Stat({
  label,
  value,
  hint,
  href,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "warn" | "attention";
}) {
  // Colour only when the number means something is wrong. A dashboard where
  // everything is coloured tells you nothing at a glance.
  const isZero = value === 0 || value === "0";
  const valueTone =
    tone === "default" || isZero
      ? "text-[color:var(--text-1)]"
      : tone === "warn"
        ? "text-[color:var(--signal-danger)]"
        : "text-[color:var(--text-brand)]";

  const body = (
    <div className="surface-card h-full p-5 transition-colors hover:border-[var(--border-2)]">
      <div className="flex items-center gap-2 text-[color:var(--text-3)]">
        <Icon className="size-4" aria-hidden />
        <span className="text-[length:var(--text-xs)] font-medium uppercase tracking-[var(--tracking-wide)]">
          {label}
        </span>
      </div>
      <p
        className={`tabular mt-3 font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-bold ${valueTone}`}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
          {hint}
        </p>
      ) : null}
    </div>
  );

  return href ? (
    <Link href={href} className="block focus-ring rounded-[var(--radius-lg)]">
      {body}
    </Link>
  ) : (
    body
  );
}
