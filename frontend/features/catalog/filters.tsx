"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Drawer } from "vaul";
import * as Accordion from "@radix-ui/react-accordion";
import { ChevronDown, LayoutGrid, List, SlidersHorizontal, X } from "lucide-react";
import { SORT_OPTIONS } from "@/constants/catalog";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { buildQuery, cn } from "@/lib/utils";
import type { Facets } from "@/types/catalog";

const GROUPS = [
  { key: "class", label: "Class", facet: "classId" },
  { key: "medium", label: "Medium", facet: "medium" },
  { key: "subject", label: "Subject", facet: "subject" },
  { key: "series", label: "Series", facet: "series" },
] as const;

/**
 * All filter state lives in the URL. Shareable, back-button correct,
 * server-renderable and crawlable — none of which is true of component state.
 */
function useFilterNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const toggle = React.useCallback(
    (key: string, value: string) => {
      const current = params.getAll(key);
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      router.push(`${pathname}${buildQuery(new URLSearchParams(params), { [key]: next })}`, {
        scroll: false,
      });
    },
    [params, pathname, router],
  );

  const set = React.useCallback(
    (patch: Record<string, string | undefined>) => {
      router.push(`${pathname}${buildQuery(new URLSearchParams(params), patch)}`, {
        scroll: false,
      });
    },
    [params, pathname, router],
  );

  return { params, pathname, toggle, set };
}

/* -------------------------------------------------------------------------- */
/* FilterGroups — shared by the desktop rail and the mobile sheet             */
/* -------------------------------------------------------------------------- */
function FilterGroups({ facets }: { facets: Facets }) {
  const { params, toggle, set } = useFilterNav();

  return (
    <Accordion.Root
      type="multiple"
      defaultValue={GROUPS.map((g) => g.key)}
      className="divide-y divide-[var(--border-1)]"
    >
      {GROUPS.map((group) => {
        const options = facets[group.facet];
        if (!options?.length) return null;
        const active = params.getAll(group.key);

        return (
          <Accordion.Item key={group.key} value={group.key} className="py-4 first:pt-0">
            <Accordion.Trigger className="group flex w-full items-center justify-between text-left">
              <span className="text-[length:var(--text-sm)] font-semibold text-[color:var(--text-1)]">
                {group.label}
                {active.length > 0 && (
                  <span className="tabular ml-2 text-[color:var(--text-brand)]">({active.length})</span>
                )}
              </span>
              <ChevronDown
                className="size-4 text-[color:var(--text-3)] transition-transform duration-[var(--duration-base)] group-data-[state=open]:rotate-180"
                aria-hidden
              />
            </Accordion.Trigger>
            <Accordion.Content className="overflow-hidden data-[state=closed]:animate-[collapse_var(--duration-base)_var(--ease-standard)] data-[state=open]:animate-[expand_var(--duration-base)_var(--ease-standard)]">
              <ul className="mt-3 max-h-64 space-y-0.5 overflow-y-auto pr-1">
                {options.map((opt) => {
                  const checked = active.includes(opt.value);
                  const id = `f-${group.key}-${opt.value}`;
                  return (
                    <li key={opt.value}>
                      <label
                        htmlFor={id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-2 hover:bg-[var(--surface-0)]"
                      >
                        <input
                          id={id}
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(group.key, opt.value)}
                          className="size-4 shrink-0 accent-[var(--brand-base)]"
                        />
                        <span className="flex-1 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                          {opt.label}
                        </span>
                        <span className="tabular text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                          {opt.count}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </Accordion.Content>
          </Accordion.Item>
        );
      })}

      {/* Availability */}
      <div className="py-4">
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={params.get("inStock") === "1"}
            onChange={(e) => set({ inStock: e.target.checked ? "1" : undefined })}
            className="size-4 accent-[var(--brand-base)]"
          />
          <span className="text-[length:var(--text-sm)] text-[color:var(--text-2)]">In stock only</span>
        </label>
      </div>
    </Accordion.Root>
  );
}

/* -------------------------------------------------------------------------- */
/* Desktop rail                                                               */
/* -------------------------------------------------------------------------- */
export function FilterRail({ facets }: { facets: Facets }) {
  const { pathname } = useFilterNav();

  return (
    <aside className="hidden lg:block" aria-label="Filters">
      <div className="sticky top-[calc(var(--nav-h)+1.5rem)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[length:var(--text-base)] font-semibold text-[color:var(--text-1)]">
            Filters
          </h2>
          <Button asChild variant="link" size="sm">
            <Link href={pathname}>Clear all</Link>
          </Button>
        </div>
        <FilterGroups facets={facets} />
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* Mobile sheet (D12) — the count on the CTA updates live, so the user knows   */
/* the outcome before committing to it.                                       */
/* -------------------------------------------------------------------------- */
export function FilterSheet({ facets, total }: { facets: Facets; total: number }) {
  const [open, setOpen] = React.useState(false);
  const { params, pathname } = useFilterNav();
  const activeCount = GROUPS.reduce((n, g) => n + params.getAll(g.key).length, 0);

  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild>
        <Button variant="secondary" size="sm" className="lg:hidden">
          <SlidersHorizontal className="size-4" aria-hidden />
          Filters
          {activeCount > 0 && (
            <span className="tabular ml-1 grid size-5 place-items-center rounded-full bg-[var(--brand-base)] text-[length:var(--text-2xs)] font-semibold text-[color:var(--brand-on)]">
              {activeCount}
            </span>
          )}
        </Button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="glass-veil fixed inset-0 z-[var(--z-overlay)]" />
        <Drawer.Content className="glass-panel panel-solid fixed inset-x-0 bottom-0 z-[var(--z-modal)] flex max-h-[88vh] flex-col !rounded-b-none">
          <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-[var(--border-2)]" aria-hidden />
          <div className="flex items-center justify-between p-4">
            <Drawer.Title className="text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
              Filters
            </Drawer.Title>
            <Drawer.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close filters">
                <X className="size-5" aria-hidden />
              </Button>
            </Drawer.Close>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-4">
            <FilterGroups facets={facets} />
          </div>
          <div
            className="flex gap-3 border-t border-[var(--border-1)] p-4"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            <Button asChild variant="secondary" className="flex-1">
              <Link href={pathname} onClick={() => setOpen(false)}>
                Clear
              </Link>
            </Button>
            <Button className="flex-[2]" onClick={() => setOpen(false)}>
              Show {total} result{total === 1 ? "" : "s"}
            </Button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/* -------------------------------------------------------------------------- */
/* Active chips — collapsed accordions hide what's applied, and "why am I      */
/* seeing so few books" is the top faceted-search complaint.                   */
/* -------------------------------------------------------------------------- */
export function ActiveFilters({ facets }: { facets: Facets }) {
  const { params, pathname, toggle } = useFilterNav();

  const chips = GROUPS.flatMap((g) =>
    params.getAll(g.key).map((value) => ({
      key: g.key,
      value,
      label: facets[g.facet]?.find((o) => o.value === value)?.label ?? value,
    })),
  );

  if (chips.length === 0) return null;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <button
          key={`${c.key}-${c.value}`}
          onClick={() => toggle(c.key, c.value)}
          className="chip-tap inline-flex items-center gap-1.5 rounded-full border border-[var(--border-1)] bg-[var(--surface-1)] py-1.5 pl-3 pr-2 text-[length:var(--text-xs)] font-medium text-[color:var(--text-2)] transition-colors hover:border-[var(--border-2)]"
        >
          {c.label}
          <X className="size-3.5" aria-hidden />
          <span className="sr-only">Remove filter</span>
        </button>
      ))}
      <Link
        href={pathname}
        className="chip-tap text-[length:var(--text-xs)] font-medium text-[color:var(--text-brand)] underline underline-offset-4"
      >
        Clear all
      </Link>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Toolbar                                                                    */
/* -------------------------------------------------------------------------- */
export function ResultsToolbar({
  total,
  shown,
  facets,
}: {
  total: number;
  shown: number;
  facets: Facets;
}) {
  const { params, set } = useFilterNav();
  const view = params.get("view") ?? "grid";

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <p aria-live="polite" className="tabular text-[length:var(--text-sm)] text-[color:var(--text-2)]">
        Showing <span className="font-medium text-[color:var(--text-1)]">{shown}</span> of {total} books
      </p>

      {/* Below xs the controls take their own full-width row rather than
          competing with the result count on one line — at 320px the Filters
          button, the view toggles and the sort select together needed more
          than the viewport, and the select was squeezed to 26px. */}
      <div className="flex w-full min-w-0 items-center justify-between gap-2 xs:w-auto xs:justify-start">
        <FilterSheet facets={facets} total={total} />

        <div className="hidden items-center rounded-[var(--radius-md)] border border-[var(--border-1)] p-0.5 sm:flex">
          {(["grid", "list"] as const).map((v) => {
            const Icon = v === "grid" ? LayoutGrid : List;
            return (
              <button
                key={v}
                onClick={() => set({ view: v === "grid" ? undefined : v })}
                aria-pressed={view === v}
                aria-label={`${v} view`}
                className={cn(
                  "grid size-8 place-items-center rounded-[var(--radius-sm)] transition-colors coarse:size-11",
                  view === v
                    ? "bg-[var(--surface-0)] text-[color:var(--text-1)]"
                    : "text-[color:var(--text-3)] hover:text-[color:var(--text-2)]",
                )}
              >
                <Icon className="size-4" aria-hidden />
              </button>
            );
          })}
        </div>

        <label className="sr-only" htmlFor="sort">
          Sort results
        </label>
        <select
          id="sort"
          value={params.get("sort") ?? "relevance"}
          onChange={(e) => set({ sort: e.target.value === "relevance" ? undefined : e.target.value })}
          // A native select sizes to its LONGEST option ("Price: high to low"),
          // which made this 178px wide and pushed the toolbar past a 320px
          // viewport. min-w-0 lets it shrink to the space available; it returns
          // to its intrinsic width from sm up.
          className="h-9 min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border-1)] bg-[var(--surface-1)] px-3 text-[length:var(--text-sm)] text-[color:var(--text-2)] coarse:h-11 sm:flex-none"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pagination — not infinite scroll: it breaks the footer, back-navigation     */
/* and crawlability, all three of which matter more than the scroll gesture.   */
/* -------------------------------------------------------------------------- */
export function Pagination({ page, totalPages }: { page: number; totalPages: number }) {
  const params = useSearchParams();
  const pathname = usePathname();
  if (totalPages <= 1) return null;

  const href = (p: number) =>
    `${pathname}${buildQuery(new URLSearchParams(params), { page: p === 1 ? undefined : p })}`;

  const windowed = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1,
  );

  return (
    <nav aria-label="Pagination" className="mt-10 flex items-center justify-center gap-1.5">
      {page > 1 && (
        <Button asChild variant="secondary" size="sm">
          <Link href={href(page - 1)} rel="prev">
            Previous
          </Link>
        </Button>
      )}
      {windowed.map((p, i) => (
        <React.Fragment key={p}>
          {i > 0 && windowed[i - 1]! < p - 1 && (
            <span className="px-1 text-[color:var(--text-3)]" aria-hidden>
              …
            </span>
          )}
          <Link
            href={href(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(
              "tabular grid size-9 place-items-center rounded-[var(--radius-md)] text-[length:var(--text-sm)]",
              p === page
                ? "bg-[var(--brand-base)] font-semibold text-[color:var(--brand-on)]"
                : "text-[color:var(--text-2)] hover:bg-[var(--surface-0)]",
            )}
          >
            {p}
          </Link>
        </React.Fragment>
      ))}
      {page < totalPages && (
        <Button asChild variant="secondary" size="sm">
          <Link href={href(page + 1)} rel="next">
            Next
          </Link>
        </Button>
      )}
    </nav>
  );
}
