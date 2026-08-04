import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Parallax depth — CSS scroll timelines, no JS. Server components.
 *
 * WHERE THIS BELONGS, and where it does not:
 *
 *   yes  hero backplate (mesh, blobs, rules)     decorative, absolutely positioned
 *   yes  class rail, series showcase, stats      below the fold, real payoff
 *   yes  section dividers, oversized numerals    free depth, no semantic risk
 *   NO   the hero headline and primary cover     this is the LCP — never move it
 *   NO   the /shop product grid                  a scanning surface; moving tiles
 *                                                while someone compares prices is
 *                                                hostile
 *   NO   /shop/[slug] above the fold             the gallery is lg:sticky already,
 *                                                and parallax fights sticky
 *   NO   the preview reader                      it is a reading surface
 *   NO   /cart, /checkout                        money screens; motion here reads
 *                                                as instability
 *   NO   /account, /admin                        tools, not marketing
 *
 * CLS contract: layers are absolutely positioned inside a ParallaxScene that
 * `contain: layout paint`, and they only ever `translate`. Nothing here can
 * change the height of the document or shift a sibling.
 */

/**
 * Positioning + containment context for a set of layers. Give it an explicit
 * height or aspect ratio — a scene sized by its parallax children would resize
 * as they move, which is the whole failure mode `contain` prevents.
 */
export function ParallaxScene({
  children,
  className,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section" | "header";
}) {
  return (
    <Tag data-parallax-scene="" className={cn("relative", className)}>
      {children}
    </Tag>
  );
}

/**
 * One depth layer. `depth` is a named token, not a pixel value, so no component
 * invents its own parallax distance:
 *
 *   1    10px  text blocks — barely perceptible, and that is correct
 *   2    26px  cards, cover art
 *   3    56px  pure decoration
 *   max  72px  hero backplate only
 */
export function ParallaxLayer({
  children,
  depth = 2,
  className,
  ariaHidden = true,
}: {
  children: React.ReactNode;
  depth?: 1 | 2 | 3 | "max";
  className?: string;
  /**
   * Layers are decorative by default and hidden from assistive tech. Set false
   * only when the layer carries real content — and then reconsider whether it
   * should be moving at all.
   */
  ariaHidden?: boolean;
}) {
  return (
    <div
      data-parallax={String(depth)}
      aria-hidden={ariaHidden || undefined}
      className={cn(ariaHidden && "pointer-events-none", className)}
    >
      {children}
    </div>
  );
}

/**
 * A reading-progress bar. `animation-timeline: scroll(root block)` needs no
 * scroll listener, so this stays a server component too.
 */
export function ScrollProgress({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-x-0 z-[var(--z-sticky)] h-[2px] origin-left",
        className,
      )}
      style={{ top: "var(--nav-h)" }}
    >
      <div
        data-scroll-progress=""
        className="h-full w-full"
        style={{ backgroundImage: "var(--grad-brand)" }}
      />
    </div>
  );
}

/**
 * Infinite logo/series strip. Time-based rather than scroll-linked, and
 * duplicated once so the -50% translate loops seamlessly.
 */
export function Marquee({
  children,
  seconds = 40,
  className,
}: {
  children: React.ReactNode;
  seconds?: number;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden", className)} aria-hidden>
      <div
        data-marquee=""
        style={{ "--marquee-duration": `${seconds}s` } as React.CSSProperties}
      >
        <div className="flex shrink-0 items-center">{children}</div>
        <div className="flex shrink-0 items-center">{children}</div>
      </div>
    </div>
  );
}
