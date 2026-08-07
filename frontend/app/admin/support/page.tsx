"use client";

/**
 * Support queue.
 *
 * This screen existed as an API and nothing else: the customer-facing form and
 * the "new ticket" emails shipped without anywhere for staff to answer, so
 * tickets arrived, notified someone, and sat.
 *
 * The queue leads with "waiting for first reply" because that is the number a
 * support desk is actually judged on — a ticket nobody has acknowledged is a
 * different problem from one that is simply still open.
 */

import * as React from "react";
import Link from "next/link";
import { AlertCircle, LifeBuoy } from "lucide-react";

import { Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { Pagination, usePaginatedAdminData } from "@/features/admin/pagination";

interface Ticket {
  reference: string;
  subject: string;
  category: string;
  status: string;
  statusLabel: string;
  priority: string;
  email: string;
  name: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  awaitingFirstReply: boolean;
}

const STATUSES = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "pending_customer", label: "Waiting on customer" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

export default function AdminSupportPage() {
  const [status, setStatus] = React.useState("open");
  const { data, error, loading, reload, page, setPage } =
    usePaginatedAdminData<Ticket>("/support/queue", { status }, 10);

  if (error) {
    return (
      <ErrorState
        title="Couldn't load the support queue"
        description={error}
        onRetry={reload}
        showPhone={false}
      />
    );
  }

  const rows = data?.items ?? [];
  const unanswered = rows.filter((t) => t.awaitingFirstReply).length;

  return (
    <>
      <AdminPageHeader
        title="Support"
        description="Questions and problems customers have sent in."
      />

      {unanswered > 0 ? (
        <p className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-amber-500/40 bg-amber-500/10 p-3 text-[length:var(--text-sm)]">
          <AlertCircle className="size-4 shrink-0 text-amber-700" aria-hidden />
          {unanswered} on this page {unanswered === 1 ? "has" : "have"} had no
          reply yet.
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setStatus(s.value)}
            className={
              status === s.value
                ? "min-h-11 rounded-[var(--radius-sm)] bg-[var(--brand)] px-4 text-[length:var(--text-sm)] font-medium text-white"
                : "min-h-11 rounded-[var(--radius-sm)] border border-[var(--border-1)] px-4 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={LifeBuoy}
          title="Nothing here"
          description={
            status === "open"
              ? "No open tickets — everything has been dealt with."
              : "No tickets with that status."
          }
        />
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map((t) => (
              <li key={t.reference}>
                <Link
                  href={`/admin/support/${encodeURIComponent(t.reference)}`}
                  className="surface-card block p-4 transition-colors hover:border-[var(--border-2)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[color:var(--text-1)]">
                        {t.subject}
                      </p>
                      <p className="mt-0.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                        {t.name || t.email} ·{" "}
                        <span className="tabular">{t.reference}</span> ·{" "}
                        {t.messageCount} message{t.messageCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {t.awaitingFirstReply ? (
                        <Badge tone="warn">No reply yet</Badge>
                      ) : null}
                      {t.priority !== "normal" ? (
                        <Badge tone={t.priority === "urgent" ? "bad" : "warn"}>
                          {t.priority}
                        </Badge>
                      ) : null}
                      <Badge tone="neutral">{t.category}</Badge>
                      <Badge tone="neutral">{t.statusLabel}</Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                    Opened {new Date(t.createdAt).toLocaleString("en-IN")}
                  </p>
                </Link>
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
              noun="ticket"
            />
          </div>
        </>
      )}
    </>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "neutral" | "warn" | "bad";
}) {
  const tones = {
    neutral: "bg-[var(--surface-0)] text-[color:var(--text-2)]",
    warn: "bg-amber-500/10 text-amber-700",
    bad: "bg-destructive/10 text-destructive",
  } as const;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[length:var(--text-2xs)] font-medium capitalize ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
