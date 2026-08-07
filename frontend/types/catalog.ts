/**
 * Catalog domain types.
 *
 * These are the contract between the UI and *any* data source. Components
 * import from here and never from a concrete data module — that indirection
 * is what lets the seed adapter be swapped for Postgres/Supabase/Sanity/
 * Payload/Shopify without touching a single component (D5, D7).
 */

export type Board = "state" | "cbse";
export type Medium = "marathi" | "semi-english" | "english";
export type Series = "kohinoor" | "spark" | "vidyamitra" | "winwings" | "ekatmik";
export type Stream = "science-pcm" | "science-pcb" | "science-pcbm" | "commerce" | "arts";
export type ClassId =
  | "nursery" | "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12" | "board-exam";
export type ProductFormat = "book" | "combo" | "key-note";

export interface Money {
  /** Selling price in whole rupees. No paise anywhere in this catalog. */
  price: number;
  /** Printed MRP. Undefined when there is no discount. */
  mrp?: number;
}

export interface CoverImage {
  src: string;
  alt: string;
  /** front | back | inside spread — drives the gallery tabs (D10). */
  kind: "front" | "back" | "inside";
  width: number;
  height: number;
  /** base64 LQIP generated at build time. */
  blurDataURL?: string;
}

export interface Book extends Money {
  id: string;
  slug: string;
  /**
   * Sold in print, as a download, or both. Optional so older cached payloads
   * still parse — absent means "printed only", which is what every book was
   * before e-books existed.
   */
  physicalAvailable?: boolean;
  ebookAvailable?: boolean;
  ebookPrice?: number | null;
  title: string;
  /** Devanagari title. Rendered with lang="mr" so it picks up --leading-deva. */
  titleMr?: string;
  series: Series;
  board: Board;
  classId: ClassId;
  medium: Medium;
  subject: string;
  stream?: Stream;
  images: CoverImage[];
  /** Free preview pages — no sign-up required (D1). */
  previewPages: string[];
  pages: number;
  isbn?: string;
  edition: string;
  description: string;
  highlights: string[];
  rating: number;
  reviewCount: number;
  inStock: boolean;
  bestSellerRank?: number;
  publishedAt: string;
  /** Slugs of the same title in other mediums — powers the medium switch. */
  variants?: string[];
  related?: string[];

  /**
   * How many pages of this book are readable for free, and how many it has in
   * total. Present ONLY when a PDF has been uploaded and free ranges set.
   *
   * Absent means there is no sample, and the preview CTA must not render — the
   * old `previewPages` array pointed at image files that never existed, so
   * every book advertised a sample that opened a modal of broken images.
   */
  freePageCount?: number;
  totalPages?: number;
}

export interface Combo extends Money {
  id: string;
  slug: string;
  title: string;
  titleMr?: string;
  board: Board;
  classId: ClassId;
  medium: Medium;
  stream?: Stream;
  /** Book slugs. Resolved to full books by the adapter. */
  itemSlugs: string[];
  images: CoverImage[];
  highlights: string[];
  description: string;
  rating: number;
  reviewCount: number;
  inStock: boolean;
  publishedAt: string;
}

/** Combo with its books resolved and the savings arithmetic done. */
export interface ComboResolved extends Combo {
  items: Book[];
  itemsTotal: number;
  savings: number;
  savingsPct: number;
}

export interface KeyNote {
  id: string;
  slug: string;
  title: string;
  titleMr?: string;
  classId: ClassId;
  subject: string;
  medium: Medium;
  board: Board;
  chapters: string[];
  /** Free pages shown in-browser without login (D1). */
  previewPages: string[];
  totalPages: number;
  /** The paid guide this note routes to — Phase 1 Flow C. */
  relatedBookSlug?: string;
  updatedAt: string;
}

export interface ClassNode {
  id: ClassId;
  label: string;
  labelMr: string;
  /** Short form for the class rail tiles. */
  short: string;
  boards: Board[];
  subjects: string[];
  streams?: Stream[];
  description: string;
  /** Board-year classes get a marker in the class rail. */
  highlight?: boolean;
}

export interface Review {
  id: string;
  productSlug: string;
  author: string;
  rating: number;
  title: string;
  body: string;
  date: string;
  verified: boolean;
}

/* ------------------------------------------------------------------------ */
/* Query surface                                                             */
/* ------------------------------------------------------------------------ */

export interface CatalogQuery {
  board?: Board;
  classId?: ClassId | ClassId[];
  medium?: Medium | Medium[];
  subject?: string | string[];
  series?: Series | Series[];
  stream?: Stream;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  q?: string;
  sort?: SortKey;
  page?: number;
  perPage?: number;
}

export type SortKey =
  | "relevance" | "popularity" | "rating" | "newest"
  | "price-asc" | "price-desc";

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface FacetCount {
  value: string;
  label: string;
  count: number;
}

export interface Facets {
  classId: FacetCount[];
  medium: FacetCount[];
  subject: FacetCount[];
  series: FacetCount[];
  priceRange: { min: number; max: number };
}

/* ------------------------------------------------------------------------ */
/* Cart                                                                      */
/* ------------------------------------------------------------------------ */

export interface CartItem {
  slug: string;
  format: ProductFormat;
  /**
   * How it arrives. Separate from `format` (what it IS) because the same
   * title can be bought in print and as a download at different prices, and
   * both can sit in one basket.
   */
  delivery: "physical" | "digital";
  title: string;
  titleMr?: string;
  price: number;
  mrp?: number;
  image: string;
  classId: ClassId;
  medium: Medium;
  qty: number;
}

export interface SearchHit {
  slug: string;
  title: string;
  titleMr?: string;
  subtitle: string;
  format: ProductFormat;
  href: string;
  image?: string;
  price?: number;
  /** Present only on semantic results from the AI backend (D8). */
  score?: number;

  /**
   * The real class and medium of this product.
   *
   * Required for a correct cart line. The assistant used to invent them, which
   * put the wrong medium in the cart — the single most expensive support issue
   * this business has. Consumers MUST link to the product page rather than add
   * to cart when these are absent; never substitute a default.
   */
  classId?: ClassId;
  medium?: Medium;
  mrp?: number;
  /** Deep link into the free-sample reader, when the book has free pages. */
  previewHref?: string;
  freePageCount?: number;
}
