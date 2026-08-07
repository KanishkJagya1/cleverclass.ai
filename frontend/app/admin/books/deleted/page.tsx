"use client";

/**
 * The bin.
 *
 * Nothing here is gone — a deleted book keeps its row so orders and invoices
 * can still name what was sold. This screen exists so that is visible rather
 * than merely true: an operator who deleted the wrong book needs to see it and
 * put it back, not file a support ticket.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Trash2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminAuth } from "@/features/admin/auth-context";
import { adminFetch, AdminApiError } from "@/features/admin/api";
import {
  Pagination,
  usePaginatedAdminData,
} from "@/features/admin/pagination";
import { formatPrice } from "@/lib/utils";

interface DeletedBook {
  slug: string;
  title: string;
  classId: string;
  medium: string;
  subject: string;
  price: number;
  deletedAt: string;
  deletedBy: string | null;
}

export default function AdminDeletedBooksPage() {
  const { csrf } = useAdminAuth();
  const { data, error, loading, reload, page, setPage } =
    usePaginatedAdminData<DeletedBook>("/books/deleted");

  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const rows = data?.items ?? [];

  async function restore(slug: string) {
    setBusy(slug);
    setMessage(null);
    try {
      await adminFetch(`/books/${encodeURIComponent(slug)}/restore`, {
        method: "POST",
        body: { status: "draft" },
        csrf,
      });
      // Said explicitly: an operator who restores a book and then cannot find
      // it in the shop will assume the restore failed.
      setMessage(`Restored ${slug} as a draft. Publish it when you're ready.`);
      reload();
    } catch (err) {
      setMessage(
        err instanceof AdminApiError || err instanceof Error
          ? err.message
          : "Couldn't restore that book",
      );
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <ErrorState
        title="Couldn't load deleted books"
        description={error}
        onRetry={reload}
        showPhone={false}
      />
    );
  }

  return (
    <>
      <Link
        href="/admin/books"
        className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
      >
        <ArrowLeft className="size-4" />
        All books
      </Link>

      <AdminPageHeader
        title="Deleted books"
        description="Nothing here is permanently gone — orders and invoices still reference these. Restore brings a book back as a draft."
      />

      {message ? (
        <p className="mb-4 rounded-[var(--radius-md)] border border-[var(--border-1)] p-3 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          {message}
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Trash2}
          title="Nothing deleted"
          description="Books you delete will appear here, and can be restored."
        />
      ) : (
        <>
          <ul className="space-y-3">
            {rows.map((b) => (
              <li
                key={b.slug}
                className="surface-card flex flex-wrap items-start justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-[color:var(--text-1)]">
                    {b.title}
                  </p>
                  <p className="mt-0.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                    Class {b.classId} · {b.subject} · {b.medium} ·{" "}
                    {formatPrice(b.price)}
                  </p>
                  <p className="text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                    Deleted {new Date(b.deletedAt).toLocaleString("en-IN")}
                    {b.deletedBy ? ` by ${b.deletedBy}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === b.slug}
                  onClick={() => void restore(b.slug)}
                >
                  <Undo2 className="mr-2 size-4" />
                  Restore
                </Button>
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
              noun="book"
            />
          </div>
        </>
      )}
    </>
  );
}
