/**
 * The single line the whole app depends on.
 *
 * To move off seed data, implement `CatalogAdapter` against your source and
 * change this export. Nothing else in the codebase knows where books come from.
 *
 *   import { postgresAdapter } from "./postgres-adapter";
 *   export const catalog = postgresAdapter;
 */
import { seedAdapter } from "./seed-adapter";
import type { CatalogAdapter } from "./adapter";

export const catalog: CatalogAdapter = seedAdapter;

export type { CatalogAdapter };
