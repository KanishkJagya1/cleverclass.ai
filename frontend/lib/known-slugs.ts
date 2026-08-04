/**
 * The set of slugs that actually exist, cached in module scope for the
 * middleware slug guard.
 *
 * WHY THIS EXISTS
 *
 * `/shop/[slug]` is an ISR route. When a request arrives for a slug that is not
 * in `generateStaticParams`, Next renders it on demand and writes the result to
 * the on-disk cache — `<slug>.html`, `.rsc`, `.meta`, `.segments`, about 40 KB
 * per slug. It does this for misses too, because cacheability is decided per
 * route, not per outcome: the route "succeeded", it just rendered the not-found
 * UI. Nothing evicts those entries.
 *
 * So an unauthenticated visitor requesting `/shop/aaa1`, `/shop/aaa2`, … writes
 * 40 KB each, without limit. This host also runs the LMS, and its disk is the
 * shared resource that takes everything down when it fills. Measured, not
 * assumed: 100k requests is ~4 GB.
 *
 * Middleware is the only layer that can know the slug is bad *before* the route
 * renders, which is what stops the cache entry from being created at all.
 *
 * FAILS OPEN, ALWAYS. If the catalogue API is unreachable or slow, this returns
 * null and the guard does nothing — the route renders as it always did. A guard
 * that 404s real books during a backend blip is far worse than the disk it
 * saves.
 */

type Cache = { slugs: Set<string>; at: number };

let cache: Cache | null = null;
let inflight: Promise<Cache | null> | null = null;

/** Refresh interval. Long enough to be nearly free, short enough that a newly
 *  published book becomes reachable without a redeploy. The admin panel's
 *  revalidate hook clears this immediately on save, so this is only the
 *  backstop. */
const TTL_MS = 10 * 60 * 1000;

const API = process.env.CATALOG_API_URL ?? "";

async function load(): Promise<Cache | null> {
  if (!API) return null;
  try {
    const controller = new AbortController();
    // Middleware sits in front of every storefront request. A hung fetch here
    // would stall the whole site, so the budget is deliberately tiny — on
    // timeout we fail open rather than wait.
    const timer = setTimeout(() => controller.abort(), 1500);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (process.env.BACKEND_API_KEY) headers["X-API-Key"] = process.env.BACKEND_API_KEY;

    const [books, combos] = await Promise.all([
      fetch(`${API}/catalog/books/slugs`, { headers, signal: controller.signal }),
      fetch(`${API}/catalog/combos/slugs`, { headers, signal: controller.signal }),
    ]);
    clearTimeout(timer);
    if (!books.ok || !combos.ok) return null;

    const b: unknown = await books.json();
    const c: unknown = await combos.json();
    if (!Array.isArray(b) || !Array.isArray(c)) return null;
    // An empty catalogue would 404 the entire storefront. Treat it as a failed
    // load, not as "nothing exists".
    if (b.length === 0) return null;

    return { slugs: new Set([...b, ...c].map(String)), at: Date.now() };
  } catch {
    return null;
  }
}

/** Drop the cache so the next request reloads. Called by the revalidate hook. */
export function invalidateKnownSlugs(): void {
  cache = null;
}

/**
 * `true` / `false` when we know, `null` when we do not — callers must treat
 * null as "let the route decide".
 */
export async function slugExists(slug: string): Promise<boolean | null> {
  const fresh = cache && Date.now() - cache.at < TTL_MS;
  if (!fresh) {
    // Collapse concurrent refreshes into one request.
    inflight ??= load().finally(() => {
      inflight = null;
    });
    const loaded = await inflight;
    if (loaded) cache = loaded;
  }
  if (!cache) return null;
  return cache.slugs.has(slug);
}
