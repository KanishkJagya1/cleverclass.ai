"use client";

/**
 * Low stock, and adjusting it.
 *
 * Every adjustment carries a REASON, and the reason is required rather than
 * free text with a default. `stock_movements` is the audit trail that explains
 * why a count changed; "someone typed 40" six months later is not an answer to
 * "where did twelve copies go".
 */

import * as React from "react";
import Link from "next/link";
import { PackageCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminAuth } from "@/features/admin/auth-context";
import { adminFetch, AdminApiError } from "@/features/admin/api";
import { Pagination, usePaginatedAdminData } from "@/features/admin/pagination";

interface LowStockRow {
  slug: string;
  title: string;
  quantity: number | null;
  threshold: number | null;
}

// Mirrors inventory.REASONS. A received delivery and a damaged copy both change
// the number; only the reason distinguishes them afterwards.
const REASONS = [
  { value: "received", label: "Stock received" },
  { value: "recount", label: "Recount / stocktake" },
  { value: "damaged", label: "Damaged" },
  { value: "returned", label: "Returned to shelf" },
  { value: "correction", label: "Correction" },
  { value: "opening", label: "Opening balance" },
];

export default function AdminStockPage() {
  const { csrf } = useAdminAuth();
  const { data, error, loading, reload, page, setPage } =
    usePaginatedAdminData<LowStockRow>("/stock/low", {}, 10);

  const [open, setOpen] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  if (error) {
    return (
      <ErrorState
        title="Couldn't load stock"
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
        title="Stock"
        description="Books at or below their reorder point."
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
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={PackageCheck}
          title="Nothing is running low"
          description="Books below their threshold appear here."
        />
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map((b) => (
              <li key={b.slug} className="surface-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/books/${b.slug}`}
                      className="font-medium text-[color:var(--text-brand)]"
                    >
                      {b.title}
                    </Link>
                    <p className="text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                      <span
                        className={
                          (b.quantity ?? 0) <= 0
                            ? "font-semibold text-[color:var(--signal-danger)]"
                            : "font-semibold text-amber-700"
                        }
                      >
                        {b.quantity ?? 0} left
                      </span>
                      {b.threshold != null ? ` · reorder at ${b.threshold}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setOpen(open === b.slug ? null : b.slug)}
                  >
                    {open === b.slug ? "Cancel" : "Adjust"}
                  </Button>
                </div>

                {open === b.slug ? (
                  <AdjustForm
                    slug={b.slug}
                    csrf={csrf}
                    onDone={(msg) => {
                      setOpen(null);
                      setNotice(msg);
                      reload();
                    }}
                  />
                ) : null}
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
              noun="book"
            />
          </div>
        </>
      )}
    </>
  );
}

function AdjustForm({
  slug,
  csrf,
  onDone,
}: {
  slug: string;
  csrf: string | undefined;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const delta = Number(form.get("delta"));
    if (!delta) {
      setError("Enter how many copies to add or remove.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminFetch(`/books/${encodeURIComponent(slug)}/stock`, {
        method: "POST",
        body: {
          delta,
          reason: String(form.get("reason")),
          note: String(form.get("note") ?? ""),
        },
        csrf,
      });
      onDone(
        `${delta > 0 ? "Added" : "Removed"} ${Math.abs(delta)} for ${slug}.`,
      );
    } catch (err) {
      setError(
        err instanceof AdminApiError || err instanceof Error
          ? err.message
          : "Couldn't adjust that",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-3 space-y-2 border-t border-[var(--border-1)] pt-3"
    >
      {error ? (
        <p className="text-[length:var(--text-sm)] text-destructive">{error}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <label className="flex-1">
          <span className="sr-only">Change</span>
          <Input
            name="delta"
            type="number"
            placeholder="e.g. 20 or -3"
            aria-label="Change in copies"
          />
        </label>
        <select
          name="reason"
          aria-label="Reason"
          defaultValue="received"
          className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--border-1)]
                     bg-[var(--surface-1)] px-3 text-[color:var(--text-1)]"
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <Input name="note" placeholder="Note (optional)" aria-label="Note" />
      <p className="text-[length:var(--text-xs)] text-[color:var(--text-3)]">
        Positive adds, negative removes. Every change is recorded against your
        account.
      </p>
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? "Saving…" : "Apply"}
      </Button>
    </form>
  );
}
