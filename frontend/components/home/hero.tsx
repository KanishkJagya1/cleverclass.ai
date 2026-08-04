"use client";


import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  AnimatedHeading,
  Magnetic,
  MeshBackground,
  ParallaxLayer,
  TiltCard,
} from "@/components/motion";
import { Button } from "@/components/ui/button";
import { CoverImage } from "@/components/ui/cover-image";
import { cn, frontCover } from "@/lib/utils";
import type { Book } from "@/types/catalog";

const TRUST = [
  { value: "325+", label: "titles in print" },
  { value: "12", label: "classes covered" },
  { value: "5", label: "book series" },
  { value: "₹200+", label: "ships free" },
];

/**
 * No carousel. Hero carousels see ~1% engagement past slide 1 and push LCP
 * into the second image. One statement, one showcase, one decision.
 *
 * The showcase is a CSS-3D fanned stack (D6) — R3F is reserved for a single
 * lazy desktop-only enhancement, not the LCP element.
 */
export function Hero({ books }: { books: Book[] }) {
  const reduced = useReducedMotion();
  const stack = books.slice(0, 3);

  return (
    <section
      data-parallax-scene=""
      className="relative isolate overflow-hidden bg-[var(--surface-canvas)] pb-16 pt-14 md:pb-24 md:pt-20"
    >
      {/* Decorative backplate only. The parallax layers here are absolutely
          positioned and carry no content, so they can never move the LCP
          element or change the height of the document.

          The headline, the trust strip and the centre cover deliberately sit
          OUTSIDE any parallax layer — the centre cover is the LCP, and an LCP
          element that translates on scroll is how you lose the metric you were
          trying to decorate. */}
      <ParallaxLayer depth="max" className="absolute inset-0">
        <MeshBackground className="size-full" />
      </ParallaxLayer>

      <ParallaxLayer depth={3} className="absolute inset-0">
        <div
          className="absolute -right-24 top-[-6rem] size-[26rem] rounded-full opacity-[0.07] blur-3xl"
          style={{ backgroundImage: "var(--grad-brand)" }}
        />
        <div
          className="absolute -left-32 bottom-[-8rem] size-[22rem] rounded-full opacity-[0.06] blur-3xl"
          style={{ backgroundImage: "var(--grad-ai)" }}
        />
      </ParallaxLayer>

      <div className="container-page relative">
        <div className="grid min-w-0 items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
          {/* ------------------------------------------------------ copy -- */}
          <div className="min-w-0">
            <motion.p
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="glass-panel !rounded-full inline-flex items-center gap-2 !border-[var(--border-glass)] px-3.5 py-1.5 text-[length:var(--text-xs)] font-medium text-[color:var(--text-2)]"
            >
              <Sparkles className="size-3.5 text-[color:var(--brand-base)]" aria-hidden />
              Maharashtra State Board · CBSE · Nursery to 12th
            </motion.p>

            <AnimatedHeading
              text="Every subject. Every class. One trusted guide."
              delay={0.1}
              className="mt-6 max-w-[15ch] text-[length:var(--text-6xl)] font-semibold text-[color:var(--text-1)]"
            />

            <motion.p
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.42, ease: [0.16, 1, 0.3, 1] }}
              className="mt-6 max-w-lg text-[length:var(--text-lg)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]"
            >
              Chapter-wise guides, key notes and combo packs published in Nagpur
              since 1998 — in Marathi, Semi-English and English medium.
            </motion.p>

            <motion.div
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.52, ease: [0.16, 1, 0.3, 1] }}
              className="mt-9 flex flex-wrap items-center gap-3"
            >
              <Magnetic>
                <Button asChild size="lg" className="sheen">
                  <Link href="/shop">
                    Shop now
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              </Magnetic>
              <Button asChild size="lg" variant="secondary">
                <Link href="/combo-packs">Explore combo packs</Link>
              </Button>
            </motion.div>

            {/* Trust strip. Real catalog numbers above the fold answer the
                parent's actual first question — "will you have my child's
                exact book?" — without a stats section eight scrolls later. */}
            <motion.ul
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.66 }}
              className="mt-12 flex flex-wrap gap-x-8 gap-y-4 border-t border-[var(--border-1)] pt-6"
            >
              {TRUST.map((t) => (
                <li key={t.label}>
                  <p className="tabular font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-bold text-[color:var(--text-1)]">
                    {t.value}
                  </p>
                  <p className="mt-0.5 text-[length:var(--text-xs)] text-[color:var(--text-3)]">{t.label}</p>
                </li>
              ))}
            </motion.ul>
          </div>

          {/* -------------------------------------------------- showcase -- */}
          <div className="relative">
            <TiltCard max={9} className="mx-auto max-w-md">
              <div className="relative flex items-end justify-center gap-0 py-6">
                {stack.map((book, i) => {
                  const offset = i - 1;
                  return (
                    <motion.div
                      key={book.slug}
                      initial={reduced ? false : { opacity: 0, y: 40, rotate: 0 }}
                      animate={{ opacity: 1, y: 0, rotate: offset * 7 }}
                      transition={{
                        duration: 0.85,
                        delay: 0.2 + i * 0.1,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      style={{
                        zIndex: i === 1 ? 3 : 1,
                        translateZ: i === 1 ? 40 : 0,
                      }}
                      /* Width AND overlap both scale. At the old fixed
                         w-40/-3.5rem the fan measured 368px against 320px of
                         usable width on a 360px phone — clipped silently,
                         because body uses overflow-x: clip. */
                      className={cn(
                        "relative aspect-cover shrink-0 overflow-hidden rounded-[var(--radius-md)]",
                        "bg-white shadow-[var(--shadow-xl)]",
                        "w-28 xs:w-32 sm:w-36 md:w-40",
                        i > 0 && "-ml-8 xs:-ml-10 sm:-ml-12",
                      )}
                    >
                      <CoverImage
                        src={frontCover(book.images)?.src}
                        alt={book.title}
                        title={book.title}
                        titleMr={book.titleMr}
                        series={book.series}
                        slug={book.slug}
                        // Only the centre cover is LCP-critical.
                        priority={i === 1}
                        sizes="(max-width: 640px) 40vw, 12rem"
                      />
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-y-0 left-0 w-4 bg-gradient-to-r from-black/25 to-transparent"
                      />
                    </motion.div>
                  );
                })}
              </div>
            </TiltCard>

            {/* Floating glass detail — one, not five. */}
            <motion.div
              initial={reduced ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, delay: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className="glass-panel glass-edge absolute -bottom-2 left-0 hidden !rounded-[var(--radius-lg)] px-4 py-3 sm:block"
            >
              <p className="text-[length:var(--text-2xs)] font-semibold uppercase tracking-[var(--tracking-wide)] text-[color:var(--signal-gain)]">
                Combo saving
              </p>
              <p className="tabular mt-0.5 font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-bold text-[color:var(--text-1)]">
                ₹140
              </p>
              <p className="text-[length:var(--text-xs)] text-[color:var(--text-3)]">on the Class 10 set</p>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
