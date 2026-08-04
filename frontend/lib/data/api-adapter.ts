/**
 * `CatalogAdapter` over the real API.
 *
 * A drop-in replacement for `seedAdapter` — every one of the 18 methods returns
 * the same shape, which `backend/tests/test_catalog_contract.py` verifies
 * against the exported seed data on every run.
 *
 * Caching is per-surface (see REVALIDATE). Tags exist so an admin save can
 * invalidate exactly the pages that changed via `app/api/revalidate/route.ts`;
 * without that, `export const revalidate = 43200` on the product page means a
 * price edit takes twelve hours to appear.
 */
import type {
  Book,
  CatalogQuery,
  Combo,
  ComboResolved,
  Facets,
  KeyNote,
  Paginated,
  Review,
  SearchHit,
} from "@/types/catalog";
import type { CatalogAdapter } from "./adapter";
import { ApiError, apiFetch, toSearchParams } from "./http";
import {
  bookSchema,
  catalogExportSchema,
  comboResolvedSchema,
  comboSchema,
  facetsSchema,
  keyNoteSchema,
  paginatedSchema,
  parse,
  reviewSchema,
  searchHitSchema,
} from "./schemas";
import { z } from "zod";

/** Detail pages change rarely; filtered lists change with stock. */
const REVALIDATE = {
  detail: 3600,
  list: 300,
  rails: 900,
  slugs: 86400,
} as const;

const tagsFor = (slug: string) => ["catalog", `book:${slug}`];

/** A 404 is a legitimate answer for a `get*` method, not a failure. */
async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof ApiError && err.isNotFound) return null;
    throw err;
  }
}

/**
 * Used only by `generateStaticParams` and `sitemap`. A build must not fail
 * because the API blipped — it degrades to on-demand ISR for those pages,
 * which is invisible to users. This is the ONLY place a failure is swallowed;
 * everywhere else an error must reach `error.tsx` rather than render a page
 * with fabricated or missing products.
 */
async function orEmpty<T>(promise: Promise<T[]>, context: string): Promise<T[]> {
  try {
    return await promise;
  } catch (err) {
    console.warn(
      `[catalog] ${context} failed; falling back to on-demand rendering.`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export const apiAdapter: CatalogAdapter = {
  name: "api",

  async getBooks(query: CatalogQuery = {}): Promise<Paginated<Book>> {
    const data = await apiFetch(`/catalog/books${toSearchParams(query)}`, {
      revalidate: REVALIDATE.list,
      tags: ["catalog"],
    });
    return parse(paginatedSchema(bookSchema), data, "getBooks") as Paginated<Book>;
  },

  async getBook(slug: string): Promise<Book | null> {
    return orNull(
      apiFetch(`/catalog/books/${encodeURIComponent(slug)}`, {
        revalidate: REVALIDATE.detail,
        tags: tagsFor(slug),
      }).then((d) => parse(bookSchema, d, `getBook(${slug})`) as Book),
    );
  },

  async getAllBookSlugs(): Promise<string[]> {
    return orEmpty(
      apiFetch<unknown>("/catalog/books/slugs", {
        revalidate: REVALIDATE.slugs,
        tags: ["catalog"],
      }).then((d) => parse(z.array(z.string()), d, "getAllBookSlugs")),
      "getAllBookSlugs",
    );
  },

  async getCombos(query: CatalogQuery = {}): Promise<Paginated<Combo>> {
    const data = await apiFetch(`/catalog/combos${toSearchParams(query)}`, {
      revalidate: REVALIDATE.list,
      tags: ["catalog"],
    });
    return parse(paginatedSchema(comboSchema), data, "getCombos") as Paginated<Combo>;
  },

  async getCombo(slug: string): Promise<ComboResolved | null> {
    return orNull(
      apiFetch(`/catalog/combos/${encodeURIComponent(slug)}`, {
        revalidate: REVALIDATE.detail,
        tags: ["catalog", `combo:${slug}`],
      }).then((d) => parse(comboResolvedSchema, d, `getCombo(${slug})`) as ComboResolved),
    );
  },

  async getAllComboSlugs(): Promise<string[]> {
    return orEmpty(
      apiFetch<unknown>("/catalog/combos/slugs", {
        revalidate: REVALIDATE.slugs,
        tags: ["catalog"],
      }).then((d) => parse(z.array(z.string()), d, "getAllComboSlugs")),
      "getAllComboSlugs",
    );
  },

  async getKeyNotes(query: CatalogQuery = {}): Promise<KeyNote[]> {
    const data = await apiFetch(`/catalog/key-notes${toSearchParams(query)}`, {
      revalidate: REVALIDATE.list,
      tags: ["catalog"],
    });
    return parse(z.array(keyNoteSchema), data, "getKeyNotes") as KeyNote[];
  },

  async getKeyNote(slug: string): Promise<KeyNote | null> {
    return orNull(
      apiFetch(`/catalog/key-notes/${encodeURIComponent(slug)}`, {
        revalidate: REVALIDATE.detail,
        tags: ["catalog", `key-note:${slug}`],
      }).then((d) => parse(keyNoteSchema, d, `getKeyNote(${slug})`) as KeyNote),
    );
  },

  async getAllKeyNoteSlugs(): Promise<string[]> {
    return orEmpty(
      apiFetch<unknown>("/catalog/key-notes/slugs", {
        revalidate: REVALIDATE.slugs,
        tags: ["catalog"],
      }).then((d) => parse(z.array(z.string()), d, "getAllKeyNoteSlugs")),
      "getAllKeyNoteSlugs",
    );
  },

  async getFacets(query: CatalogQuery = {}): Promise<Facets> {
    const data = await apiFetch(`/catalog/facets${toSearchParams(query)}`, {
      revalidate: REVALIDATE.list,
      tags: ["catalog"],
    });
    return parse(facetsSchema, data, "getFacets") as Facets;
  },

  async getReviews(productSlug: string): Promise<Review[]> {
    const data = await apiFetch(`/catalog/reviews/${encodeURIComponent(productSlug)}`, {
      revalidate: REVALIDATE.detail,
      tags: tagsFor(productSlug),
    });
    return parse(z.array(reviewSchema), data, "getReviews") as Review[];
  },

  async search(term: string, limit = 8): Promise<SearchHit[]> {
    if (term.trim().length < 2) return [];
    const data = await apiFetch(
      `/catalog/search${toSearchParams({ q: term, limit })}`,
      // Search is typed live; caching it would serve a stale result set for the
      // previous keystroke.
      { revalidate: false },
    );
    return parse(z.array(searchHitSchema), data, "search") as SearchHit[];
  },

  async getBestSellers(limit = 8, classId?: string): Promise<Book[]> {
    const data = await apiFetch(
      `/catalog/rails/best-sellers${toSearchParams({ limit, classId })}`,
      { revalidate: REVALIDATE.rails, tags: ["catalog"] },
    );
    return parse(z.array(bookSchema), data, "getBestSellers") as Book[];
  },

  async getNewArrivals(limit = 8): Promise<Book[]> {
    const data = await apiFetch(`/catalog/rails/new-arrivals${toSearchParams({ limit })}`, {
      revalidate: REVALIDATE.rails,
      tags: ["catalog"],
    });
    return parse(z.array(bookSchema), data, "getNewArrivals") as Book[];
  },

  async getFeatured(limit = 8): Promise<Book[]> {
    const data = await apiFetch(`/catalog/rails/featured${toSearchParams({ limit })}`, {
      revalidate: REVALIDATE.rails,
      tags: ["catalog"],
    });
    return parse(z.array(bookSchema), data, "getFeatured") as Book[];
  },

  async getRelated(slug: string, limit = 4): Promise<Book[]> {
    const data = await apiFetch(
      `/catalog/books/${encodeURIComponent(slug)}/related${toSearchParams({ limit })}`,
      { revalidate: REVALIDATE.detail, tags: tagsFor(slug) },
    );
    return parse(z.array(bookSchema), data, "getRelated") as Book[];
  },

  async getFrequentlyBoughtTogether(slug: string, limit = 3): Promise<Book[]> {
    const data = await apiFetch(
      `/catalog/books/${encodeURIComponent(slug)}/frequently-bought-together${toSearchParams({ limit })}`,
      { revalidate: REVALIDATE.detail, tags: tagsFor(slug) },
    );
    return parse(z.array(bookSchema), data, "getFrequentlyBoughtTogether") as Book[];
  },
};

/**
 * Every published slug in one request.
 *
 * `sitemap.ts` and `generateStaticParams` would otherwise make one request per
 * URL — roughly 1,400 during a full build.
 */
export async function getCatalogExport() {
  try {
    const data = await apiFetch("/catalog/export", {
      revalidate: REVALIDATE.slugs,
      tags: ["catalog"],
    });
    return parse(catalogExportSchema, data, "getCatalogExport");
  } catch (err) {
    console.warn("[catalog] export failed; sitemap will be minimal.", err);
    return { books: [], combos: [], keyNotes: [], generatedAt: new Date().toISOString() };
  }
}
