/**
 * Runtime validation for every catalogue response.
 *
 * Why parse at all when the types already say what the shape is: `tsconfig` has
 * `strict` and `noUncheckedIndexedAccess`, which makes the compiler pedantic
 * about data it *can* see — and completely blind to data crossing a network
 * boundary. Without this, a backend field rename surfaces as
 * "cannot read properties of undefined" inside a component three levels down.
 * With it, it surfaces here, named, at the boundary.
 *
 * zod is already a dependency (react-hook-form resolvers), so this costs nothing new.
 */
import { z } from "zod";

/* Enums are deliberately NOT z.enum(...) --------------------------------------
 * A new class or series added in the admin panel must not 500 the shop page
 * because the frontend build predates it. These stay `string` at runtime; the
 * TS types keep the narrow unions for authoring.
 * -------------------------------------------------------------------------- */

export const coverImageSchema = z.object({
  src: z.string(),
  alt: z.string(),
  kind: z.enum(["front", "back", "inside"]),
  width: z.number(),
  height: z.number(),
  blurDataURL: z.string().optional(),
});

export const bookSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  titleMr: z.string().optional(),
  series: z.string(),
  board: z.string(),
  classId: z.string(),
  medium: z.string(),
  subject: z.string(),
  stream: z.string().optional(),
  price: z.number(),
  mrp: z.number().optional(),
  images: z.array(coverImageSchema).default([]),
  previewPages: z.array(z.string()).default([]),
  pages: z.number(),
  isbn: z.string().optional(),
  edition: z.string(),
  description: z.string(),
  highlights: z.array(z.string()).default([]),
  rating: z.number(),
  reviewCount: z.number(),
  inStock: z.boolean(),
  bestSellerRank: z.number().optional(),
  publishedAt: z.string(),
  variants: z.array(z.string()).optional(),
  related: z.array(z.string()).optional(),
  // Added by the preview layer. Absent until a PDF is uploaded and free ranges
  // are set — which is exactly when the "Read N pages free" CTA should appear.
  freePageCount: z.number().optional(),
  totalPages: z.number().optional(),
});

export const comboSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  titleMr: z.string().optional(),
  board: z.string(),
  classId: z.string(),
  medium: z.string(),
  stream: z.string().optional(),
  price: z.number(),
  mrp: z.number().optional(),
  itemSlugs: z.array(z.string()).default([]),
  images: z.array(coverImageSchema).default([]),
  highlights: z.array(z.string()).default([]),
  description: z.string(),
  rating: z.number(),
  reviewCount: z.number(),
  inStock: z.boolean(),
  publishedAt: z.string(),
});

export const comboResolvedSchema = comboSchema.extend({
  items: z.array(bookSchema).default([]),
  itemsTotal: z.number(),
  savings: z.number(),
  savingsPct: z.number(),
});

export const keyNoteSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  titleMr: z.string().optional(),
  classId: z.string(),
  subject: z.string(),
  medium: z.string(),
  board: z.string(),
  chapters: z.array(z.string()).default([]),
  previewPages: z.array(z.string()).default([]),
  totalPages: z.number(),
  relatedBookSlug: z.string().optional(),
  updatedAt: z.string(),
});

export const reviewSchema = z.object({
  id: z.string(),
  productSlug: z.string(),
  author: z.string(),
  rating: z.number(),
  title: z.string(),
  body: z.string(),
  date: z.string(),
  verified: z.boolean(),
});

export const facetCountSchema = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number(),
});

export const facetsSchema = z.object({
  classId: z.array(facetCountSchema).default([]),
  medium: z.array(facetCountSchema).default([]),
  subject: z.array(facetCountSchema).default([]),
  series: z.array(facetCountSchema).default([]),
  priceRange: z.object({ min: z.number(), max: z.number() }),
});

export const searchHitSchema = z.object({
  slug: z.string(),
  title: z.string(),
  titleMr: z.string().optional(),
  subtitle: z.string(),
  format: z.enum(["book", "combo", "key-note"]),
  href: z.string(),
  image: z.string().optional(),
  price: z.number().optional(),
  score: z.number().optional(),
  // Carried so the assistant can add the RIGHT variant to the cart. When these
  // are absent the UI must link to the product page instead of guessing.
  classId: z.string().optional(),
  medium: z.string().optional(),
  mrp: z.number().optional(),
  previewHref: z.string().optional(),
  freePageCount: z.number().optional(),
});

export const catalogExportSchema = z.object({
  books: z.array(z.string()).default([]),
  combos: z.array(z.string()).default([]),
  keyNotes: z.array(z.string()).default([]),
  generatedAt: z.string(),
});

export const pageRangeSchema = z.object({ start: z.number(), end: z.number() });

export const previewManifestSchema = z.object({
  slug: z.string(),
  title: z.string(),
  totalPages: z.number(),
  freeRanges: z.array(pageRangeSchema).default([]),
  freePageCount: z.number(),
  pages: z
    .array(
      z.object({
        n: z.number(),
        url: z.string(),
        thumb: z.string(),
        w: z.number(),
        h: z.number(),
      }),
    )
    .default([]),
});

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item).default([]),
    total: z.number(),
    page: z.number(),
    perPage: z.number(),
    totalPages: z.number(),
  });
}

/**
 * Parse or throw with a message that names the endpoint and the offending
 * field. zod's default error is unreadable in a server log.
 */
export function parse<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  context: string,
): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const issues = result.error.issues
    .slice(0, 4)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new Error(
    `Catalogue API returned an unexpected shape for ${context} — ${issues}. ` +
      `The backend and frontend are out of sync.`,
  );
}
