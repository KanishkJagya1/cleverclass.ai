"use client";

/**
 * Shared pagination for the admin tables.
 *
 * Every admin list endpoint returns the same envelope, so one hook and one
 * control serve all of them. The alternative — each page tracking its own
 * `page` state and rendering its own buttons — is how two tables end up
 * disagreeing about whether pages are 0- or 1-based.
 *
 * The page number lives in the URL. An operator who opens an order from page
 * four and comes back should still be on page four, and a link to a list
 * should point at what the sender was actually looking at.
 */

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAdminData } from "@/features/admin/auth-context";

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export const EMPTY_PAGE: Paged<never> = {
  items: [],
  total: 0,
  page: 1,
  perPage: 50,
  totalPages: 0,
};

/** Read the current page from the URL, defaulting to 1. */
export function usePageParam(): [number, (next: number) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const raw = Number(params.get("page") ?? "1");
  const page = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;

  const setPage = React.useCallback(
    (next: number) => {
      const query = new URLSearchParams(params.toString());
      // Page one is the default, so it stays out of the URL — a shared link
      // reads as the list itself rather than the list "at page 1".
      if (next <= 1) query.delete("page");
      else query.set("page", String(next));
      const qs = query.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return [page, setPage];
}

/**
 * Fetch a paginated admin list.
 *
 * `filters` are appended verbatim; empty values are dropped so the query
 * string stays readable and two identical views produce the same URL.
 */
export function usePaginatedAdminData<T>(
  basePath: string,
  filters: Record<string, string | number | boolean | null | undefined> = {},
  perPage = 50,
) {
  const [page, setPage] = usePageParam();

  const query = new URLSearchParams();
  query.set("page", String(page));
  query.set("perPage", String(perPage));
  for (const [key, value] of Object.entries(filters)) {
    if (value === null || value === undefined || value === "") continue;
    query.set(key, String(value));
  }
  const qs = query.toString();

  const state = useAdminData<Paged<T>>(`${basePath}?${qs}`, [qs]);

  // A filter change can leave the operator past the end of the new result
  // set, which renders as an empty table that looks like "no data" rather
  // than "no data *here*". Send them back to the first page instead.
  React.useEffect(() => {
    if (state.data && state.data.totalPages > 0 && page > state.data.totalPages) {
      setPage(1);
    }
  }, [state.data, page, setPage]);

  return { ...state, page, setPage };
}

export function Pagination({
  page,
  totalPages,
  total,
  perPage,
  onPage,
  noun = "row",
}: {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  onPage: (next: number) => void;
  /** Singular noun for the count, e.g. "order". */
  noun?: string;
}) {
  if (total === 0) return null;

  const first = (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"
      aria-label="Pagination"
    >
      {/* Stated exactly, because "showing 50" with no total is how an operator
          concludes the shop has 50 orders. */}
      <p className="text-sm text-muted-foreground">
        {first}–{last} of {total} {noun}
        {total === 1 ? "" : "s"}
      </p>

      {totalPages > 1 ? (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm tabular-nums">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : null}
    </nav>
  );
}
