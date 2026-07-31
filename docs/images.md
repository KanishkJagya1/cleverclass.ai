# Filling in the images — step by step

Every image path in the site is derived from a **slug**. Get the slug right and the file lands in the right place automatically.

---

## 1. What the code currently expects

Generated in [`lib/data/seed.ts`](../frontend/lib/data/seed.ts):

| Asset | Path pattern | Count | Priority |
|---|---|---|---|
| Book front cover | `/covers/{book-slug}-front.jpg` | 324 | **Required** |
| Book back cover | `/covers/{book-slug}-back.jpg` | 324 | Optional |
| Book inside spread | `/covers/{book-slug}-inside.jpg` | 324 | Optional |
| Book preview pages | `/previews/{book-slug}-{1..6}.jpg` | 1,944 | Optional |
| Combo cover | `/covers/{combo-slug}-front.jpg` | 27 | Recommended |
| Key-note preview pages | `/notes/{note-slug}-{1..12}.jpg` | 720 | Optional |
| PWA icons | `/icons/icon-192.png`, `icon-512.png`, `maskable-512.png` | 3 | Required for PWA |

Everything lives under `frontend/public/`. That directory does not exist yet — create it.

**Do not try to produce 3,342 files.** Front covers plus icons — **327 files** — gets you a complete-looking site. Everything else is progressive enhancement, and the components already handle absence (the gallery only renders the thumbnails it's given; the preview reader only pages through what exists).

---

## 2. Slug format

```
{series}-{class}-{subject}-{medium}
```
lowercased, non-alphanumerics collapsed to `-`:

| Book | Slug | Front cover filename |
|---|---|---|
| Kohinoor Class 10 Science, Marathi | `kohinoor-10-science-marathi` | `kohinoor-10-science-marathi-front.jpg` |
| Spark Class 12 Physics, English | `spark-12-physics-english` | `spark-12-physics-english-front.jpg` |
| Kohinoor Class 12 Book Keeping & Accountancy, English | `kohinoor-12-book-keeping-accountancy-english` | `…-front.jpg` |

Combos: `{class}-complete-set-{medium}` → `10-complete-set-marathi-front.jpg`

Get the authoritative list rather than deriving it by hand:

```bash
cd frontend
npm run build
ls .next/server/app/shop/*.html | sed 's|.*/||; s|\.html$||' > slugs.txt
```

That gives you all 324 book slugs, one per line, exactly as the code expects them.

---

## 3. Recommended path: rename in bulk

You almost certainly have cover scans named something like `Kohinoor_Std10_Science_Mar.jpg`. Build a two-column mapping and let a script do the renaming.

**Step 1 — make a CSV**
```csv
source_file,slug
Kohinoor_Std10_Science_Mar.jpg,kohinoor-10-science-marathi
Kohinoor_Std10_Maths_Mar.jpg,kohinoor-10-mathematics-marathi
Spark_12_Physics.jpg,spark-12-physics-english
```

**Step 2 — rename, resize and convert**

```powershell
# Requires ImageMagick:  winget install ImageMagick.ImageMagick
$src = "D:\book-scans"
$out = "D:\Kohinoor\frontend\public\covers"
New-Item -ItemType Directory -Force $out | Out-Null

Import-Csv D:\cover-map.csv | ForEach-Object {
    $in = Join-Path $src $_.source_file
    if (Test-Path $in) {
        magick $in -resize 600x800^ -gravity center -extent 600x800 `
               -quality 82 -strip (Join-Path $out "$($_.slug)-front.jpg")
    } else {
        Write-Warning "missing: $($_.source_file)"
    }
}
```

`-resize 600x800^ -extent 600x800` forces the exact 3:4 ratio the layout expects — the `^` fills then crops rather than letterboxing. `-strip` removes EXIF, which is dead weight on a web image.

**Step 3 — find what's still missing**
```powershell
Get-Content D:\Kohinoor\frontend\slugs.txt | Where-Object {
    -not (Test-Path "D:\Kohinoor\frontend\public\covers\$_-front.jpg")
} | Set-Content D:\missing-covers.txt
```

---

## 4. Specifications

| Property | Value | Why |
|---|---|---|
| Aspect ratio | **3:4 exactly** (600×800) | The layout locks `.aspect-cover` at 3:4. Anything else gets cropped. |
| Format | JPEG source | Next converts to AVIF/WebP automatically — don't pre-optimise |
| Quality | 80–85 | Above 85 is invisible and doubles the file |
| File size | < 120 KB each | 324 × 120 KB ≈ 39 MB total |
| Colour | sRGB | Adobe RGB scans look washed out in browsers |
| Naming | lowercase, hyphens only | Vercel's filesystem is case-sensitive; Windows is not — this bites on deploy |

Preview pages differ: **1:1.35 portrait**, 1000px tall, quality 75. They're read in a modal, not scrutinised.

---

## 5. If your covers aren't on disk

**Option A — host them elsewhere.** `next.config.ts` already allows `kohinoortez.com` and `images.kohinoortez.com`. Upload to Cloudflare R2 or Cloudinary, then change the `cover()` helper in `seed.ts`:

```ts
const cover = (slug, kind, label) => ({
  src: `https://images.kohinoortez.com/covers/${slug}-${kind}.jpg`,
  // …
});
```

Add the host to `remotePatterns` if it's not one of the two already listed.

**Option B — scrape from the existing WooCommerce site.** The current site has real covers for every SKU. WooCommerce exposes them at `/wp-content/uploads/…`, and its product export CSV includes image URLs. That export gives you the source-file → slug mapping and the images in one pass — do this before the old site is taken down.

**Option C — placeholder first, real covers later.** Point `cover()` at a placeholder service so nothing looks broken while you gather assets. Fine for a demo, never for launch — a study-guide buyer is judging the book by its cover, literally.

---

## 6. PWA icons

Three files in `frontend/public/icons/`:

```powershell
$out = "D:\Kohinoor\frontend\public\icons"
New-Item -ItemType Directory -Force $out | Out-Null

magick logo.png -resize 192x192 "$out\icon-192.png"
magick logo.png -resize 512x512 "$out\icon-512.png"

# Maskable needs ~20% safe padding — Android crops icons to its own shape,
# and a logo drawn to the edge gets its corners cut off.
magick logo.png -resize 410x410 -background "#0A0C14" `
       -gravity center -extent 512x512 "$out\maskable-512.png"
```

Also add `frontend/app/icon.png` (any square PNG, ~512px) — Next turns that into the favicon automatically.

---

## 7. Verify

```bash
cd frontend
npm run dev
```

Check, in order: home hero (3 covers), `/shop` grid, a product page gallery (front/back tabs), `/combo-packs` (stacked covers), the ⌘K palette (thumbnails).

Then confirm nothing is silently 404ing:

```bash
# Watch the dev server output for 404s on /covers/* while browsing,
# or check the built output size:
du -sh public/covers
```

---

## 8. Worth doing: a cover fallback

Right now a missing image renders as a browser-broken-image icon, which looks worse than no image at all. A small `BookCover` wrapper with an `onError` fallback to a generated gradient plus the book title would make partial coverage look intentional rather than broken — useful while you're working through 324 files.

Not implemented. Ask if you want it — it's roughly 30 lines and it changes how the site looks during the entire migration.
