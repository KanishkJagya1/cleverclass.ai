/**
 * Development-only safety net: if the API is down, fall back to seed data so a
 * laptop without the backend running is still useful.
 *
 * Deliberately NOT enabled in production. Silently serving fabricated books and
 * invented prices to a real customer is a far worse failure than an error page:
 * they place an order for a title that does not exist at a price we never set.
 * In production `index.ts` wires the bare `apiAdapter`, an error propagates, and
 * `error.tsx` renders.
 */
import type { CatalogAdapter } from "./adapter";

export function withFallback(
  primary: CatalogAdapter,
  backup: CatalogAdapter,
): CatalogAdapter {
  const warned = new Set<string>();

  return new Proxy(primary, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || prop === "name") return value;

      return async (...args: unknown[]) => {
        try {
          return await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        } catch (err) {
          const key = String(prop);
          if (!warned.has(key)) {
            warned.add(key);
            console.warn(
              `\n[catalog] ${key}() failed against the API — serving SEED data instead.\n` +
                `          This fallback is development-only. Prices and stock are fake.\n` +
                `          ${err instanceof Error ? err.message : String(err)}\n`,
            );
          }
          const fn = Reflect.get(backup, prop) as (...a: unknown[]) => Promise<unknown>;
          if (typeof fn !== "function") throw err;
          return fn.apply(backup, args);
        }
      };
    },
  }) as CatalogAdapter;
}
