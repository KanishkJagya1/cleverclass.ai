import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { SITE } from "@/constants/catalog";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Whole rupees only — this catalog has no paise. */
export function formatPrice(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function discountPct(price: number, mrp?: number): number | null {
  if (!mrp || mrp <= price) return null;
  return Math.round(((mrp - price) / mrp) * 100);
}

/** Cart totals + the free-shipping gap that drives the meter and upsell. */
export function orderTotals(subtotal: number) {
  const qualifies = subtotal >= SITE.freeShippingThreshold;
  const shipping = subtotal === 0 || qualifies ? 0 : SITE.flatShippingRate;
  return {
    subtotal,
    shipping,
    total: subtotal + shipping,
    qualifies,
    amountToFreeShipping: Math.max(0, SITE.freeShippingThreshold - subtotal),
    progress: Math.min(100, (subtotal / SITE.freeShippingThreshold) * 100),
  };
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Read a repeatable search param. Next gives `string | string[] | undefined`,
 * and filters are multi-select, so every filter read goes through this.
 */
export function paramList(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : v.split(",")).filter(Boolean);
}

/** Build a URL preserving existing params — used by every filter control. */
export function buildQuery(
  base: URLSearchParams,
  patch: Record<string, string | string[] | number | undefined | null>,
): string {
  const next = new URLSearchParams(base);
  for (const [key, value] of Object.entries(patch)) {
    next.delete(key);
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => next.append(key, v));
    else next.set(key, String(value));
  }
  // Any filter change invalidates the current page.
  if (!("page" in patch)) next.delete("page");
  const s = next.toString();
  return s ? `?${s}` : "";
}

export function absoluteUrl(path = ""): string {
  return `${SITE.url}${path.startsWith("/") ? path : `/${path}`}`;
}
