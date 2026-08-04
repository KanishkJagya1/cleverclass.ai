import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { catalog } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { PreviewReader, type PreviewManifest } from "@/features/preview/reader";
import { notFound } from "next/navigation";

/**
 * A real, shareable URL for the free sample.
 *
 * Deliberately its own route rather than only a modal: this is what the sales
 * assistant deep-links to, what a WhatsApp share sends, and what a parent can
 * forward to the person actually paying. A modal-only reader has no URL to send.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const book = await catalog.getBook(slug);
  return {
    title: book ? `Free sample — ${book.title}` : "Free sample",
    // The sample is a conversion surface, not a page we want indexed instead
    // of the product page it sells.
    robots: { index: false, follow: true },
  };
}

async function getManifest(slug: string): Promise<PreviewManifest | null> {
  const base = process.env.CATALOG_API_URL ?? process.env.BACKEND_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/preview/${encodeURIComponent(slug)}/manifest`, {
      // Free ranges can change at any moment in the admin panel, and serving a
      // stale manifest would list pages the API will now refuse.
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as PreviewManifest;
  } catch {
    return null;
  }
}

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [book, manifest] = await Promise.all([catalog.getBook(slug), getManifest(slug)]);

  if (!book) notFound();

  // A book with no sample yet is not an error — it just has nothing to show.
  if (!manifest) {
    return (
      <div className="container-prose py-20 text-center">
        <h1 className="text-[length:var(--text-2xl)]">No free sample yet</h1>
        <p className="mt-3 text-[length:var(--text-body)] text-[color:var(--text-2)]">
          We haven&apos;t published sample pages for {book.title} yet.
        </p>
        <Button asChild className="mt-6">
          <Link href={`/shop/${slug}`}>
            <ArrowLeft className="size-4" aria-hidden />
            Back to the book
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container-page py-6">
      <Button asChild variant="ghost" size="sm" className="mb-3">
        <Link href={`/shop/${slug}`}>
          <ArrowLeft className="size-4" aria-hidden />
          Back to the book
        </Link>
      </Button>

      <div className="surface-card h-[calc(100vh-var(--nav-h)-8rem)] min-h-[32rem] overflow-hidden">
        <PreviewReader manifest={manifest} price={book.price} mrp={book.mrp} />
      </div>
    </div>
  );
}
