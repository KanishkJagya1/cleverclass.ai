"use client";

import * as React from "react";
import Image from "next/image";
import { seriesById } from "@/constants/catalog";
import { cn } from "@/lib/utils";
import type { Series } from "@/types/catalog";

/**
 * A book cover that is never a broken image.
 *
 * The catalogue has ~324 titles and 98 cover files, and the seed generated
 * `-back.jpg` / `-inside.jpg` paths that were never downloaded at all. Rendering
 * `<Image src>` directly meant most of the shop grid, two of three gallery
 * thumbnails and the entire 3D flip resolved to 404s.
 *
 * When `src` is missing — or present but fails to load — this draws a designed
 * cover instead: series-tinted, typeset with the real title, and deterministic
 * from the slug so a book looks the same on every page and across every build.
 *
 * Deliberately not 324 pre-generated JPEGs committed to the repo: those go stale
 * the moment real art arrives, and this self-heals the instant a cover is
 * uploaded through the admin panel.
 */

/** FNV-1a, matching the hash the seed data uses. Stable across platforms. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Series accents are CSS custom properties, which cannot be read from inside an
 * SVG data URI. These are the resolved values from `styles/tokens.css` — keep
 * them in step if the ramps change.
 */
const SERIES_HEX: Record<Series, [string, string]> = {
  kohinoor: ["#4F46E5", "#312E81"],
  spark: ["#F59E0B", "#B45309"],
  vidyamitra: ["#059669", "#065F46"],
  winwings: ["#7C3AED", "#5B21B6"],
  ekatmik: ["#818CF8", "#4338CA"],
};

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
  );
}

/** Break a title across lines without a text measurement pass. */
function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (line.length + word.length + 1 <= perLine) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1]!.replace(/[\s,;:.-]+$/, "")}…`;
  }
  return lines;
}

function placeholderSvg(opts: {
  title: string;
  titleMr?: string;
  series?: Series;
  slug: string;
}): string {
  const { title, titleMr, series, slug } = opts;
  const [light, dark] = SERIES_HEX[series ?? "kohinoor"] ?? SERIES_HEX.kohinoor;

  // A small deterministic hue shift so a grid of placeholders reads as a shelf
  // of different books rather than one image repeated twenty times.
  const rotate = (hash(slug) % 24) - 12;
  const lines = wrap(title, 15, 4);
  const startY = 300 - (lines.length - 1) * 21;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800" role="img" aria-hidden="true">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${light}"/>
      <stop offset="1" stop-color="${dark}"/>
    </linearGradient>
    <filter id="h"><feColorMatrix type="hueRotate" values="${rotate}"/></filter>
  </defs>
  <rect width="600" height="800" fill="url(#g)" filter="url(#h)"/>
  <rect width="600" height="800" fill="none"/>
  <g opacity="0.10" fill="#fff">
    <circle cx="500" cy="120" r="170"/>
    <circle cx="90" cy="690" r="120"/>
  </g>
  <rect x="0" y="0" width="18" height="800" fill="#000" opacity="0.20"/>
  <rect x="56" y="120" width="64" height="4" fill="#fff" opacity="0.85"/>
  <g fill="#fff" font-family="'Space Grotesk','Segoe UI',system-ui,sans-serif" font-weight="700" font-size="42">
    ${lines
      .map((l, i) => `<text x="56" y="${startY + i * 52}">${escapeXml(l)}</text>`)
      .join("\n    ")}
  </g>
  ${
    titleMr
      ? `<text x="56" y="${startY + lines.length * 52 + 26}" fill="#fff" opacity="0.72" font-family="'Noto Sans Devanagari','Mukta',sans-serif" font-size="26">${escapeXml(
          titleMr.length > 26 ? `${titleMr.slice(0, 25)}…` : titleMr,
        )}</text>`
      : ""
  }
  <text x="56" y="726" fill="#fff" opacity="0.60" font-family="'Space Grotesk','Segoe UI',system-ui,sans-serif" font-size="20" letter-spacing="2">CLEVERCLASS.AI</text>
</svg>`;

  // encodeURIComponent rather than base64: it survives Devanagari correctly and
  // keeps the markup legible in devtools.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export interface CoverImageProps {
  src?: string | null;
  alt?: string;
  /** Used to typeset the generated cover when there is no real image. */
  title: string;
  titleMr?: string;
  series?: Series;
  slug: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
}

export function CoverImage({
  src,
  alt,
  title,
  titleMr,
  series,
  slug,
  sizes = "(max-width: 640px) 45vw, 22vw",
  priority,
  className,
}: CoverImageProps) {
  const [failed, setFailed] = React.useState(false);

  // A new src (medium switch, admin cover upload) deserves a fresh attempt.
  // Adjusted during render rather than in an effect: an effect would paint one
  // frame of the old fallback before clearing, and React flags the cascade.
  // https://react.dev/learn/you-might-not-need-an-effect
  const [renderedSrc, setRenderedSrc] = React.useState(src);
  if (src !== renderedSrc) {
    setRenderedSrc(src);
    setFailed(false);
  }

  const fallback = React.useMemo(
    () => placeholderSvg({ title, titleMr, series, slug }),
    [title, titleMr, series, slug],
  );

  const usingFallback = !src || failed;

  return (
    <Image
      src={usingFallback ? fallback : src}
      alt={alt ?? title}
      fill
      sizes={sizes}
      priority={priority}
      onError={() => setFailed(true)}
      // The generated SVG is already an optimised data URI; putting it through
      // the image optimiser would re-encode it for nothing.
      unoptimized={usingFallback}
      className={cn("object-cover", className)}
    />
  );
}

// `frontCover` lives in lib/utils.ts — server components need it too, and this
// module is "use client", which makes its exports uncallable from the server.
export { placeholderSvg };
