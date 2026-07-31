"use client";

import * as React from "react";
import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { CoverImage } from "@/types/catalog";

const KIND_LABEL: Record<CoverImage["kind"], string> = {
  front: "Front cover",
  back: "Back cover",
  inside: "Inside pages",
};

/**
 * Multi-image gallery (D10). Front / back / inside are *kinds*, not just
 * slides — a buyer checking a study guide wants to see the inside, and
 * labelling the tab is what tells them they can.
 *
 * Flip: front↔back uses a CSS 3D rotation, not R3F (D6).
 */
export function ProductGallery({ images, title }: { images: CoverImage[]; title: string }) {
  const [active, setActive] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [zoom, setZoom] = React.useState(false);

  const current = images[active];
  const back = images.find((i) => i.kind === "back");
  const canFlip = active === 0 && Boolean(back);

  return (
    <div className="lg:sticky lg:top-[calc(var(--nav-h)+1.5rem)]">
      <div className="relative">
        <div
          className={cn(
            "relative aspect-cover overflow-hidden rounded-[var(--radius-xl)]",
            "bg-[var(--surface-0)] shadow-[var(--shadow-lg)]",
            "[perspective:1400px]",
          )}
        >
          <div
            className={cn(
              "relative size-full transition-transform duration-[560ms] ease-[var(--ease-in-out)]",
              "[transform-style:preserve-3d] motion-reduce:transition-none",
            )}
            style={{ transform: flipped && canFlip ? "rotateY(180deg)" : undefined }}
          >
            <div className="absolute inset-0 [backface-visibility:hidden]">
              {current && (
                <Image
                  src={current.src}
                  alt={current.alt || `${title} — ${KIND_LABEL[current.kind]}`}
                  fill
                  priority
                  sizes="(max-width: 1024px) 92vw, 42vw"
                  className="object-cover"
                />
              )}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-black/20 to-transparent"
              />
            </div>

            {back && (
              <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                <Image src={back.src} alt={`${title} — back cover`} fill sizes="(max-width: 1024px) 92vw, 42vw" className="object-cover" />
              </div>
            )}
          </div>
        </div>

        <div className="absolute right-3 top-3 flex flex-col gap-2">
          <Button
            variant="glass"
            size="icon-sm"
            onClick={() => setZoom(true)}
            aria-label="Zoom image"
          >
            <ZoomIn className="size-4" aria-hidden />
          </Button>
          {canFlip && (
            <Button
              variant="glass"
              size="icon-sm"
              onClick={() => setFlipped((f) => !f)}
              aria-label={flipped ? "Show front cover" : "Show back cover"}
              aria-pressed={flipped}
            >
              <BookOpen className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      </div>

      {/* Thumbnails, labelled by kind */}
      <div className="mt-4 flex gap-2.5" role="tablist" aria-label="Product images">
        {images.map((img, i) => (
          <button
            key={img.src}
            role="tab"
            aria-selected={i === active}
            aria-label={KIND_LABEL[img.kind]}
            onClick={() => {
              setActive(i);
              setFlipped(false);
            }}
            className={cn(
              "relative aspect-cover w-16 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--surface-0)]",
              "border-2 transition-colors duration-[var(--duration-fast)]",
              i === active ? "border-[var(--brand-base)]" : "border-transparent hover:border-[var(--border-2)]",
            )}
          >
            <Image src={img.src} alt="" fill sizes="64px" className="object-cover" />
          </button>
        ))}
      </div>

      <Dialog.Root open={zoom} onOpenChange={setZoom}>
        <Dialog.Portal>
          <Dialog.Overlay className="glass-veil fixed inset-0 z-[var(--z-overlay)] data-[state=open]:animate-[fadeIn_var(--duration-fast)_ease-out]" />
          <Dialog.Content className="fixed inset-4 z-[var(--z-modal)] grid place-items-center focus:outline-none md:inset-10">
            <Dialog.Title className="sr-only">{title} — enlarged image</Dialog.Title>
            <div className="relative h-full w-full max-w-2xl">
              {current && (
                <Image src={current.src} alt={current.alt} fill sizes="90vw" className="object-contain" />
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="glass" size="icon" className="absolute right-0 top-0" aria-label="Close">
                <X className="size-5" aria-hidden />
              </Button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* PreviewReader — free pages, no sign-up (D1).                               */
/* -------------------------------------------------------------------------- */
export function PreviewReader({
  pages,
  totalPages,
  title,
  trigger,
}: {
  pages: string[];
  totalPages: number;
  title: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [page, setPage] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setPage((p) => Math.min(pages.length - 1, p + 1));
      if (e.key === "ArrowLeft") setPage((p) => Math.max(0, p - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pages.length]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        {trigger ?? (
          <Button variant="secondary" full>
            <BookOpen className="size-4" aria-hidden />
            Preview {pages.length} pages free
          </Button>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="glass-veil fixed inset-0 z-[var(--z-overlay)]" />
        <Dialog.Content
          className={cn(
            "glass-panel glass-edge fixed left-1/2 top-1/2 z-[var(--z-modal)] flex max-h-[92vh] w-[min(56rem,94vw)]",
            "-translate-x-1/2 -translate-y-1/2 flex-col p-5 focus:outline-none md:p-6",
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-[var(--text-1)]">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-[length:var(--text-sm)] text-[var(--text-2)]">
                Free preview — {pages.length} of {totalPages} pages. No sign-up needed.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close preview">
                <X className="size-5" aria-hidden />
              </Button>
            </Dialog.Close>
          </div>

          <div className="relative flex-1 overflow-hidden rounded-[var(--radius-lg)] bg-[var(--surface-1)]">
            <div className="relative mx-auto aspect-[1/1.35] h-full max-h-[60vh]">
              {pages[page] && (
                <Image
                  src={pages[page]!}
                  alt={`Preview page ${page + 1}`}
                  fill
                  sizes="(max-width: 768px) 90vw, 42rem"
                  className="object-contain"
                />
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft className="size-4" aria-hidden />
              Previous
            </Button>
            <p aria-live="polite" className="tabular text-[length:var(--text-sm)] text-[var(--text-2)]">
              Page {page + 1} of {pages.length}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.min(pages.length - 1, p + 1))}
              disabled={page === pages.length - 1}
            >
              Next
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>

          {page === pages.length - 1 && (
            <div className="mt-4 rounded-[var(--radius-lg)] bg-[var(--brand-soft)] p-4 text-center">
              <Badge variant="brand">End of free preview</Badge>
              <p className="mt-2 text-[length:var(--text-sm)] text-[var(--text-2)]">
                The full book has {totalPages} pages with every exercise solved.
              </p>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
