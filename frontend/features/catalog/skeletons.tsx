/**
 * Loading skeletons for every catalogue surface.
 *
 * These live in `features/` rather than beside the pages that use them because
 * a component exported from a route module drags that module's `metadata`,
 * `generateStaticParams` and data calls along with it. That is exactly why the
 * previous `BookGridSkeleton` — exported from `app/shop/page.tsx` — was never
 * imported by anything: importing it was more expensive than writing it again.
 *
 * Each skeleton mirrors the box model of the thing it stands in for, so the
 * swap to real content shifts no layout.
 */
import { Skeleton } from "@/components/ui/primitives";
import { BookCardSkeleton } from "./book-card";

export function BookGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <BookCardSkeleton />
        </li>
      ))}
    </ul>
  );
}

export function BookListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="surface-card flex gap-5 p-4 sm:p-5">
          <Skeleton className="aspect-cover w-24 shrink-0 sm:w-32" />
          <div className="flex-1 space-y-2.5 py-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-5 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FilterRailSkeleton() {
  return (
    <div className="hidden space-y-7 lg:block">
      {Array.from({ length: 4 }, (_, group) => (
        <div key={group} className="space-y-2.5">
          <Skeleton className="h-4 w-20" />
          {Array.from({ length: 5 }, (_, row) => (
            <Skeleton key={row} className="h-4 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ResultsToolbarSkeleton() {
  return (
    <div className="mb-5 flex items-center justify-between gap-4">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-9 w-36" />
    </div>
  );
}

export function ProductPageSkeleton() {
  return (
    <div className="container-page py-8">
      <Skeleton className="mb-6 h-4 w-64" />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,42%)_1fr]">
        <Skeleton className="aspect-cover w-full rounded-[var(--radius-xl)]" />
        <div className="space-y-4">
          <div className="flex gap-2">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-24" />
          </div>
          <Skeleton className="h-9 w-4/5" />
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </div>
  );
}

export function ComboGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="surface-card overflow-hidden">
          <Skeleton className="h-44 w-full rounded-none" />
          <div className="space-y-2.5 p-5">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function KeyNoteListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="surface-card space-y-2.5 p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/**
 * Checkout previously rendered `null` while the persisted cart rehydrated,
 * which is a blank white page on every load — the cart page next door got this
 * right with skeletons, so the inconsistency read as a broken route.
 */
export function CheckoutSkeleton() {
  return (
    <div className="container-page py-8 md:py-12">
      <Skeleton className="h-9 w-48" />
      <div className="mt-6 flex gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-8 flex-1" />
        ))}
      </div>
      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-[var(--radius-xl)]" />
      </div>
    </div>
  );
}
