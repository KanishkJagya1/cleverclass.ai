"use client";

import * as React from "react";
import {
  motion,
  useInView,
  useReducedMotion,
  useSpring,
  useTransform,
  useMotionValue,
} from "motion/react";
import { cn } from "@/lib/utils";

/* ==========================================================================
   Pointer- and value-driven motion: the cases CSS genuinely cannot express.
   ==========================================================================

   Everything scroll-linked moved to ./reveal and ./parallax as CSS scroll
   timelines. What is left needs a real runtime:

     AnimatedHeading  per-word entrance (needs a split, then per-word delays)
     CountUp          animates a NUMBER, not a style
     TiltCard         reads pointer position
     Magnetic         reads pointer position
     MeshBackground   trivial, but lives with its siblings

   These stay client components, and only the handful of files that use them
   pay for motion/react.
   -------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
   AnimatedHeading — word-level stagger. Splits on words, never characters:
   character splitting destroys screen-reader output and breaks Devanagari
   conjuncts (क्ष would read as three unrelated glyphs).
   -------------------------------------------------------------------------- */
export function AnimatedHeading({
  text,
  className,
  as: Tag = "h1",
  delay = 0,
}: {
  text: string;
  className?: string;
  as?: "h1" | "h2" | "h3";
  delay?: number;
}) {
  const reduced = useReducedMotion();
  // No early return for reduced motion. `useReducedMotion()` is null on the
  // server and resolves after mount, so branching on it here rendered a
  // different element tree on server and client — the same hydration mismatch
  // the old Reveal had. The tree is identical either way now; only the
  // animation is skipped.

  return (
    <Tag className={className}>
      {/* Accessible copy for AT; the animated copy is hidden from it. */}
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-block">
        {text.split(" ").map((word, i) => (
          <span key={`${word}-${i}`} className="inline-block overflow-hidden align-bottom">
            <motion.span
              className="inline-block"
              initial={reduced ? false : { y: "110%" }}
              animate={{ y: 0 }}
              transition={
                reduced
                  ? { duration: 0 }
                  : { duration: 0.7, delay: delay + i * 0.05, ease: [0.16, 1, 0.3, 1] }
              }
            >
              {word}
              {i < text.split(" ").length - 1 && " "}
            </motion.span>
          </span>
        ))}
      </span>
    </Tag>
  );
}

/* --------------------------------------------------------------------------
   CountUp — statistics. Animates only once, only in view.
   -------------------------------------------------------------------------- */
export function CountUp({
  to,
  suffix = "",
  duration = 1.6,
  className,
}: {
  to: number;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const reduced = useReducedMotion();
  const [value, setValue] = React.useState(0);

  React.useEffect(() => {
    if (!inView) return;
    if (reduced) return setValue(to);

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / (duration * 1000));
      // easeOutExpo — matches --ease-out-expo so counters feel like the rest.
      setValue(Math.round(to * (p === 1 ? 1 : 1 - Math.pow(2, -10 * p))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration, reduced]);

  return (
    <span ref={ref} className={cn("tabular", className)}>
      {value.toLocaleString("en-IN")}
      {suffix}
    </span>
  );
}

/* --------------------------------------------------------------------------
   TiltCard — CSS 3D, no R3F (D6). Pointer-driven, springs back on leave.
   Disabled on coarse pointers: a tilt you cannot see is wasted computation.
   -------------------------------------------------------------------------- */
export function TiltCard({
  children,
  className,
  max = 8,
}: {
  children: React.ReactNode;
  className?: string;
  max?: number;
}) {
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const spring = { stiffness: 180, damping: 18, mass: 0.4 };
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [max, -max]), spring);
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-max, max]), spring);

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={cn("[transform-style:preserve-3d]", className)}
      style={{ rotateX, rotateY, perspective: 900 }}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left) / r.width - 0.5);
        y.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

/* --------------------------------------------------------------------------
   MagneticButton — cursor attraction. Mouse only, small displacement.
   -------------------------------------------------------------------------- */
export function Magnetic({
  children,
  strength = 0.28,
  className,
}: {
  children: React.ReactNode;
  strength?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const x = useSpring(0, { stiffness: 260, damping: 20 });
  const y = useSpring(0, { stiffness: 260, damping: 20 });

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={cn("inline-block", className)}
      style={{ x, y }}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

/* --------------------------------------------------------------------------
   MeshBackground — the "floating blobs / particles" of the brief, as a single
   static paint. No canvas, no rAF loop, no particle library.
   -------------------------------------------------------------------------- */
export function MeshBackground({ className }: { className?: string }) {
  return <div aria-hidden className={cn("mesh-ambient", className)} />;
}
