"use client";

import Image from "next/image";
import { useTheme } from "next-themes";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * CleverClass.AI logo — the supplied artwork, not a redraw.
 *
 * All variants are generated from one source file by `npm run brand:logo`
 * (scripts/prepare-logo.mjs), which trims the export's white background and
 * detects whether the lockup is horizontal or stacked.
 *
 * The supplied artwork is a HORIZONTAL lockup (emblem left, wordmark right)
 * at roughly 3.7:1, so the navbar can show the whole thing and still have the
 * wordmark be readable — that is the default here.
 */

const FULL_LIGHT = "/brand/logo-full.png";
const FULL_DARK = "/brand/logo-full-dark.png";
const MARK_LIGHT = "/brand/logo-mark.png";
const MARK_DARK = "/brand/logo-mark-dark.png";

/** Trimmed lockup aspect ratio, from the generated asset (1200x321). */
const LOCKUP_ASPECT = 1200 / 321;

function useIsDark() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  // Light is the default, so light art is the correct pre-hydration guess.
  return mounted && resolvedTheme === "dark";
}

/** Emblem only. For square slots — app icons, avatars, tight mobile chrome. */
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
      className={cn("object-contain", className)}
      style={{ height: size, width: size }}
    />
  );
}

/**
 * Full horizontal lockup, sized by HEIGHT — the only dimension chrome
 * actually constrains. Width follows the artwork's own ratio.
 */
export function LogoLockup({
  className,
  height = 38,
  priority,
  onDarkSurface,
}: {
  className?: string;
  height?: number;
  priority?: boolean;
  /**
   * For surfaces that stay dark in BOTH themes — the footer band. The
   * wordmark is navy and would vanish there, so the light artwork is shown
   * on a white plaque instead. Recolouring it would mean redrawing the logo.
   */
  onDarkSurface?: boolean;
}) {
  const dark = useIsDark();
  const src = onDarkSurface ? FULL_LIGHT : dark ? FULL_DARK : FULL_LIGHT;
  const width = Math.round(height * LOCKUP_ASPECT);

  const img = (
    <Image
      src={src}
      alt="CleverClass.AI — Learn smart. Grow bright."
      width={width}
      height={height}
      priority={priority}
      className={cn("object-contain", !onDarkSurface && className)}
      style={{ height, width }}
    />
  );

  if (!onDarkSurface) return img;

  return (
    <span
      className={cn(
        "inline-flex rounded-[var(--radius-lg)] bg-white px-4 py-3 shadow-[var(--shadow-md)]",
        className,
      )}
    >
      {img}
    </span>
  );
}

export function Logo({
  variant = "lockup",
  className,
  size,
  height,
  priority,
  onDarkSurface,
}: {
  variant?: "lockup" | "mark";
  className?: string;
  size?: number;
  height?: number;
  priority?: boolean;
  onDarkSurface?: boolean;
}) {
  return variant === "mark" ? (
    <LogoMark className={className} size={size} priority={priority} />
  ) : (
    <LogoLockup
      className={className}
      height={height}
      priority={priority}
      onDarkSurface={onDarkSurface}
    />
  );
}
