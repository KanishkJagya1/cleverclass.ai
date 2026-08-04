import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Scroll-triggered entrance — CSS scroll timeline, zero client JS.
 *
 * These are SERVER components. The previous implementation was `"use client"`
 * and pulled `motion/react` into every home-page section that used it, which is
 * most of them. The keyframes now live in `styles/motion.css` and this only
 * stamps a data attribute.
 *
 * It also fixes a real hydration bug by construction. The old version did:
 *
 *     const reduced = useReducedMotion();
 *     if (reduced) return <Tag>{children}</Tag>;
 *     return <MotionTag …>
 *
 * `useReducedMotion()` is `null` on the server and resolves after mount, so for
 * a reduced-motion user the server rendered one element type and the client
 * rendered another. There is no branch here at all — the element type is the
 * same in every render and reduced motion is handled entirely in CSS.
 */

type RevealTag = "div" | "section" | "li" | "article" | "header" | "figure";

export function Reveal({
  children,
  delay = 0,
  y = 16,
  className,
  as: Tag = "div",
  ...rest
}: {
  children: React.ReactNode;
  /** Seconds, matching the old motion API so call sites need no edit. */
  delay?: number;
  /** Travel distance in px. */
  y?: number;
  className?: string;
  as?: RevealTag;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      data-reveal=""
      className={className}
      style={
        {
          animationDelay: delay ? `${delay}s` : undefined,
          "--reveal-y": `${y}px`,
        } as React.CSSProperties
      }
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Staggered siblings. `index` spaces them without threading delays through. */
export function RevealItem({
  children,
  index = 0,
  className,
  as = "div",
  ...rest
}: {
  children: React.ReactNode;
  index?: number;
  className?: string;
  as?: RevealTag;
} & React.HTMLAttributes<HTMLElement>) {
  // Capped: a 24-card grid at 60ms each would take 1.4s to finish revealing,
  // by which point the user has already scrolled past it.
  return (
    <Reveal as={as} delay={Math.min(index * 0.06, 0.36)} className={className} {...rest}>
      {children}
    </Reveal>
  );
}

/**
 * A group of cards that stick and settle as the next one arrives. Pure CSS —
 * see `[data-stack]` in motion.css.
 */
export function StickyStack({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-stack="" className={cn("space-y-4", className)}>
      {children}
    </div>
  );
}
