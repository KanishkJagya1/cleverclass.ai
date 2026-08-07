"use client";

/**
 * E-books this account has bought.
 *
 * Every copy is watermarked with the buyer's name, email and order number on
 * every page — said plainly on this screen rather than discovered in the file,
 * because a customer who does not know their copy is marked is more likely to
 * share it, which is the outcome the watermark exists to prevent.
 */

import * as React from "react";
import Link from "next/link";
import { BookOpen, Download, FileText } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";

interface Entitlement {
  orderNumber: string;
  slug: string;
  title: string;
  purchasedAt: string;
  downloads: number;
  maxDownloads: number;
  downloadsLeft: number;
  ready: boolean;
}

export default function DownloadsPage() {
  const [items, setItems] = React.useState<Entitlement[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/downloads", {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (res) => {
        if (res.status === 401) throw new Error("signed-out");
        if (!res.ok) throw new Error("Couldn't load your downloads");
        return res.json();
      })
      .then((data: { downloads: Entitlement[] }) => {
        if (!cancelled) setItems(data.downloads ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="text-[length:var(--text-3xl)]">Downloads</h1>
      <p className="mt-2 text-[length:var(--text-body)] text-[color:var(--text-2)]">
        E-books you have bought. Each copy is marked with your name and order
        number on every page.
      </p>

      {error === "signed-out" ? (
        <div className="mt-8">
          <EmptyState
            icon={FileText}
            title="Sign in to see your downloads"
            description="Your e-books are tied to your account."
            action={{ label: "Sign in", href: "/login" }}
          />
        </div>
      ) : error ? (
        <p className="mt-6 rounded-[var(--radius-md)] border border-[var(--border-1)] p-4 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          {error}
        </p>
      ) : items === null ? (
        <p className="mt-6 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          Loading…
        </p>
      ) : items.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={FileText}
            title="No e-books yet"
            description="Books you buy as a download will appear here."
            action={{ label: "Browse books", href: "/shop" }}
          />
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {items.map((e) => (
            <li
              key={`${e.orderNumber}-${e.slug}`}
              className="surface-card flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="font-medium text-[color:var(--text-1)]">
                  {e.title}
                </p>
                <p className="mt-0.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                  <span className="tabular">{e.orderNumber}</span> ·{" "}
                  {new Date(e.purchasedAt).toLocaleDateString("en-IN")}
                </p>
                <p className="text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                  {e.downloadsLeft} of {e.maxDownloads} downloads left
                </p>
              </div>

              {e.ready ? (
                e.downloadsLeft > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {/* Reading online is offered first: it needs no download
                        limit and the pages never leave as a file. */}
                    <Link
                      href={`/account/read/${encodeURIComponent(e.orderNumber)}/${encodeURIComponent(e.slug)}`}
                      className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--brand)] px-4 font-medium text-white"
                    >
                      <BookOpen className="size-4" aria-hidden />
                      Read online
                    </Link>
                    <a
                      href={`/api/auth/downloads/${encodeURIComponent(e.orderNumber)}/${encodeURIComponent(e.slug)}`}
                      className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-1)] px-4 font-medium text-[color:var(--text-1)]"
                    >
                      <Download className="size-4" aria-hidden />
                      Download
                    </a>
                  </div>
                ) : (
                  // Stated rather than shown as a dead button — a customer who
                  // has run out needs to know to contact us, not to keep
                  // clicking.
                  <p className="text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                    Limit reached — contact us and we&apos;ll help.
                  </p>
                )
              ) : (
                <p className="text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                  Being prepared — we&apos;ll email you.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
