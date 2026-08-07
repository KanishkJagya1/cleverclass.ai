"use client";

/**
 * Review moderation.
 *
 * Everything here is unpublished — approving puts a stranger's words on a
 * product page, so the full text is shown rather than a truncated preview. A
 * moderation queue that hides half the review is a queue that approves things
 * nobody read.
 */

import * as React from "react";
import Link from "next/link";
import { MessageSquare, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminAuth } from "@/features/admin/auth-context";
import { adminFetch, AdminApiError } from "@/features/admin/api";
import { Pagination, usePaginatedAdminData } from "@/features/admin/pagination";

interface Review {
  id: string;
  productSlug: string;
  author: string;
  rating: number;
  title: string;
  body: string;
  verified: boolean;
  source: string;
  createdAt: string;
}

export default function AdminReviewsPage() {
  const { csrf } = useAdminAuth();
  const { data, error, loading, reload, page, setPage } =
    usePaginatedAdminData<Review>("/reviews/pending", {}, 10);

  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [replies, setReplies] = React.useState<Record<string, string>>({});

  async function moderate(id: string, decision: "published" | "rejected") {
    setBusy(id);
    setNotice(null);
    try {
      await adminFetch(`/reviews/${encodeURIComponent(id)}/moderate`, {
        method: "POST",
        body: { decision, reply: replies[id] ?? "" },
        csrf,
      });
      setNotice(
        decision === "published"
          ? "Published — it is live on the product page now."
          : "Rejected. It stays on record but is never shown.",
      );
      reload();
    } catch (err) {
      setNotice(
        err instanceof AdminApiError || err instanceof Error
          ? err.message
          : "That didn't work",
      );
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <ErrorState
        title="Couldn't load reviews"
        description={error}
        onRetry={reload}
        showPhone={false}
      />
    );
  }

  const rows = data?.items ?? [];

  return (
    <>
      <AdminPageHeader
        title="Reviews"
        description="Waiting for approval. Nothing here is visible on the site yet."
      />

      {notice ? (
        <p
          className="mb-4 rounded-[var(--radius-md)] border border-[var(--border-1)] p-3 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Nothing to moderate"
          description="New reviews appear here before they go live."
        />
      ) : (
        <>
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="surface-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Stars rating={r.rating} />
                      <span className="text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                        {r.title || "(no title)"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                      {r.author || "Anonymous"} ·{" "}
                      <Link
                        href={`/shop/${r.productSlug}`}
                        className="text-[color:var(--text-brand)]"
                      >
                        {r.productSlug}
                      </Link>
                      {" · "}
                      {new Date(r.createdAt).toLocaleDateString("en-IN")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {/* Provenance matters when deciding whether to trust it. */}
                    {r.verified ? (
                      <Badge tone="good">Verified buyer</Badge>
                    ) : (
                      <Badge tone="warn">Unverified</Badge>
                    )}
                    <Badge tone="neutral">{r.source}</Badge>
                  </div>
                </div>

                {/* In full, never truncated — see the note at the top. */}
                <p className="mt-3 whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--surface-0)] p-3 text-[length:var(--text-sm)] text-[color:var(--text-1)]">
                  {r.body}
                </p>

                <label className="mt-3 block">
                  <span className="text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                    Public reply (optional)
                  </span>
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={replies[r.id] ?? ""}
                    onChange={(e) =>
                      setReplies((p) => ({ ...p, [r.id]: e.target.value }))
                    }
                    placeholder="Shown under the review on the product page."
                    className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-1)]
                               bg-[var(--surface-1)] p-2.5 text-[length:var(--text-sm)]
                               text-[color:var(--text-1)]"
                  />
                </label>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy === r.id}
                    onClick={() => void moderate(r.id, "published")}
                  >
                    Publish
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy === r.id}
                    onClick={() => void moderate(r.id, "rejected")}
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4">
            <Pagination
              page={page}
              totalPages={data?.totalPages ?? 0}
              total={data?.total ?? 0}
              perPage={data?.perPage ?? 10}
              onPage={setPage}
              noun="review"
            />
          </div>
        </>
      )}
    </>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={
            i < rating
              ? "size-3.5 fill-amber-400 text-amber-400"
              : "size-3.5 text-[color:var(--text-3)]"
          }
          aria-hidden
        />
      ))}
    </span>
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
