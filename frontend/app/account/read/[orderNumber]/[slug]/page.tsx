"use client";

/**
 * The e-book reader.
 *
 * Pages arrive as images behind short-lived signed URLs; there is no route
 * that returns the whole file. Each image is stamped server-side with the
 * buyer's name, email and order number.
 *
 * The right-click and selection blocks below are honest about what they are:
 * friction for the casual, not protection. Anyone who opens devtools has the
 * image. The watermark is the part that actually deters sharing, because it
 * makes a leaked screenshot traceable — that is stated on screen rather than
 * hidden, since a reader who knows their copy is marked is far less likely to
 * pass it on.
 */

import * as React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, ShieldAlert } from "lucide-react";

interface PageToken {
  page: number;
  token: string;
}

interface Manifest {
  orderNumber: string;
  slug: string;
  title: string;
  pageCount: number;
  expiresAt: number;
  ttlSeconds: number;
  pages: PageToken[];
}

export default function ReaderPage() {
  const params = useParams<{ orderNumber: string; slug: string }>();
  const orderNumber = decodeURIComponent(String(params?.orderNumber ?? ""));
  const slug = decodeURIComponent(String(params?.slug ?? ""));

  const [manifest, setManifest] = React.useState<Manifest | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(
        `/api/auth/reader/${encodeURIComponent(orderNumber)}/${encodeURIComponent(slug)}/manifest`,
        { credentials: "same-origin", cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail ?? "Couldn't open this book");
      setManifest(body as Manifest);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [orderNumber, slug]);

  React.useEffect(() => {
    if (orderNumber && slug) void load();
  }, [orderNumber, slug, load]);

  // Tokens expire in minutes. Refresh before they do, so a reader left open
  // over a cup of tea does not break on the next page turn.
  React.useEffect(() => {
    if (!manifest) return;
    const ms = Math.max(30_000, (manifest.ttlSeconds - 45) * 1000);
    const timer = setInterval(() => void load(), ms);
    return () => clearInterval(timer);
  }, [manifest, load]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setPage((p) => Math.min(p + 1, manifest?.pageCount ?? p));
      if (e.key === "ArrowLeft") setPage((p) => Math.max(1, p - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [manifest?.pageCount]);

  if (error) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <ShieldAlert className="mx-auto size-10 text-[color:var(--text-3)]" />
        <h1 className="mt-3 text-[length:var(--text-xl)]">{error}</h1>
        <Link
          href="/account/downloads"
          className="mt-4 inline-flex min-h-11 items-center text-[color:var(--text-brand)]"
        >
          Back to your books
        </Link>
      </main>
    );
  }

  if (!manifest) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center text-[color:var(--text-2)]">
        Opening…
      </main>
    );
  }

  const current = manifest.pages.find((p) => p.page === page);
  const src = current
    ? `/api/auth/reader/${encodeURIComponent(orderNumber)}/${encodeURIComponent(slug)}/page/${page}.webp?t=${encodeURIComponent(current.token)}`
    : "";

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/account/downloads"
          className="inline-flex min-h-11 items-center gap-1.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
        >
          <ArrowLeft className="size-4" />
          Your books
        </Link>
        <h1 className="text-[length:var(--text-base)] font-medium text-[color:var(--text-1)]">
          {manifest.title}
        </h1>
        <span className="tabular text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          {page} / {manifest.pageCount}
        </span>
      </div>

      <div
        className="relative select-none overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-1)] bg-[var(--surface-0)]"
        onContextMenu={(e) => e.preventDefault()}
      >
        {src ? (
          // Plain <img>: the URL is signed and short-lived, so next/image's
          // optimiser (which would fetch and cache it server-side) is exactly
          // what must not happen here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={`Page ${page}`}
            draggable={false}
            className="mx-auto block max-h-[80vh] w-auto"
          />
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          aria-label="Previous page"
          className="grid size-11 place-items-center rounded-[var(--radius-md)] border border-[var(--border-1)] disabled:opacity-40"
        >
          <ChevronLeft className="size-5" />
        </button>
        <input
          type="range"
          min={1}
          max={manifest.pageCount}
          value={page}
          onChange={(e) => setPage(Number(e.target.value))}
          aria-label="Page"
          className="w-48"
        />
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(manifest.pageCount, p + 1))}
          disabled={page >= manifest.pageCount}
          aria-label="Next page"
          className="grid size-11 place-items-center rounded-[var(--radius-md)] border border-[var(--border-1)] disabled:opacity-40"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      {/* Said plainly. A reader who knows their copy is marked is far less
          likely to share it, and being straight about it beats pretending the
          file is somehow uncopyable. */}
      <p className="mt-6 text-center text-[length:var(--text-xs)] text-[color:var(--text-3)]">
        Every page of your copy carries your name, email and order number.
        Please don&apos;t share it.
      </p>
    </main>
  );
}
