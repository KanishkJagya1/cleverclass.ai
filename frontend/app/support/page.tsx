"use client";

/**
 * Technical support request.
 *
 * Separate from /contact, which is a general enquiry form that creates a lead.
 * This creates a real ticket with a reference the customer can come back to,
 * and emails the team — a support request that vanishes into an inbox with no
 * way to check on it is the thing people complain about most.
 */

import * as React from "react";
import Link from "next/link";
import { LifeBuoy } from "lucide-react";

const CATEGORIES = [
  { value: "technical", label: "Something is broken (download, login, PDF)" },
  { value: "order", label: "A problem with my order" },
  { value: "delivery", label: "Delivery or tracking" },
  { value: "payment", label: "Payment or refund" },
  { value: "product", label: "A question about a book" },
  { value: "general", label: "Something else" },
] as const;

interface Created {
  reference: string;
}

export default function SupportPage() {
  const [sent, setSent] = React.useState<Created | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          name: form.get("name"),
          phone: form.get("phone"),
          subject: form.get("subject"),
          body: form.get("body"),
          category: form.get("category"),
          orderNumber: form.get("orderNumber") || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ?? "Couldn't send that");
      setSent(data as Created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <div className="surface-card p-6 text-center">
          <LifeBuoy className="mx-auto size-10 text-[color:var(--text-brand)]" />
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-semibold text-[color:var(--text-1)]">
            We have your message
          </h1>
          <p className="mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            Your reference is{" "}
            <strong className="tabular">{sent.reference}</strong>. We have
            emailed it to you as well.
          </p>
          <Link
            href={`/support/${sent.reference}`}
            className="mt-4 inline-flex min-h-11 items-center text-[length:var(--text-sm)] font-medium text-[color:var(--text-brand)]"
          >
            Track this request
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-semibold text-[color:var(--text-1)]">
        Technical support
      </h1>
      <p className="mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
        Tell us what went wrong and we&apos;ll get back to you. You&apos;ll get
        a reference number so you can check on it.
      </p>

      {error ? (
        <p className="mt-4 rounded-[var(--radius-md)] border border-destructive/40 bg-destructive/10 p-3 text-[length:var(--text-sm)]">
          {error}
        </p>
      ) : null}

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="What kind of problem?" htmlFor="category">
          <select
            id="category"
            name="category"
            defaultValue="technical"
            className="min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--border-1)]
                       bg-[var(--surface-1)] px-3 text-[color:var(--text-1)]"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Your name" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" />
        </Field>

        <Field label="Email" htmlFor="email" required>
          {/* Required because it is the only way we can reply — the phone
              number is optional precisely because it often is not answered. */}
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </Field>

        <Field label="Phone (optional)" htmlFor="phone">
          <Input id="phone" name="phone" type="tel" autoComplete="tel" />
        </Field>

        <Field label="Order number (if it's about an order)" htmlFor="orderNumber">
          <Input id="orderNumber" name="orderNumber" placeholder="CC-XXXXXX" />
        </Field>

        <Field label="Subject" htmlFor="subject" required>
          <Input id="subject" name="subject" required minLength={3} maxLength={300} />
        </Field>

        <Field label="What happened?" htmlFor="body" required>
          <textarea
            id="body"
            name="body"
            required
            minLength={5}
            maxLength={8000}
            rows={6}
            placeholder="What you were doing, what you expected, and what happened instead."
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border-1)]
                       bg-[var(--surface-1)] p-3 text-[color:var(--text-1)]"
          />
        </Field>

        <button
          type="submit"
          disabled={busy}
          className="min-h-11 w-full rounded-[var(--radius-sm)] bg-[var(--brand)]
                     px-5 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send request"}
        </button>
      </form>
    </main>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]"
      >
        {label}
        {required ? (
          <span className="text-[color:var(--text-brand)]"> *</span>
        ) : null}
      </label>
      {children}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--border-1)]
                 bg-[var(--surface-1)] px-3 text-[color:var(--text-1)]"
    />
  );
}
