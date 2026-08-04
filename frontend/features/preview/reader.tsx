"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Lock, ShoppingCart, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { cn, formatPrice } from "@/lib/utils";
import { SITE } from "@/constants/catalog";

/* ==========================================================================
   Free-sample reader.

   The gaps are the point. A sample that silently jumps from page 8 to page 24
   reads as a short book; one that says "pages 9–23 are in the full book" reads
   as a sample of a longer one — which is exactly what a printed sample chapter
   does, and the strongest reason the format converts at all. So locked runs are
   rendered as slides in their own right, never skipped.
   ========================================================================== */

export interface PreviewManifest {
  slug: string;
  title: string;
  totalPages: number;
  freeRanges: { start: number; end: number }[];
  gaps: { start: number; end: number }[];
  freePageCount: number;
  pages: { n: number; url: string; thumb: string }[];
  version: string;
}

type Slot =
  | { kind: "page"; n: number; url: string }
  | { kind: "gap"; start: number; end: number }
  | { kind: "paywall" };

/**
 * Interleave free pages and locked gaps in reading order, then finish with the
 * paywall. Pure and separately testable — the ordering is the whole UX.
 */
export function buildSlots(manifest: PreviewManifest): Slot[] {
  const byPage = new Map(manifest.pages.map((p) => [p.n, p]));
  const slots: Slot[] = [];
  const ranges = [...manifest.freeRanges].sort((a, b) => a.start - b.start);

  let cursor = 1;
  for (const range of ranges) {
    if (range.start > cursor) {
      slots.push({ kind: "gap", start: cursor, end: range.start - 1 });
    }
    for (let n = range.start; n <= range.end; n++) {
      const page = byPage.get(n);
      if (page) slots.push({ kind: "page", n, url: page.url });
    }
    cursor = range.end + 1;
  }
  if (cursor <= manifest.totalPages) {
    slots.push({ kind: "gap", start: cursor, end: manifest.totalPages });
  }
  slots.push({ kind: "paywall" });
  return slots;
}

export function PreviewReader({
  manifest,
  price,
  mrp,
  onClose,
}: {
  manifest: PreviewManifest;
  price?: number;
  mrp?: number;
  onClose?: () => void;
}) {
  const slots = React.useMemo(() => buildSlots(manifest), [manifest]);
  const [index, setIndex] = React.useState(0);
  const slot = slots[index];

  const go = React.useCallback(
    (delta: number) => setIndex((i) => Math.max(0, Math.min(slots.length - 1, i + delta))),
    [slots.length],
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Home") setIndex(0);
      else if (e.key === "End") setIndex(slots.length - 1);
      else if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, slots.length, onClose]);

  // Prefetch the next two page images so paging forward feels instant.
  React.useEffect(() => {
    for (const ahead of [1, 2]) {
      const next = slots[index + ahead];
      if (next?.kind === "page") {
        const img = new window.Image();
        img.src = next.url;
      }
    }
  }, [index, slots]);

  const pageNumber = slot?.kind === "page" ? slot.n : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ------------------------------------------------------------ head */}
      <header className="flex items-start justify-between gap-4 border-b border-[var(--border-1)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="clamp-2 font-[family-name:var(--font-display)] text-[length:var(--text-base)] font-semibold text-[color:var(--text-1)]">
            {manifest.title}
          </h2>
          <p className="mt-0.5 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
            Free sample · {manifest.freePageCount} of {manifest.totalPages} pages · no sign-up
          </p>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close preview">
            <X className="size-5" aria-hidden />
          </Button>
        )}
      </header>

      {/* ------------------------------------------------------------ body */}
      <div className="relative min-h-0 flex-1 overflow-y-auto bg-[var(--surface-0)] p-4">
        {slot?.kind === "page" && <PageSlide key={slot.n} url={slot.url} n={slot.n} />}
        {slot?.kind === "gap" && <LockedGap start={slot.start} end={slot.end} onSkip={() => go(1)} />}
        {slot?.kind === "paywall" && (
          <Paywall manifest={manifest} price={price} mrp={mrp} />
        )}
      </div>

      {/* ------------------------------------------------------------ foot */}
      <footer className="flex items-center justify-between gap-3 border-t border-[var(--border-1)] px-4 py-3">
        <Button variant="secondary" size="sm" onClick={() => go(-1)} disabled={index === 0}>
          <ChevronLeft className="size-4" aria-hidden />
          Back
        </Button>

        <p aria-live="polite" className="tabular text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          {pageNumber
            ? `Page ${pageNumber} of ${manifest.totalPages}`
            : slot?.kind === "gap"
              ? "Locked section"
              : "End of sample"}
        </p>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => go(1)}
          disabled={index >= slots.length - 1}
        >
          Next
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </footer>
    </div>
  );
}

function PageSlide({ url, n }: { url: string; n: number }) {
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  return (
    <div className="relative mx-auto aspect-[1/1.41] w-full max-w-2xl">
      {!loaded && !failed && <Skeleton className="absolute inset-0 rounded-[var(--radius-md)]" />}
      {failed ? (
        <div className="grid h-full place-items-center rounded-[var(--radius-md)] bg-[var(--surface-1)] p-6 text-center">
          <p className="text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            This page could not be loaded. Try again in a moment.
          </p>
        </div>
      ) : (
        <Image
          src={url}
          alt={`Page ${n}`}
          fill
          sizes="(max-width: 768px) 92vw, 42rem"
          className={cn(
            "rounded-[var(--radius-md)] bg-[var(--surface-1)] object-contain shadow-[var(--elev-2)]",
            loaded ? "opacity-100" : "opacity-0",
          )}
          // The preview API serves these with its own cache headers, and the
          // image optimiser would strip the watermark's crispness for nothing.
          unoptimized
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          onContextMenu={(e) => e.preventDefault()}
          draggable={false}
        />
      )}
    </div>
  );
}

function LockedGap({
  start,
  end,
  onSkip,
}: {
  start: number;
  end: number;
  onSkip: () => void;
}) {
  const count = end - start + 1;
  return (
    <div className="mx-auto grid aspect-[1/1.41] w-full max-w-2xl place-items-center rounded-[var(--radius-md)] border border-dashed border-[var(--border-2)] bg-[var(--surface-1)] p-8 text-center">
      <div>
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--surface-0)] text-[color:var(--color-locked,var(--text-3))]">
          <Lock className="size-5" aria-hidden />
        </span>
        <p className="mt-5 font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-semibold text-[color:var(--text-1)]">
          {count === 1 ? `Page ${start}` : `Pages ${start}–${end}`}
        </p>
        <p className="mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          {count === 1 ? "This page is" : `These ${count} pages are`} in the full book.
        </p>
        <Button variant="secondary" size="sm" className="mt-5" onClick={onSkip}>
          Skip to the next free page
        </Button>
      </div>
    </div>
  );
}

function Paywall({
  manifest,
  price,
  mrp,
}: {
  manifest: PreviewManifest;
  price?: number;
  mrp?: number;
}) {
  const locked = manifest.totalPages - manifest.freePageCount;
  return (
    <div className="mx-auto grid aspect-[1/1.41] w-full max-w-2xl place-items-center rounded-[var(--radius-md)] bg-[var(--surface-1)] p-8 text-center shadow-[var(--elev-2)]">
      <div>
        <p className="text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-wide)] text-[color:var(--text-brand)]">
          End of the free sample
        </p>
        <h3 className="mt-4 font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-semibold text-[color:var(--text-1)]">
          {locked} more pages in the full book
        </h3>
        <p className="mt-3 text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]">
          Every chapter, every solved exercise and the full practice sets.
        </p>

        {price !== undefined && (
          <p className="tabular mt-5 text-[length:var(--text-2xl)] font-bold text-[color:var(--text-1)]">
            {formatPrice(price)}
            {mrp && mrp > price && (
              <span className="ml-2 text-[length:var(--text-base)] font-normal text-[color:var(--text-3)] line-through">
                {formatPrice(mrp)}
              </span>
            )}
          </p>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href={`/shop/${manifest.slug}`}>
              <ShoppingCart className="size-4" aria-hidden />
              Buy the full book
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <a
              href={`https://wa.me/${SITE.phones[0].replace(/\D/g, "")}?text=${encodeURIComponent(
                `Hi, I read the free sample of "${manifest.title}" and would like to order it.`,
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Order on WhatsApp
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
