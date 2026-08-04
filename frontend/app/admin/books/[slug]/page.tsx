"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Skeleton } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { BookForm } from "@/features/admin/book-form";
import { PdfUpload, type PdfStatus } from "@/features/admin/pdf-upload";
import { FreeRangesEditor, type FreeRangesState } from "@/features/admin/free-ranges";
import { useAdminData } from "@/features/admin/auth-context";
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
    </>
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
