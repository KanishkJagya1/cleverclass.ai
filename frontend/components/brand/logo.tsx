import { cn } from "@/lib/utils";

/**
 * CleverClass.AI brand lockup.
 *
 * Authored as SVG rather than an image file so it stays crisp at every size,
 * inherits theme colours, and costs no network request in the navbar — which
 * renders on every single page.
 *
 * `idPrefix` exists because gradient ids are document-global. The navbar and
 * the footer both render a logo, and two `<linearGradient id="g1">` in one
 * document is invalid markup that browsers resolve unpredictably.
 */

const BRAND = {
  blueDeep: "#1B3A93",
  blueMid: "#2563EB",
  blueLight: "#3B82F6",
  green: "#43A047",
  greenLight: "#66BB6A",
  amber: "#F59E0B",
  amberLight: "#FBBF24",
} as const;

export function LogoMark({
  className,
  idPrefix = "cc",
}: {
  className?: string;
  idPrefix?: string;
}) {
  const arc = `${idPrefix}-arc`;
  const bulb = `${idPrefix}-bulb`;
  const book = `${idPrefix}-book`;

  return (
    <svg
      viewBox="0 0 48 48"
      className={cn("size-8", className)}
      role="img"
      aria-label="CleverClass.AI"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={arc} x1="4" y1="6" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor={BRAND.blueDeep} />
          <stop offset="1" stopColor={BRAND.blueLight} />
        </linearGradient>
        <linearGradient id={bulb} x1="16" y1="9" x2="30" y2="27" gradientUnits="userSpaceOnUse">
          <stop stopColor={BRAND.amberLight} />
          <stop offset="1" stopColor={BRAND.amber} />
        </linearGradient>
        <linearGradient id={book} x1="6" y1="38" x2="42" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor={BRAND.blueMid} />
          <stop offset="1" stopColor={BRAND.green} />
        </linearGradient>
      </defs>

      {/* The C — open on the right, where the digital squares break out of it */}
      <path
        d="M34.5 11.5A15 15 0 1 0 34.5 34"
        stroke={`url(#${arc})`}
        strokeWidth="4.5"
        strokeLinecap="round"
      />

      {/* Idea rays */}
      <g stroke={BRAND.amberLight} strokeWidth="1.6" strokeLinecap="round" opacity="0.9">
        <path d="M23 7v2.4" />
        <path d="M16.2 9.6l1.4 2" />
        <path d="M29.8 9.6l-1.4 2" />
        <path d="M13.4 15.4l2.2.9" />
        <path d="M32.6 15.4l-2.2.9" />
      </g>

      {/* Bulb */}
      <path
        d="M23 11.4a7 7 0 0 1 4.2 12.6v1.6h-8.4V24A7 7 0 0 1 23 11.4Z"
        fill={`url(#${bulb})`}
      />
      {/* Pencil inside the bulb — the mark's whole idea in one detail */}
      <path d="M23 14.6l2.4 4.2h-4.8L23 14.6Z" fill="#0F2557" opacity="0.85" />
      <path d="M20.6 18.8h4.8v4.1h-4.8z" fill="#0F2557" opacity="0.2" />
      {/* Screw base */}
      <rect x="19.9" y="26.4" width="6.2" height="1.5" rx="0.75" fill="#0F2557" opacity="0.75" />
      <rect x="20.6" y="28.6" width="4.8" height="1.5" rx="0.75" fill="#0F2557" opacity="0.75" />

      {/* Open book */}
      <path
        d="M23 40.5 6.5 35.8v-4.9L23 35.6v4.9Zm0 0 16.5-4.7v-4.9L23 35.6v4.9Z"
        fill={`url(#${book})`}
      />

      {/* Digital squares — the .AI half of the name */}
      <g>
        <rect x="36.4" y="13.2" width="3.4" height="3.4" rx="0.7" fill={BRAND.blueLight} />
        <rect x="41" y="16.6" width="3" height="3" rx="0.6" fill={BRAND.greenLight} />
        <rect x="37.4" y="20.4" width="2.4" height="2.4" rx="0.5" fill={BRAND.blueMid} />
      </g>
    </svg>
  );
}

/**
 * Wordmark. `clever class` inherits the surrounding text colour so it works on
 * both the dark chrome and the light surfaces; only `.AI` carries the brand
 * gradient — the original artwork's navy wordmark would be invisible on the
 * dark canvas this site now uses.
 */
export function LogoWordmark({
  className,
  idPrefix = "cw",
}: {
  className?: string;
  idPrefix?: string;
}) {
  const grad = `${idPrefix}-ai`;
  return (
    <span
      className={cn(
        "font-[family-name:var(--font-display)] font-bold tracking-[var(--tracking-tight)]",
        className,
      )}
    >
      cleverclass
      <svg width="0" height="0" aria-hidden className="absolute">
        <defs>
          <linearGradient id={grad} x1="0" y1="0" x2="1" y2="0">
            <stop stopColor={BRAND.blueLight} />
            <stop offset="1" stopColor={BRAND.greenLight} />
          </linearGradient>
        </defs>
      </svg>
      <span
        style={{
          backgroundImage: `linear-gradient(90deg, ${BRAND.blueLight}, ${BRAND.greenLight})`,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        .AI
      </span>
    </span>
  );
}

export function Logo({
  className,
  markClassName,
  wordClassName,
  idPrefix = "cc",
  showTagline,
}: {
  className?: string;
  markClassName?: string;
  wordClassName?: string;
  idPrefix?: string;
  showTagline?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={markClassName} idPrefix={idPrefix} />
      <span className="flex flex-col leading-none">
        <LogoWordmark className={wordClassName} idPrefix={`${idPrefix}-w`} />
        {showTagline && (
          <span className="mt-1 text-[length:var(--text-2xs)] font-medium uppercase tracking-[var(--tracking-wide)] text-[var(--text-3)]">
            Learn smart. Grow bright.
          </span>
        )}
      </span>
    </span>
  );
}
