"use client";

import * as React from "react";
import { motion, useInView, useReducedMotion, useSpring, useTransform, useMotionValue } from "motion/react";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------------------
   Reveal — scroll-triggered entrance.
   Renders content visible by default and animates from a transform, so the
   SSR'd HTML is never blank and there is no CLS if JS is slow or absent.
   -------------------------------------------------------------------------- */
export function Reveal({
  children,
  delay = 0,
  y = 16,
  className,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: "div" | "section" | "li" | "article";
}) {
  const reduced = useReducedMotion();
  const MotionTag = motion[Tag] as typeof motion.div;

  if (reduced) return <Tag className={className}>{children}</Tag>;

  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.62, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </MotionTag>
  );
}

/** Staggered children. `index` spaces siblings without threading delays. */
export function RevealItem({
  children,
  index = 0,
  className,
}: {
  children: React.ReactNode;
  index?: number;
  className?: string;
}) {
  // Cap the stagger: a 24-card grid at 60ms each would take 1.4s to finish.
  return (
    <Reveal delay={Math.min(index * 0.06, 0.36)} className={className}>
      {children}
    </Reveal>
  );
}

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
  if (reduced) return <Tag className={className}>{text}</Tag>;

  return (
    <Tag className={className}>
      {/* Accessible copy for AT; the animated copy is hidden from it. */}
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-block">
        {text.split(" ").map((word, i) => (
          <span key={`${word}-${i}`} className="inline-block overflow-hidden align-bottom">
            <motion.span
              className="inline-block"
              initial={{ y: "110%" }}
              animate={{ y: 0 }}
              transition={{ duration: 0.7, delay: delay + i * 0.05, ease: [0.16, 1, 0.3, 1] }}
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
