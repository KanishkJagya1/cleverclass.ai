"use client";

import Image from "next/image";
import { useTheme } from "next-themes";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * CleverClass.AI logo — the supplied artwork, not a redraw.
 *
 * All four files are generated from one source image by `npm run brand:logo`
 * (scripts/prepare-logo.mjs). Save your logo to
 * `public/brand/logo-source.png` and run it.
 *
 * The navbar uses the emblem alone because the wordmark is illegible below
 * about 90px wide; the footer uses the full lockup, where there is room for it.
 */

const MARK_LIGHT = "/brand/logo-mark.png";
const MARK_DARK = "/brand/logo-mark-dark.png";
const FULL_LIGHT = "/brand/logo-full.png";
const FULL_DARK = "/brand/logo-full-dark.png";

function useIsDark() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  // Light is the default, so light art is also the correct pre-hydration guess.
  return mounted && resolvedTheme === "dark";
}

export function LogoMark({
  className,
  size = 40,
  priority,
}: {
  className?: string;
  size?: number;
  priority?: boolean;
}) {
  const dark = useIsDark();
  return (
    <Image
      src={dark ? MARK_DARK : MARK_LIGHT}
      alt=""
      width={size}
      height={size}
      priority={priority}
      className={cn("h-auto w-auto object-contain", className)}
      style={{ height: size, width: size }}
    />
  );
}

export function LogoFull({
  className,
  width = 190,
  priority,
  onDarkSurface,
}: {
  className?: string;
  width?: number;
  priority?: boolean;
  /**
   * For surfaces that are dark regardless of theme — the footer band, the
   * dark home sections. The artwork's wordmark is navy and disappears on
   * those, so the original light artwork is shown on a white plaque instead.
   * Recolouring the supplied logo would mean redrawing it.
   */
  onDarkSurface?: boolean;
}) {
  const dark = useIsDark();
  const src = onDarkSurface ? FULL_LIGHT : dark ? FULL_DARK : FULL_LIGHT;

  const img = (
    <Image
      src={src}
      alt="CleverClass.AI — Learn smart. Grow bright."
      width={width}
      height={Math.round(width * 0.78)}
      priority={priority}
      className={cn("h-auto object-contain", !onDarkSurface && className)}
      style={{ width }}
    />
  );

  if (!onDarkSurface) return img;

  return (
    <span
      className={cn(
        "inline-flex rounded-[var(--radius-lg)] bg-white p-3 shadow-[var(--shadow-md)]",
        className,
      )}
    >
      {img}
    </span>
  );
}

/**
 * Default lockup for chrome. `variant="mark"` in tight spaces (navbar),
 * `variant="full"` where the wordmark can actually be read (footer, auth).
 */
export function Logo({
  variant = "mark",
  className,
  size,
  width,
  priority,
  onDarkSurface,
}: {
  variant?: "mark" | "full";
  className?: string;
  size?: number;
  width?: number;
  priority?: boolean;
  onDarkSurface?: boolean;
}) {
  return variant === "full" ? (
    <LogoFull
      className={className}
      width={width}
      priority={priority}
      onDarkSurface={onDarkSurface}
    />
  ) : (
    <LogoMark className={className} size={size} priority={priority} />
  );
}
