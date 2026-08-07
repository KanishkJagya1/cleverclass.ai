"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { BookForm } from "@/features/admin/book-form";
import { CoverUpload } from "@/features/admin/cover-upload";
import { PdfUpload, type PdfStatus } from "@/features/admin/pdf-upload";
import { FreeRangesEditor, type FreeRangesState } from "@/features/admin/free-ranges";
import { useAdminAuth, useAdminData } from "@/features/admin/auth-context";
import { adminFetch, AdminApiError } from "@/features/admin/api";
import { Button } from "@/components/ui/button";
import type { AdminBook } from "@/features/admin/api";

export default function EditBookPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const { data, error, loading, reload } = useAdminData<AdminBook>(
    slug ? `/books/${slug}` : null,
    [slug],
  );

  if (error) {
    return (
      <ErrorState
        title="Couldn't load this book"
        description={error}
        onRetry={reload}
        showPhone={false}
      />
    );
  }

  if (loading || !data) {
    return (
      <>
        <AdminPageHeader title="Edit book" />
        <div className="grid gap-5 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-[var(--radius-lg)]" />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <AdminPageHeader
        title={data.title}
        description={`Last updated ${new Date(data.updatedAt).toLocaleString("en-IN")}`}
      />

      <div className="mb-6">
        <CoverUpload slug={data.slug} initialSrc={data.cover} />
      </div>

      {/* The free sample comes first: a book without one shows no preview CTA
          and gives the assistant nothing to point at, so it is the thing most
          likely to be missing. */}
      <FreeSampleSection slug={data.slug} />

      <h2 className="mb-3 mt-8 font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
        Book details
      </h2>
      {/* keyed on slug so switching books resets the form rather than merging
          the previous book's values into the new one */}
      <BookForm key={data.slug} book={data} />

      <DangerZone slug={data.slug} title={data.title} />
    </>
  );
}

/**
 * Deleting a book.
 *
 * Two-step, because the button is next to a form people edit all day. And
 * honest about what it does: nothing is destroyed, so the confirmation says
 * that rather than the usual "this cannot be undone" — which would be a lie
 * here, and the kind of lie that makes people distrust the real warnings.
 */
function DangerZone({ slug, title }: { slug: string; title: string }) {
  const router = useRouter();
  const { csrf } = useAdminAuth();
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await adminFetch(`/books/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        csrf,
      });
      router.push("/admin/books");
    } catch (err) {
      setError(
        err instanceof AdminApiError || err instanceof Error
          ? err.message
          : "Couldn't delete that book",
      );
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 rounded-[var(--radius-lg)] border border-destructive/30 p-4">
      <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
        Delete this book
      </h2>
      <p className="mt-1 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
        It disappears from the shop and search. Existing orders and invoices
        keep working, and you can restore it from{" "}
        <Link
          href="/admin/books/deleted"
          className="text-[color:var(--text-brand)]"
        >
          deleted books
        </Link>
        .
      </p>

      {error ? (
        <p className="mt-2 text-[length:var(--text-sm)] text-destructive">{error}</p>
      ) : null}

      {confirming ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[length:var(--text-sm)] text-[color:var(--text-1)]">
            Delete “{title}”?
          </span>
          <Button size="sm" variant="danger" disabled={busy} onClick={remove}>
            Yes, delete
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          onClick={() => setConfirming(true)}
        >
          Delete book
        </Button>
      )}
    </section>
  );
}

/**
 * Upload + range editor, sharing one PDF status.
 *
 * They are siblings rather than nested because they are two steps of one job:
 * the range editor is inert until the upload reports `ready`, and it has to
 * re-read the page count the moment it does.
 */
function FreeSampleSection({ slug }: { slug: string }) {
  const [status, setStatus] = React.useState<PdfStatus>({ state: "none" });
  const { data: ranges, loading, reload } = useAdminData<FreeRangesState>(
    `/books/${slug}/free-ranges`,
    [slug, status.state],
  );

  // Seed the upload widget from the server on first load.
  const { data: initialStatus } = useAdminData<PdfStatus>(`/books/${slug}/pdf-status`, [slug]);
  React.useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  return (
    <div className="space-y-5">
      <PdfUpload slug={slug} status={status} onStatusChange={setStatus} />

      {loading || !ranges ? (
        <Skeleton className="h-64 w-full rounded-[var(--radius-lg)]" />
      ) : (
        <FreeRangesEditor
          // Remount when the PDF changes: a new file means a new page count and
          // the previous ranges are meaningless against it.
          key={`${slug}:${status.assetId ?? "none"}:${ranges.pageCount}`}
          slug={slug}
          initial={ranges}
          onSaved={() => reload()}
        />
      )}
    </div>
  );
}
