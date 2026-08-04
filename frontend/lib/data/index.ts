/**
 * The single line the whole app depends on.
 *
 * Every data read in the storefront goes through `catalog`. Which source backs
 * it is decided here and nowhere else — no component knows or cares.
 *
 *   CATALOG_SOURCE=seed              deterministic seed data, no backend needed
 *   CATALOG_SOURCE=api               the real catalogue API
 *   (unset)                          api when CATALOG_API_URL is set, else seed
 *
 * In development the API adapter is wrapped so a stopped backend degrades to
 * seed data with a loud warning. In production it is NOT wrapped: serving
 * invented prices to a customer is worse than showing an error page.
 */
import { seedAdapter } from "./seed-adapter";
import { apiAdapter } from "./api-adapter";
import { withFallback } from "./fallback-adapter";
import type { CatalogAdapter } from "./adapter";

const source =
  process.env.CATALOG_SOURCE ??
  (process.env.CATALOG_API_URL || process.env.BACKEND_URL ? "api" : "seed");

export const catalog: CatalogAdapter =
  source === "seed"
    ? seedAdapter
    : process.env.NODE_ENV === "production"
      ? apiAdapter
      : withFallback(apiAdapter, seedAdapter);

/** True when the catalogue is real. Surfaces the "demo data" banner in dev. */
export const isLiveCatalog = catalog.name === "api";

export { getCatalogExport } from "./api-adapter";
export type { CatalogAdapter };
