import Link from "next/link";
import { absoluteUrl, cn } from "@/lib/utils";

/**
 * One breadcrumb, used everywhere.
 *
 * This markup was copy-pasted across seven route files — same classes, same
 * `<span className="mx-2">/</span>` separator, and each copy free to drift. The
 * product page additionally hand-built its own `BreadcrumbList` JSON-LD, so the
 * visible trail and the structured data were two separate sources of truth that
 * could disagree.
 *
 * The last item is the current page: rendered as text, never a link, and marked
 * `aria-current="page"`.
 */

export interface Crumb {
  label: string;
  /** Omit on the final crumb — you are already there. */
  href?: string;
}

export function Breadcrumb({
  items,
  schema = false,
  className,
}: {
  items: Crumb[];
  /** Emit BreadcrumbList JSON-LD alongside the visible trail. */
  schema?: boolean;
  className?: string;
}) {
  if (items.length === 0) return null;

  const jsonLd = schema
    ? {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map((item, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: item.label,
          ...(item.href ? { item: absoluteUrl(item.href) } : {}),
        })),
      }
    : null;

  return (
    <>
      <nav
        aria-label="Breadcrumb"
        className={cn(
          "mb-6 text-[length:var(--text-sm)] text-[color:var(--text-3)]",
          className,
        )}
      >
        <ol className="flex flex-wrap items-center">
          {items.map((item, i) => {
            const last = i === items.length - 1;
            return (
              <li key={`${item.label}-${i}`} className="flex items-center">
                {i > 0 && (
                  <span aria-hidden className="mx-2 select-none text-[color:var(--text-3)]">
                    /
                  </span>
                )}
                {last || !item.href ? (
                  <span aria-current={last ? "page" : undefined} className="text-[color:var(--text-2)]">
                    {item.label}
                  </span>
                ) : (
                  <Link
                    href={item.href}
                    className="transition-colors duration-[var(--duration-fast)] hover:text-[color:var(--text-brand)]"
                  >
                    {item.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
    </>
  );
}
