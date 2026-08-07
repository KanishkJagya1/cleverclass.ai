"use client";

/**
 * One ticket: the thread, and the box to answer it in.
 *
 * The internal-note toggle is the load-bearing control here. An internal note
 * and a reply to the customer go through the same endpoint distinguished by
 * one boolean, so the UI has to make the current mode unmissable — a staff
 * remark accidentally sent to a customer cannot be recalled.
 */

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Lock, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminAuth, useAdminData } from "@/features/admin/auth-context";
import { adminFetch, AdminApiError } from "@/features/admin/api";

interface Message {
  authorKind: string;
  authorName: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

interface TicketDetail {
  ticket: {
    reference: string;
    subject: string;
    status: string;
    statusLabel?: string;
    priority: string;
    category: string;
    email: string;
    name: string;
    phone?: string;
    created_at?: string;
    createdAt?: string;
  };
  messages: Message[];
}

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "pending_customer", label: "Waiting on customer" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const PRIORITIES = ["low", "normal", "high", "urgent"];

export default function AdminTicketPage() {
  const params = useParams<{ reference: string }>();
  const reference = decodeURIComponent(String(params?.reference ?? ""));
  const { csrf } = useAdminAuth();

  const { data, error, loading, reload } = useAdminData<TicketDetail>(
    reference ? `/support/${encodeURIComponent(reference)}` : null,
    [reference],
  );

  const [body, setBody] = React.useState("");
  const [internal, setInternal] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      await adminFetch(`/support/${encodeURIComponent(reference)}/reply`, {
        method: "POST",
        body: { body, isInternal: internal },
        csrf,
      });
      setBody("");
      setNotice(internal ? "Internal note added." : "Reply sent.");
      reload();
    } catch (err) {
      setNotice(
        err instanceof AdminApiError || err instanceof Error
          ? err.message
          : "Couldn't send that",
      );
    } finally {
      setBusy(false);
    }
  }

  async function patch(fields: Record<string, string>, label: string) {
    setBusy(true);
    setNotice(null);
    try {
      await adminFetch(`/support/${encodeURIComponent(reference)}/update`, {
        method: "POST",
        body: fields,
        csrf,
      });
      setNotice(label);
      reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't update that");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <ErrorState
        title="Couldn't load that ticket"
        description={error}
        onRetry={reload}
        showPhone={false}
      />
    );
  }

  if (loading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-64 rounded-[var(--radius-md)]" />
        <Skeleton className="h-64 w-full rounded-[var(--radius-md)]" />
      </div>
    );
  }

  const { ticket, messages } = data;

  return (
    <>
      <Link
        href="/admin/support"
        className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
      >
        <ArrowLeft className="size-4" />
        Support queue
      </Link>

      <AdminPageHeader
        title={ticket.subject}
        description={`${ticket.name || "Customer"} · ${ticket.email}${ticket.phone ? ` · ${ticket.phone}` : ""}`}
      />

      {notice ? (
        <p
          className="mb-4 rounded-[var(--radius-md)] border border-[var(--border-1)] p-3 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-[length:var(--text-sm)]">
          <span className="sr-only">Status</span>
          <select
            value={ticket.status}
            disabled={busy}
            onChange={(e) =>
              void patch(
                { status: e.target.value },
                `Marked ${e.target.value.replace("_", " ")}.`,
              )
            }
            aria-label="Ticket status"
            className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--border-1)]
                       bg-[var(--surface-1)] px-3 text-[color:var(--text-1)]"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[length:var(--text-sm)]">
          <span className="sr-only">Priority</span>
          <select
            value={ticket.priority}
            disabled={busy}
            onChange={(e) =>
              void patch(
                { priority: e.target.value },
                `Priority set to ${e.target.value}.`,
              )
            }
            aria-label="Priority"
            className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--border-1)]
                       bg-[var(--surface-1)] px-3 capitalize text-[color:var(--text-1)]"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <span className="rounded-full bg-[var(--surface-0)] px-2 py-1 text-[length:var(--text-xs)] capitalize text-[color:var(--text-2)]">
          {ticket.category}
        </span>
      </div>

      <ul className="space-y-3">
        {messages.map((m, i) => (
          <li
            key={`${m.createdAt}-${i}`}
            className={
              m.isInternal
                ? "rounded-[var(--radius-md)] border border-amber-500/40 bg-amber-500/5 p-3"
                : m.authorKind === "staff"
                  ? "rounded-[var(--radius-md)] border border-[var(--border-1)] bg-[var(--surface-1)] p-3"
                  : "rounded-[var(--radius-md)] bg-[var(--surface-0)] p-3"
            }
          >
            <p className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
              {m.isInternal ? (
                <>
                  <Lock className="size-3" aria-hidden />
                  Internal note ·{" "}
                </>
              ) : null}
              {m.authorKind === "staff" ? m.authorName || "Staff" : "Customer"} ·{" "}
              {new Date(m.createdAt).toLocaleString("en-IN")}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[length:var(--text-sm)] text-[color:var(--text-1)]">
              {m.body}
            </p>
          </li>
        ))}
      </ul>

      <form onSubmit={send} className="surface-card mt-5 p-4">
        <label
          htmlFor="reply"
          className="block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]"
        >
          {internal ? "Internal note" : "Reply to the customer"}
        </label>
        <textarea
          id="reply"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          maxLength={8000}
          placeholder={
            internal
              ? "Only staff will see this."
              : "This goes to the customer."
          }
          className={
            internal
              ? "mt-2 w-full rounded-[var(--radius-sm)] border border-amber-500/50 bg-amber-500/5 p-3 text-[color:var(--text-1)]"
              : "mt-2 w-full rounded-[var(--radius-sm)] border border-[var(--border-1)] bg-[var(--surface-1)] p-3 text-[color:var(--text-1)]"
          }
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex min-h-11 items-center gap-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            <input
              type="checkbox"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
            />
            Internal note — the customer will not see it
          </label>
          <Button type="submit" disabled={busy || !body.trim()}>
            {internal ? (
              <Lock className="mr-2 size-4" />
            ) : (
              <Send className="mr-2 size-4" />
            )}
            {busy ? "Sending…" : internal ? "Add note" : "Send reply"}
          </Button>
        </div>
      </form>
    </>
  );
}
