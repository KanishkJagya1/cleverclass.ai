/**
 * In-memory adapter over the seed catalog.
 *
 * Everything is synchronous under the hood but the interface is async, so a
 * network-backed adapter is a drop-in replacement with no call-site changes.
 */
import { CLASSES, MEDIUMS, SERIES } from "@/constants/catalog";
import { SEED_BOOKS, SEED_COMBOS, SEED_KEY_NOTES, SEED_REVIEWS } from "./seed";
import type { CatalogAdapter } from "./adapter";
import type {
  Book,
  CatalogQuery,
  Combo,
  ComboResolved,
  Facets,
  KeyNote,
  Paginated,
  SearchHit,
  SortKey,
} from "@/types/catalog";

const asArray = <T,>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

function matches(b: Book, q: CatalogQuery): boolean {
  if (q.board && b.board !== q.board) return false;

  const classes = asArray(q.classId);
  if (classes.length && !classes.includes(b.classId)) return false;

  const mediums = asArray(q.medium);
  if (mediums.length && !mediums.includes(b.medium)) return false;

  const subjects = asArray(q.subject);
  if (subjects.length && !subjects.includes(b.subject)) return false;

  const series = asArray(q.series);
  if (series.length && !series.includes(b.series)) return false;

  if (q.stream && b.stream !== q.stream) return false;
  if (q.minPrice !== undefined && b.price < q.minPrice) return false;
  if (q.maxPrice !== undefined && b.price > q.maxPrice) return false;
  if (q.inStockOnly && !b.inStock) return false;

  if (q.q) {
    const t = q.q.toLowerCase();
    const hay = `${b.title} ${b.titleMr ?? ""} ${b.subject} ${b.series} ${b.classId}`.toLowerCase();
    if (!hay.includes(t)) return false;
  }
  return true;
}

function sortBooks<T extends Book | Combo>(items: T[], sort: SortKey = "relevance"): T[] {
  const out = [...items];
  switch (sort) {
    case "price-asc":
      return out.sort((a, b) => a.price - b.price);
    case "price-desc":
      return out.sort((a, b) => b.price - a.price);
    case "rating":
      return out.sort((a, b) => b.rating - a.rating);
    case "newest":
      return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    case "popularity":
      return out.sort((a, b) => b.reviewCount - a.reviewCount);
    default:
      // Relevance: in-stock first, then rating × review volume. Prevents the
      // default grid from opening with out-of-stock or unreviewed titles.
      return out.sort(
        (a, b) =>
          Number(b.inStock) - Number(a.inStock) ||
          b.rating * Math.log1p(b.reviewCount) - a.rating * Math.log1p(a.reviewCount),
      );
  }
}

function paginate<T>(items: T[], page = 1, perPage = 24): Paginated<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safe = Math.min(Math.max(1, page), totalPages);
  return {
    items: items.slice((safe - 1) * perPage, safe * perPage),
    total,
    page: safe,
    perPage,
    totalPages,
  };
}

function resolveCombo(c: Combo): ComboResolved {
  const items = c.itemSlugs
    .map((s) => SEED_BOOKS.find((b) => b.slug === s))
    .filter((b): b is Book => Boolean(b));
  const itemsTotal = items.reduce((s, b) => s + b.price, 0);
  const savings = Math.max(0, itemsTotal - c.price);
  return {
    ...c,
    items,
    itemsTotal,
    savings,
    savingsPct: itemsTotal > 0 ? Math.round((savings / itemsTotal) * 100) : 0,
  };
}

function counts<T extends string>(
  books: Book[],
  key: (b: Book) => T,
  label: (v: T) => string,
): { value: string; label: string; count: number }[] {
  const map = new Map<T, number>();
  for (const b of books) map.set(key(b), (map.get(key(b)) ?? 0) + 1);
  return [...map.entries()]
    .map(([value, count]) => ({ value, label: label(value), count }))
    .sort((a, b) => b.count - a.count);
}

export const seedAdapter: CatalogAdapter = {
  name: "seed",

  async getBooks(query = {}) {
    const filtered = SEED_BOOKS.filter((b) => matches(b, query));
    return paginate(sortBooks(filtered, query.sort), query.page, query.perPage);
  },

  async getBook(slug) {
    return SEED_BOOKS.find((b) => b.slug === slug) ?? null;
  },

  async getAllBookSlugs() {
    return SEED_BOOKS.map((b) => b.slug);
  },

  async getCombos(query = {}) {
    const filtered = SEED_COMBOS.filter((c) => {
      if (query.board && c.board !== query.board) return false;
      const classes = asArray(query.classId);
      if (classes.length && !classes.includes(c.classId)) return false;
      const mediums = asArray(query.medium);
      if (mediums.length && !mediums.includes(c.medium)) return false;
      if (query.stream && c.stream !== query.stream) return false;
      return true;
    });
    return paginate(sortBooks(filtered, query.sort), query.page, query.perPage ?? 24);
  },

  async getCombo(slug) {
    const c = SEED_COMBOS.find((x) => x.slug === slug);
    return c ? resolveCombo(c) : null;
  },

  async getAllComboSlugs() {
    return SEED_COMBOS.map((c) => c.slug);
  },

  async getKeyNotes(query = {}) {
    const classes = asArray(query.classId);
    const mediums = asArray(query.medium);
    const subjects = asArray(query.subject);
    return SEED_KEY_NOTES.filter(
      (n) =>
        (!classes.length || classes.includes(n.classId)) &&
        (!mediums.length || mediums.includes(n.medium)) &&
        (!subjects.length || subjects.includes(n.subject)),
    );
  },

  async getKeyNote(slug) {
    return SEED_KEY_NOTES.find((n) => n.slug === slug) ?? null;
  },

  async getAllKeyNoteSlugs() {
    return SEED_KEY_NOTES.map((n) => n.slug);
  },

  async getFacets(query = {}) {
    // Facet counts are computed against the query *minus* the facet itself in a
    // real search engine; here the simplification is intentional and visible.
    // ponytail: single-pass counts over the filtered set. Move to per-facet
    // exclusion when users complain that counts hit zero unexpectedly.
    const books = SEED_BOOKS.filter((b) => matches(b, query));
    const prices = books.map((b) => b.price);
    return {
      classId: counts(
        books,
        (b) => b.classId,
        (v) => CLASSES.find((c) => c.id === v)?.label ?? v,
      ),
      medium: counts(
        books,
        (b) => b.medium,
        (v) => MEDIUMS.find((m) => m.id === v)?.label ?? v,
      ),
      subject: counts(books, (b) => b.subject, (v) => v),
      series: counts(
        books,
        (b) => b.series,
        (v) => SERIES.find((s) => s.id === v)?.label ?? v,
      ),
      priceRange: {
        min: prices.length ? Math.min(...prices) : 0,
        max: prices.length ? Math.max(...prices) : 600,
      },
    } satisfies Facets;
  },

  async getReviews(productSlug) {
    return SEED_REVIEWS.filter((r) => r.productSlug === productSlug);
  },

  async search(term, limit = 12) {
    const t = term.trim().toLowerCase();
    if (!t) return [];
    const words = t.split(/\s+/);

    const score = (hay: string) =>
      words.reduce((s, w) => (hay.includes(w) ? s + (hay.startsWith(w) ? 2 : 1) : s), 0);

    const books: SearchHit[] = SEED_BOOKS.map((b) => ({
      book: b,
      s: score(`${b.title} ${b.titleMr ?? ""} ${b.subject} ${b.series} class ${b.classId} ${b.medium}`.toLowerCase()),
    }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map(({ book }) => ({
        slug: book.slug,
        title: book.title,
        titleMr: book.titleMr,
        subtitle: `${book.subject} · ${CLASSES.find((c) => c.id === book.classId)?.label ?? ""}`,
        format: "book" as const,
        href: `/shop/${book.slug}`,
        image: book.images[0]?.src,
        price: book.price,
      }));

    const combos: SearchHit[] = SEED_COMBOS.filter((c) =>
      score(`${c.title} ${c.titleMr ?? ""} combo set class ${c.classId} ${c.medium}`.toLowerCase()) > 0,
    )
      .slice(0, 4)
      .map((c) => ({
        slug: c.slug,
        title: c.title,
        subtitle: `${c.itemSlugs.length} books · ${c.medium}`,
        format: "combo" as const,
        href: `/combo-packs/${c.slug}`,
        image: c.images[0]?.src,
        price: c.price,
      }));

    return [...combos, ...books].slice(0, limit);
  },

  async getBestSellers(limit = 8, classId) {
    return SEED_BOOKS.filter(
      (b) => b.bestSellerRank !== undefined && (!classId || b.classId === classId),
    )
      .sort((a, b) => (a.bestSellerRank ?? 99) - (b.bestSellerRank ?? 99))
      .slice(0, limit);
  },

  async getNewArrivals(limit = 10) {
    return [...SEED_BOOKS]
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, limit);
  },

  async getFeatured(limit = 5) {
    return [...SEED_BOOKS]
      .filter((b) => b.inStock && b.rating >= 4.4)
      .sort((a, b) => b.rating * b.reviewCount - a.rating * a.reviewCount)
      .slice(0, limit);
  },

  async getRelated(slug, limit = 6) {
    const book = SEED_BOOKS.find((b) => b.slug === slug);
    if (!book) return [];
    return SEED_BOOKS.filter(
      (b) => b.slug !== slug && b.classId === book.classId && b.medium === book.medium,
    ).slice(0, limit);
  },

  async getFrequentlyBoughtTogether(slug, limit = 2) {
    const book = SEED_BOOKS.find((b) => b.slug === slug);
    if (!book) return [];
    // Same class + medium, different subject — the realistic co-purchase, and
    // the cheapest route over the ₹200 free-shipping line.
    return SEED_BOOKS.filter(
      (b) =>
        b.slug !== slug &&
        b.classId === book.classId &&
        b.medium === book.medium &&
        b.subject !== book.subject &&
        b.inStock,
    )
      .sort((a, b) => b.rating - a.rating)
      .slice(0, limit);
  },
};
