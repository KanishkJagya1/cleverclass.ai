/**
 * Derive every brand asset from ONE source file.
 *
 *   1. Save your logo as  frontend/public/brand/logo-source.png
 *   2. npm run brand:logo
 *
 * Produces, all from that single file — no manual cropping:
 *   public/brand/logo-full.png    trimmed full lockup (mark + wordmark + tagline)
 *   public/brand/logo-mark.png    just the emblem, for the navbar
 *   public/brand/logo-full-dark.png / logo-mark-dark.png
 *                                 same art on a transparent background, for dark mode
 *   public/icons/icon-192.png     PWA
 *   public/icons/icon-512.png     PWA
 *   public/icons/maskable-512.png PWA, with the safe padding Android needs
 *   app/icon.png                  favicon
 *
 * Flags:
 *   --mark-height <0-1>   fraction of the trimmed lockup that is the emblem
 *                         (default 0.60 — the wordmark starts below this)
 *   --keep-white          skip white-background removal for the dark variants
 */

import { mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "public", "brand", "logo-source.png");
const BRAND_DIR = path.join(ROOT, "public", "brand");
const ICONS_DIR = path.join(ROOT, "public", "icons");
const APP_DIR = path.join(ROOT, "app");

const argv = process.argv.slice(2);
const num = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
};
const MARK_FRACTION = num("mark-height", 0.6);
const KEEP_WHITE = argv.includes("--keep-white");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(SRC))) {
  console.error(`
Source logo not found.

  Save your logo image to:
      frontend/public/brand/logo-source.png

  PNG or JPG, square-ish, at least 1000px on the long edge.
  Then run this again:  npm run brand:logo
`);
  process.exit(1);
}

await mkdir(BRAND_DIR, { recursive: true });
await mkdir(ICONS_DIR, { recursive: true });

/* -------------------------------------------------------------------------- */
/* 1. Trim the flat background the artwork was exported on                     */
/* -------------------------------------------------------------------------- */
const trimmed = await sharp(SRC).trim({ threshold: 12 }).toBuffer();
const meta = await sharp(trimmed).metadata();
console.log(`  source trimmed to ${meta.width}x${meta.height}`);

/* -------------------------------------------------------------------------- */
/* 2. Full lockup                                                             */
/* -------------------------------------------------------------------------- */
await sharp(trimmed)
  .resize({ width: Math.min(1200, meta.width), withoutEnlargement: true })
  .png({ compressionLevel: 9 })
  .toFile(path.join(BRAND_DIR, "logo-full.png"));

/* -------------------------------------------------------------------------- */
/* 3. Emblem only.                                                            */
/* The wordmark is unreadable at navbar size, so the navbar uses the mark      */
/* alone. Crop the top band, then re-trim so it is tight on its own bounds.    */
/* -------------------------------------------------------------------------- */
const markBand = Math.round(meta.height * MARK_FRACTION);
const markBuf = await sharp(trimmed)
  .extract({ left: 0, top: 0, width: meta.width, height: markBand })
  .trim({ threshold: 12 })
  .toBuffer();

const markMeta = await sharp(markBuf).metadata();
// Pad to a square so the navbar mark never changes aspect between builds.
const side = Math.max(markMeta.width, markMeta.height);
const markSquare = await sharp({
  create: {
    width: side,
    height: side,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: markBuf, gravity: "centre" }])
  .png()
  .toBuffer();

await sharp(markSquare)
  .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toFile(path.join(BRAND_DIR, "logo-mark.png"));

console.log(`  mark cropped to ${markMeta.width}x${markMeta.height} → 512x512`);

/* -------------------------------------------------------------------------- */
/* 4. Dark-mode variants.                                                     */
/* The artwork ships on white. On a near-black canvas a white rectangle around */
/* the logo looks broken, so knock the white out to transparency.              */
/* -------------------------------------------------------------------------- */
async function knockOutWhite(buf) {
  if (KEEP_WHITE) return buf;
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // Near-white pixels become transparent; a soft ramp avoids a hard, jagged
    // edge around the antialiased artwork.
    const min = Math.min(r, g, b);
    if (min > 244) data[i + 3] = 0;
    else if (min > 228) data[i + 3] = Math.round(((min - 228) / 16) * 0 + (1 - (min - 228) / 16) * 255);
  }

  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png()
    .toBuffer();
}

await sharp(await knockOutWhite(trimmed))
  .resize({ width: Math.min(1200, meta.width), withoutEnlargement: true })
  .png({ compressionLevel: 9 })
  .toFile(path.join(BRAND_DIR, "logo-full-dark.png"));

const markDark = await knockOutWhite(markSquare);
await sharp(markDark)
  .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toFile(path.join(BRAND_DIR, "logo-mark-dark.png"));

/* -------------------------------------------------------------------------- */
/* 5. Icons                                                                   */
/* -------------------------------------------------------------------------- */
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

for (const size of [192, 512]) {
  await sharp(markDark)
    .resize(size, size, { fit: "contain", background: WHITE })
    .flatten({ background: WHITE })
    .png({ compressionLevel: 9 })
    .toFile(path.join(ICONS_DIR, `icon-${size}.png`));
}

// Maskable needs ~20% safe padding: Android crops icons to its own shape, and
// artwork drawn to the edge loses its corners.
await sharp(markDark)
  .resize(410, 410, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .extend({
    top: 51, bottom: 51, left: 51, right: 51,
    background: WHITE,
  })
  .flatten({ background: WHITE })
  .png({ compressionLevel: 9 })
  .toFile(path.join(ICONS_DIR, "maskable-512.png"));

// Next.js turns app/icon.png into the favicon automatically.
await sharp(markDark)
  .resize(512, 512, { fit: "contain", background: WHITE })
  .flatten({ background: WHITE })
  .png({ compressionLevel: 9 })
  .toFile(path.join(APP_DIR, "icon.png"));

console.log(`
  ✓ public/brand/logo-full.png        full lockup
  ✓ public/brand/logo-mark.png        emblem (navbar)
  ✓ public/brand/logo-full-dark.png   transparent background
  ✓ public/brand/logo-mark-dark.png   transparent background
  ✓ public/icons/icon-192.png
  ✓ public/icons/icon-512.png
  ✓ public/icons/maskable-512.png
  ✓ app/icon.png                      favicon

  If the emblem crop looks wrong, tune it:
      npm run brand:logo -- --mark-height 0.55
`);
