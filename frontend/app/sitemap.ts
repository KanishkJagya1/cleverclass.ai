import type { MetadataRoute } from "next";
import { catalog } from "@/lib/data";
import { CLASSES, SERIES } from "@/constants/catalog";
import { absoluteUrl, slugify } from "@/lib/utils";

/**
 * ~380 URLs. Priorities are deliberate rather than uniform: class hubs are the
 * primary organic landing pages, so they outrank individual product pages.
 *
 * Cached for a day. Without this the route re-reads the entire catalogue on
 * every crawler hit, and Googlebot fetches a sitemap far more often than the
 * catalogue actually changes.
 */
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes = [
    { path: "/", priority: 1.0, freq: "daily" as const },
    { path: "/shop", priority: 0.9, freq: "daily" as const },
    { path: "/combo-packs", priority: 0.9, freq: "weekly" as const },
    { path: "/class", priority: 0.8, freq: "weekly" as const },
    { path: "/key-notes", priority: 0.8, freq: "weekly" as const },
    { path: "/about", priority: 0.5, freq: "yearly" as const },
    { path: "/contact", priority: 0.5, freq: "yearly" as const },
    { path: "/faqs", priority: 0.5, freq: "monthly" as const },
    { path: "/shipping", priority: 0.3, freq: "yearly" as const },
    { path: "/returns", priority: 0.3, freq: "yearly" as const },
    { path: "/privacy", priority: 0.2, freq: "yearly" as const },
    { path: "/terms", priority: 0.2, freq: "yearly" as const },
  ];

  const [bookSlugs, comboSlugs, keyNotes] = await Promise.all([
    catalog.getAllBookSlugs(),
    catalog.getAllComboSlugs(),
    // Read through the adapter rather than importing the seed module, so the
    // sitemap describes the live catalogue instead of the generated one.
    catalog.getKeyNotes(),
  ]);

  // Key-note detail routes are class+subject, deduped across mediums.
  const noteRoutes = [
    ...new Set(keyNotes.map((n) => `/key-notes/${n.classId}/${slugify(n.subject)}`)),
  ];
  const noteClassRoutes = [...new Set(keyNotes.map((n) => `/key-notes/${n.classId}`))];

  return [
    ...staticRoutes.map((r) => ({
      url: absoluteUrl(r.path),
      lastModified: now,
      changeFrequency: r.freq,
      priority: r.priority,
    })),
    ...CLASSES.map((c) => ({
      url: absoluteUrl(`/class/${c.id}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.85,
    })),
    ...SERIES.map((s) => ({
      url: absoluteUrl(`/series/${s.id}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...comboSlugs.map((slug) => ({
      url: absoluteUrl(`/combo-packs/${slug}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.75,
    })),
    ...bookSlugs.map((slug) => ({
      url: absoluteUrl(`/shop/${slug}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...noteClassRoutes.map((path) => ({
      url: absoluteUrl(path),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...noteRoutes.map((path) => ({
      url: absoluteUrl(path),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.65,
    })),
  ];
}
