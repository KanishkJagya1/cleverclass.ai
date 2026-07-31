"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Layers } from "lucide-react";
import { classById, mediumById } from "@/constants/catalog";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { SavingsMeter } from "./atoms";
import { cn, formatPrice } from "@/lib/utils";
import type { ComboResolved } from "@/types/catalog";

/**
 * Combos are the AOV engine (Phase 1 §7). The card leads with the arithmetic,
 * not a percentage badge — for this buyer the persuasive unit is rupees saved.
 * The stacked covers make "this is several books" legible before any text.
 */
export function ComboCard({
  combo,
  className,
  featured,
}: {
  combo: ComboResolved;
  className?: string;
  featured?: boolean;
}) {
  const cls = classById(combo.classId);
  const medium = mediumById(combo.medium);
  const href = `/combo-packs/${combo.slug}`;

  return (
    <article
      className={cn(
        "surface-card group relative flex flex-col overflow-hidden",
        featured && "md:flex-row",
        className,
      )}
    >
      {/* Fanned covers — offset stack, rotated slightly, first three only. */}
      <div
        className={cn(
          "relative flex items-end gap-0 overflow-hidden bg-[var(--brand-soft)] p-6",
          featured ? "md:w-2/5 md:p-10" : "h-44",
        )}
      >
        <div className="flex w-full items-end justify-center">
          {combo.items.slice(0, 4).map((b, i) => (
            <div
              key={b.slug}
              className="relative aspect-cover w-16 shrink-0 overflow-hidden rounded-[var(--radius-xs)] bg-white shadow-[var(--shadow-md)] transition-transform duration-[var(--duration-slow)] ease-[var(--ease-standard)] group-hover:-translate-y-1 motion-reduce:group-hover:translate-y-0"
              style={{
                marginLeft: i === 0 ? 0 : "-1.25rem",
                rotate: `${(i - 1.5) * 4}deg`,
                zIndex: i,
                transitionDelay: `${i * 40}ms`,
              }}
            >
              {b.images[0] && (
                <Image src={b.images[0].src} alt="" fill sizes="64px" className="object-cover" />
              )}
            </div>
          ))}
        </div>

        <Badge variant="glass" className="absolute right-3 top-3">
          <Layers className="size-3" aria-hidden />
          {combo.items.length} books
        </Badge>
      </div>

      <div className="flex flex-1 flex-col p-5 md:p-6">
        <div className="flex flex-wrap gap-2">
          <Badge variant="brand">{cls?.label}</Badge>
          <Badge>{medium?.label}</Badge>
        </div>

        <Link href={href} className="mt-3">
          <span className="absolute inset-0" aria-hidden />
          <h3
            className={cn(
              "font-[family-name:var(--font-display)] font-semibold text-[var(--text-1)]",
              featured ? "text-[length:var(--text-2xl)]" : "text-[length:var(--text-lg)]",
            )}
          >
            {combo.title}
          </h3>
        </Link>

        {featured && (
          <p className="mt-2 max-w-md text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-[var(--text-2)]">
            {combo.description}
          </p>
        )}

        <div className="mt-5">
          <SavingsMeter
            itemsTotal={combo.itemsTotal}
            price={combo.price}
            savings={combo.savings}
            savingsPct={combo.savingsPct}
          />
        </div>

        <div className="relative z-10 mt-5 flex items-center gap-3">
          <Button asChild size={featured ? "md" : "sm"}>
            <Link href={href}>
              View combo
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
          {combo.price >= 200 && (
            <span className="text-[length:var(--text-xs)] font-medium text-[var(--signal-gain)]">
              Free shipping
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

/** Compact row used inside class hubs, where the combo sits above the books. */
export function ComboBanner({ combo }: { combo: ComboResolved }) {
  return (
    <div className="surface-card relative flex flex-col gap-5 overflow-hidden p-5 sm:flex-row sm:items-center sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[var(--brand-soft)] to-transparent opacity-70"
      />
      <div className="relative flex -space-x-5">
        {combo.items.slice(0, 3).map((b, i) => (
          <div
            key={b.slug}
            className="relative aspect-cover w-12 overflow-hidden rounded-[var(--radius-xs)] bg-white shadow-[var(--shadow-sm)]"
            style={{ rotate: `${(i - 1) * 5}deg`, zIndex: i }}
          >
            {b.images[0] && <Image src={b.images[0].src} alt="" fill sizes="48px" className="object-cover" />}
          </div>
        ))}
      </div>

      <div className="relative flex-1">
        <p className="text-[length:var(--text-2xs)] font-semibold uppercase tracking-[var(--tracking-wide)] text-[var(--text-brand)]">
          Recommended · save {formatPrice(combo.savings)}
        </p>
        <h3 className="mt-1 font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-[var(--text-1)]">
          {combo.title}
        </h3>
        <p className="mt-0.5 text-[length:var(--text-sm)] text-[var(--text-2)]">
          {combo.items.length} books covering every core subject · one delivery
        </p>
      </div>

      <div className="relative flex items-center gap-4">
        <div className="text-right">
          <p className="tabular text-[length:var(--text-xl)] font-semibold text-[var(--text-1)]">
            {formatPrice(combo.price)}
          </p>
          <p className="tabular text-[length:var(--text-xs)] text-[var(--text-3)] line-through">
            {formatPrice(combo.itemsTotal)}
          </p>
        </div>
        <Button asChild>
          <Link href={`/combo-packs/${combo.slug}`}>
            View set
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}
