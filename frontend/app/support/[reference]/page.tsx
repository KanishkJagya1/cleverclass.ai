"use client";

/**
 * Track a support request.
 *
 * Reachable with only the reference — no account needed. That is deliberate:
 * most people who need support have not signed in, and putting a login in
 * front of "what happened to my message" is how a support system stops being
 * used. The reference is unguessable, and this view never exposes internal
 * staff notes (the backend excludes them by default, not by a flag set here).
 */

import * as React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface Message {
  authorKind: string;
  authorName: string;
  body: string;
  createdAt: string;
}

interface TicketView {
  ticket: {
    reference: string;
    subject: string;
    status: string;
    statusLabel?: string;
    category: string;
    createdAt: string;
  };
  messages: Message[];
}

export default function TrackTicketPage() {
  const params = useParams<{ reference: string }>();
  const reference = String(params?.reference ?? "");

  const [data, setData] = React.useState<TicketView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [reply, setReply] = React.useState("");
  const [sending, setSending] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/support/${encodeURIComponent(reference)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail ?? "We could not find that reference.");
      setData(body as TicketView);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [reference]);

  React.useEffect(() => {
    if (reference) void load();
  }, [reference, load]);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      const res = await fetch(
        `/api/ai/support/${encodeURIComponent(reference)}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: reply }),
        },
      );
      if (!res.ok) {
        const b = await res.json();
        throw new Error(b?.detail ?? "Couldn't send that");
      }
      setReply("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <Link
        href="/support"
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
      >
        <ArrowLeft className="size-4" />
        New request
      </Link>

      {loading ? (
        <p className="text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          Loading…
        </p>
      ) : error ? (
        <div className="surface-card p-6">
          <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
            {error}
          </h1>
          <p className="mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            Check the reference from your email, or{" "}
            <Link href="/support" className="text-[color:var(--text-brand)]">
              send a new request
            </Link>
            .
          </p>
        </div>
      ) : data ? (
        <>
          <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-semibold text-[color:var(--text-1)]">
            {data.ticket.subject}
          </h1>
          <p className="mt-1 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            <span className="tabular">{data.ticket.reference}</span> ·{" "}
            {data.ticket.statusLabel ?? data.ticket.status} ·{" "}
            {new Date(data.ticket.createdAt).toLocaleDateString("en-IN")}
          </p>

          <ul className="mt-6 space-y-3">
            {data.messages.map((m, i) => (
              <li
                key={`${m.createdAt}-${i}`}
                className={
                  m.authorKind === "staff"
                    ? "rounded-[var(--radius-md)] border border-[var(--border-1)] bg-[var(--surface-1)] p-3"
                    : "rounded-[var(--radius-md)] bg-[var(--surface-0)] p-3"
                }
              >
                <p className="text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                  {m.authorKind === "staff" ? m.authorName || "CleverClass" : "You"}{" "}
                  · {new Date(m.createdAt).toLocaleString("en-IN")}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[length:var(--text-sm)] text-[color:var(--text-1)]">
                  {m.body}
                </p>
              </li>
            ))}
          </ul>

          <form onSubmit={sendReply} className="mt-6 space-y-2">
            <label
              htmlFor="reply"
              className="block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]"
            >
              Add to this request
            </label>
            <textarea
              id="reply"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={4}
              maxLength={8000}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border-1)]
                         bg-[var(--surface-1)] p-3 text-[color:var(--text-1)]"
            />
            <button
              type="submit"
              disabled={sending || !reply.trim()}
              className="min-h-11 rounded-[var(--radius-sm)] bg-[var(--brand)] px-5
                         font-medium text-white disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </form>
        </>
      ) : null}
    </main>
  );
}
