/**
 * Motion barrel.
 *
 * Deliberately NOT "use client": re-exporting a server component from a client
 * module turns it into a client component, which would undo the whole point of
 * the CSS scroll-timeline rewrite. The client-only pieces carry their own
 * directive in ./client.
 */

// Server components — CSS scroll timelines, zero client JS.
export { Reveal, RevealItem, StickyStack } from "./reveal";
export { ParallaxScene, ParallaxLayer, ScrollProgress, Marquee } from "./parallax";

// Client components — pointer- and value-driven.
export {
  AnimatedHeading,
  CountUp,
  TiltCard,
  Magnetic,
  MeshBackground,
} from "./client";
