/**
 * Catalog adapter contract (D7).
 *
 * Every data read in the app goes through this interface. Swapping the seed
 * source for Postgres, Supabase, Shopify, Strapi, Sanity or Payload means
 * writing one new object that satisfies `CatalogAdapter` and changing the
 * single export in `lib/data/index.ts`. No component changes, ever.
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

export interface CatalogAdapter {
  readonly name: string;

  getBooks(query?: CatalogQuery): Promise<Paginated<Book>>;
  getBook(slug: string): Promise<Book | null>;
  getAllBookSlugs(): Promise<string[]>;

  getCombos(query?: CatalogQuery): Promise<Paginated<Combo>>;
  getCombo(slug: string): Promise<ComboResolved | null>;
  getAllComboSlugs(): Promise<string[]>;

  getKeyNotes(query?: CatalogQuery): Promise<KeyNote[]>;
  getKeyNote(slug: string): Promise<KeyNote | null>;
  getAllKeyNoteSlugs(): Promise<string[]>;

  getFacets(query?: CatalogQuery): Promise<Facets>;
  getReviews(productSlug: string): Promise<Review[]>;

  /** Lexical search. Semantic search lives in the AI backend (D8). */
  search(term: string, limit?: number): Promise<SearchHit[]>;

  getBestSellers(limit?: number, classId?: string): Promise<Book[]>;
  getNewArrivals(limit?: number): Promise<Book[]>;
  getFeatured(limit?: number): Promise<Book[]>;
  getRelated(slug: string, limit?: number): Promise<Book[]>;
  /** "Frequently bought together" — the ₹200 threshold mechanism per item. */
  getFrequentlyBoughtTogether(slug: string, limit?: number): Promise<Book[]>;
}
