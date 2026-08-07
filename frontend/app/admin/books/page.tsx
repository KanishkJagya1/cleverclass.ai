"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileText, Pencil, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminAuth, useAdminData } from "@/features/admin/auth-context";
import { adminFetch, AdminApiError } from "@/features/admin/api";
import type { AdminBookRow } from "@/features/admin/api";
import { CoverImage } from "@/components/ui/cover-image";
import { formatPrice } from "@/lib/utils";

interface Paged {
  items: AdminBookRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

const STATUSES = ["", "published", "draft", "archived"] as const;

function StatusPill({ status }: { status: AdminBookRow["status"] }) {
  const tone =
    status === "published"
      ? "bg-[var(--signal-gain-soft)] text-[color:var(--signal-gain)]"
      : status === "draft"
        ? "bg-[var(--surface-0)] text-[color:var(--text-2)]"
        : "bg-[var(--signal-danger-soft)] text-[color:var(--signal-danger)]";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[length:var(--text-2xs)] font-medium ${tone}`}>
      {status}
    </span>
  );
}

/**
 * What the sample column says, at a glance:
 *   "No PDF"      nothing uploaded — this book can never show a free sample
 *   "Processing"  text extraction still running
 *   "Set pages"   PDF is ready but no pages are marked free yet
 *   "N free"      done
 */
function SampleCell({ row }: { row: AdminBookRow }) {
  if (!row.pdfState) {
    return <span className="text-[length:var(--text-xs)] text-[color:var(--text-3)]">No PDF</span>;
  }
  if (row.pdfState === "failed") {
    return <span className="text-[length:var(--text-xs)] text-[color:var(--signal-danger)]">PDF failed</span>;
  }
  if (row.pdfState !== "ready") {
    return <span className="text-[length:var(--text-xs)] text-[color:var(--text-2)]">Processing…</span>;
  }
  if (row.freePages === 0) {
    return (
      <span className="text-[length:var(--text-xs)] font-medium text-[color:var(--signal-danger)]">
        Set pages
      </span>
    );
  }
  return (
    <span className="tabular text-[length:var(--text-xs)] text-[color:var(--text-2)]">
      {row.freePages} of {row.pageCount} free
    </span>
  );
}

export default function AdminBooksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const status = params.get("status") ?? "";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? 1);

  // Local state so typing feels instant; the URL updates on a debounce, which
  // keeps the list shareable and the back button honest.
  const [term, setTerm] = React.useState(q);
  React.useEffect(() => setTerm(q), [q]);

  const setParam = React.useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (!v) next.delete(k);
        else next.set(k, v);
      }
      if (!("page" in patch)) next.delete("page");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  React.useEffect(() => {
    if (term === q) return;
    const t = setTimeout(() => setParam({ q: term || undefined }), 300);
    return () => clearTimeout(t);
  }, [term, q, setParam]);

  const [message, setMessage] = React.useState<string | null>(null);

  const query = new URLSearchParams();
  if (status) query.set("status", status);
  if (q) query.set("q", q);
  query.set("page", String(page));
  query.set("perPage", "10");
  const { data, error, loading, reload } = useAdminData<Paged>(`/books?${query}`, [
    status,
    q,
    page,
  ]);

  return (
    <>
      <AdminPageHeader
        title="Books"
        description={data ? `${data.total} in the catalogue` : undefined}
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/books/bulk">Bulk import</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/books/deleted">Deleted</Link>
            </Button>
            <Button asChild>
              <Link href="/admin/books/new">Add a book</Link>
            </Button>
          </div>
        }
      />

      {message ? (
        <p
          className="mb-4 rounded-[var(--radius-md)] border border-[var(--border-1)] p-3 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
          role="status"
        >
          {message}
        </p>
      ) : null}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--text-3)]"
            aria-hidden
          />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search title, slug or subject"
            aria-label="Search books"
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          {STATUSES.map((s) => (
            <button
              key={s || "all"}
              onClick={() => setParam({ status: s || undefined })}
              aria-current={status === s ? "true" : undefined}
              className={
                "chip-tap rounded-[var(--radius-md)] border px-3 text-[length:var(--text-sm)] " +
                (status === s
                  ? "border-[var(--brand-base)] bg-[var(--brand-soft)] text-[color:var(--text-brand)]"
                  : "border-[var(--border-1)] text-[color:var(--text-2)] hover:border-[var(--border-2)]")
              }
            >
              {s || "All"}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <ErrorState title="Couldn't load books" description={error} onRetry={reload} showPhone={false} />
      ) : loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : data && data.items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={q || status ? "No books match" : "No books yet"}
          description={
            q || status
              ? "Try a different search or clear the status filter."
              : "Add your first book to get started."
          }
          action={{ label: "Add a book", href: "/admin/books/new" }}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-left text-[length:var(--text-sm)]">
              <thead>
                <tr className="border-b border-[var(--border-1)] text-[length:var(--text-xs)] uppercase tracking-[var(--tracking-wide)] text-[color:var(--text-3)]">
                  <th scope="col" className="py-2 pr-3 font-medium">Book</th>
                  <th scope="col" className="px-3 py-2 font-medium">Class</th>
                  <th scope="col" className="px-3 py-2 font-medium">Medium</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Price</th>
                  <th scope="col" className="px-3 py-2 font-medium">Stock</th>
                  <th scope="col" className="px-3 py-2 font-medium">Free sample</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((b) => (
                  <tr
                    key={b.id}
                    className="border-b border-[var(--border-1)] last:border-0 hover:bg-[var(--surface-0)]"
                  >
                    <td className="py-2.5 pr-3">
                      <Link href={`/admin/books/${b.slug}`} className="flex items-center gap-3">
                        <span className="relative aspect-cover w-8 shrink-0 overflow-hidden rounded-[var(--radius-xs)] bg-[var(--surface-0)]">
                          <CoverImage src={b.cover} alt="" title={b.title} slug={b.slug} sizes="32px" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-[color:var(--text-1)]">
                            {b.title}
                          </span>
                          <span className="block truncate text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                            {b.slug}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-[color:var(--text-2)]">{b.classId}</td>
                    <td className="px-3 py-2.5 text-[color:var(--text-2)]">{b.medium}</td>
                    <td className="tabular px-3 py-2.5 text-right text-[color:var(--text-1)]">
                      {formatPrice(b.price)}
                    </td>
                    <td className="px-3 py-2.5">
                      {b.inStock ? (
                        <span className="text-[length:var(--text-xs)] text-[color:var(--signal-gain)]">In stock</span>
                      ) : (
                        <span className="text-[length:var(--text-xs)] text-[color:var(--signal-danger)]">Out</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5"><SampleCell row={b} /></td>
                    <td className="px-3 py-2.5"><StatusPill status={b.status} /></td>
                    <td className="px-3 py-2.5 text-right">
                      <RowActions
                        slug={b.slug}
                        title={b.title}
                        onDeleted={(msg) => {
                          setMessage(msg);
                          reload();
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* A data table under 768px is unusable, so it becomes cards. */}
          <ul className="space-y-2 md:hidden">
            {data?.items.map((b) => (
              <li key={b.id}>
                <Link href={`/admin/books/${b.slug}`} className="surface-card flex gap-3 p-3">
                  <span className="relative aspect-cover w-12 shrink-0 overflow-hidden rounded-[var(--radius-xs)] bg-[var(--surface-0)]">
                    <CoverImage src={b.cover} alt="" title={b.title} slug={b.slug} sizes="48px" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="clamp-2 font-medium text-[color:var(--text-1)]">{b.title}</span>
                      <StatusPill status={b.status} />
                    </span>
                    <span className="mt-1 block text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                      Class {b.classId} · {b.medium} · {formatPrice(b.price)}
                    </span>
                    <span className="mt-1 block"><SampleCell row={b} /></span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {data && data.totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setParam({ page: String(page - 1) })}
              >
                Previous
              </Button>
              <span className="tabular text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                Page {data.page} of {data.totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= data.totalPages}
                onClick={() => setParam({ page: String(page + 1) })}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

/**
 * Per-row edit and delete.
 *
 * Delete is a SOFT delete — the book leaves the shop but its row stays, so
 * existing orders and invoices can still name what was sold. The confirmation
 * says exactly that rather than the usual "cannot be undone", which would be
 * false here and teaches people to distrust the warnings that are true.
 */
function RowActions({
  slug,
  title,
  onDeleted,
}: {
  slug: string;
  title: string;
  onDeleted: (message: string) => void;
}) {
  const { csrf } = useAdminAuth();
  const [busy, setBusy] = React.useState(false);

  async function remove() {
    const ok = window.confirm(
      `Delete "${title}"?\n\nIt disappears from the shop and search. Existing orders keep working, and you can restore it from Deleted books.`,
    );
    if (!ok) return;

    setBusy(true);
    try {
      await adminFetch(`/books/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        csrf,
      });
      onDeleted(`Deleted "${title}". You can restore it from Deleted books.`);
    } catch (err) {
      onDeleted(
        err instanceof AdminApiError || err instanceof Error
          ? err.message
          : "Couldn't delete that book",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-end gap-1">
      <Link
        href={`/admin/books/${slug}`}
        aria-label={`Edit ${title}`}
        className="inline-flex size-9 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--text-2)] hover:bg-[var(--surface-0)]"
      >
        <Pencil className="size-4" />
      </Link>
      <button
        type="button"
        aria-label={`Delete ${title}`}
        disabled={busy}
        onClick={() => void remove()}
        className="inline-flex size-9 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--text-2)] hover:bg-[var(--signal-danger-soft)] hover:text-[color:var(--signal-danger)] disabled:opacity-40"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
