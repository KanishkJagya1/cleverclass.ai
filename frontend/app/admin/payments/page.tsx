"use client";

/**
 * Payment verification queue.
 *
 * Customers pay by UPI and submit the reference number; nobody uploads a
 * screenshot, so this screen verifies against the reference and the amount
 * rather than an image. (`hasProof` exists in the API and is always false —
 * no route sets it. Do not build a viewer for it without adding the upload.)
 *
 * The amount mismatch is deliberately the loudest thing on each row. Someone
 * paying ₹250 for a ₹1,250 order is the case this queue exists to catch, and
 * it is easy to miss when every row otherwise looks identical.
 */

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, IndianRupee } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminAuth } from "@/features/admin/auth-context";
import { adminFetch, AdminApiError } from "@/features/admin/api";
import { Pagination, usePaginatedAdminData } from "@/features/admin/pagination";
import { formatPrice } from "@/lib/utils";

interface PaymentRow {
  orderNumber: string;
  customerName: string;
  amount: number;
  orderTotal: number;
  matchesTotal: boolean;
  method: string;
  reference: string | null;
  customerNote: string | null;
  submittedAt: string;
}

export default function AdminPaymentsPage() {
  const { csrf } = useAdminAuth();
  const { data, error, loading, reload, page, setPage } =
    usePaginatedAdminData<PaymentRow>("/payments/queue", {}, 10);

  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function decide(
    orderNumber: string,
    decision: "approved" | "rejected" | "correction_requested",
    advanceOrder: boolean,
  ) {
    setBusy(orderNumber);
    setNotice(null);
    try {
      const res = await adminFetch<{ orderStatus: string | null }>(
        `/payments/${encodeURIComponent(orderNumber)}/review`,
        { method: "POST", body: { decision, advanceOrder }, csrf },
      );
      // The order move is reported separately because approving a payment can
      // succeed while the order fails to advance — out of stock, for one — and
      // silently calling that "approved" would hide a real problem.
      setNotice(
        res.orderStatus
          ? `${orderNumber}: payment ${decision.replace("_", " ")}, order now ${res.orderStatus}.`
          : `${orderNumber}: payment ${decision.replace("_", " ")}.`,
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
        title="Couldn't load the payment queue"
        description={error}
        onRetry={reload}
        showPhone={false}
      />
    );
  }

  const rows = data?.items ?? [];
  const mismatches = rows.filter((p) => !p.matchesTotal).length;

  return (
    <>
      <AdminPageHeader
        title="Payments"
        description="Payments customers say they have made, waiting to be checked."
      />

      {notice ? (
        <p
          className="mb-4 rounded-[var(--radius-md)] border border-[var(--border-1)] p-3 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      {mismatches > 0 ? (
        <p className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-destructive/40 bg-destructive/10 p-3 text-[length:var(--text-sm)]">
          <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
          {mismatches} on this page {mismatches === 1 ? "does" : "do"} not match
          the order total.
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={IndianRupee}
          title="Nothing to verify"
          description="Payments submitted by customers appear here."
        />
      ) : (
        <>
          <ul className="space-y-3">
            {rows.map((p) => (
              <li key={p.orderNumber} className="surface-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/orders/${encodeURIComponent(p.orderNumber)}`}
                      className="tabular font-medium text-[color:var(--text-brand)]"
                    >
                      {p.orderNumber}
                    </Link>
                    <p className="mt-0.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                      {p.customerName} · {p.method}
                      {p.reference ? (
                        <>
                          {" · ref "}
                          <span className="tabular">{p.reference}</span>
                        </>
                      ) : null}
                    </p>
                    <p className="text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                      Submitted {new Date(p.submittedAt).toLocaleString("en-IN")}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="tabular text-lg font-semibold text-[color:var(--text-1)]">
                      {formatPrice(p.amount)}
                    </p>
                    {p.matchesTotal ? (
                      <p className="text-[length:var(--text-xs)] text-emerald-600">
                        Matches the order
                      </p>
                    ) : (
                      <p className="text-[length:var(--text-xs)] font-medium text-destructive">
                        Order is {formatPrice(p.orderTotal)}
                      </p>
                    )}
                  </div>
                </div>

                {p.customerNote ? (
                  <p className="mt-2 whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--surface-0)] p-2.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                    {p.customerNote}
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border-1)] pt-3">
                  <Button
                    size="sm"
                    disabled={busy === p.orderNumber}
                    onClick={() => void decide(p.orderNumber, "approved", true)}
                  >
                    Approve &amp; confirm order
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === p.orderNumber}
                    onClick={() => void decide(p.orderNumber, "approved", false)}
                  >
                    Approve only
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === p.orderNumber}
                    onClick={() =>
                      void decide(p.orderNumber, "correction_requested", false)
                    }
                  >
                    Ask for correction
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy === p.orderNumber}
                    onClick={() => void decide(p.orderNumber, "rejected", false)}
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
              noun="payment"
            />
          </div>
        </>
      )}
    </>
  );
}
