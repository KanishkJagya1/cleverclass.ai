"use client";

import Link from "next/link";
import { AlertTriangle, BookOpen, FileText, Mail, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminData } from "@/features/admin/auth-context";
import type { AdminStats } from "@/features/admin/api";

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
  tone?: "default" | "warn";
}) {
  const body = (
    <div className="surface-card h-full p-5">
      <div className="flex items-center gap-2 text-[color:var(--text-3)]">
        <Icon className="size-4" aria-hidden />
        <span className="text-[length:var(--text-xs)] font-medium uppercase tracking-[var(--tracking-wide)]">
          {label}
        </span>
      </div>
      <p
        className={
          "tabular mt-3 font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-bold " +
          (tone === "warn" && Number(value) > 0
            ? "text-[color:var(--signal-danger)]"
            : "text-[color:var(--text-1)]")
        }
      >
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-[length:var(--text-xs)] text-[color:var(--text-3)]">{hint}</p>
      )}
    </div>
  );
  return href ? (
    <Link href={href} className="block focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}

export default function AdminDashboard() {
  const { data, error, loading, reload } = useAdminData<AdminStats>("/stats");

  if (error) {
    return <ErrorState title="Couldn't load the dashboard" description={error} onRetry={reload} showPhone={false} />;
  }

  if (loading || !data) {
    return (
      <>
        <AdminPageHeader title="Dashboard" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-[var(--radius-lg)]" />
          ))}
        </div>
      </>
    );
  }

  const { books, orders, leads } = data;
  // The two numbers that actually tell the owner what to do next: books with
  // no PDF cannot have a free sample, and a book with no free sample gets no
  // preview CTA and nothing for the assistant to link to.
  const missingPdf = books.published - books.withPdf;
  const missingRanges = books.withPdf - books.withFreePages;

  return (
    <>
      <AdminPageHeader
        title="Dashboard"
        description="Catalogue health and anything waiting on you."
        action={
          <Button asChild>
            <Link href="/admin/books/new">Add a book</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Published" value={books.published} icon={BookOpen} href="/admin/books?status=published"
              hint={`${books.draft} draft · ${books.total} total`} />
        <Stat label="Out of stock" value={books.outOfStock} icon={AlertTriangle} tone="warn"
              href="/admin/books" hint="Won't be recommended by the assistant" />
        <Stat label="Order requests" value={orders.requested} icon={Package} href="/admin/orders"
              hint={`${orders.total} all time`} />
        <Stat label="New enquiries" value={leads.contact} icon={Mail} href="/admin/leads"
              hint={`${leads.newsletter} newsletter signups`} />
      </div>

      <h2 className="mb-4 mt-10 font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
        Free samples
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="With a PDF" value={books.withPdf} icon={FileText}
              hint={`of ${books.published} published`} />
        <Stat label="Need a PDF" value={Math.max(0, missingPdf)} icon={FileText} tone="warn"
              hint="No PDF means no free sample" />
        <Stat label="With free pages" value={books.withFreePages} icon={BookOpen}
              hint="Shown in the preview reader" />
        <Stat label="PDF but no pages set" value={Math.max(0, missingRanges)} icon={AlertTriangle}
              tone="warn" hint="Uploaded, but nothing marked free yet" />
      </div>

      <div className="surface-card mt-8 p-5">
        <h3 className="text-[length:var(--text-base)] font-semibold text-[color:var(--text-1)]">
          How a book becomes sellable
        </h3>
        <ol className="mt-3 space-y-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          <li>1. Add the book with its price, class and medium.</li>
          <li>2. Upload the PDF — page text is extracted in the background.</li>
          <li>
            3. Mark which pages are free, the way a printed sample chapter works.
            Only those pages are ever served, and only those reach the assistant.
          </li>
          <li>4. Publish. The storefront updates within seconds.</li>
        </ol>
      </div>
    </>
  );
}
