/**
 * Export the deterministic seed catalogue to JSON for the backend importer.
 *
 *   npm run export:seed            # writes ../backend/scripts/seed-export.json
 *   npm run export:seed -- --stdout
 *
 * Why a script instead of hand-writing the JSON: `lib/data/seed.ts` generates
 * ~325 books from the real taxonomy in `constants/catalog.ts`. Copying that
 * output by hand would go stale the first time the taxonomy changes, and the
 * variant links / best-seller ranks are computed, not authored.
 *
 * This runs once, at the seed -> database cutover. After that the database is
 * the source of truth and this script is only useful for rebuilding a dev box.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SEED_BOOKS, SEED_COMBOS, SEED_KEY_NOTES, SEED_REVIEWS } from "../lib/data/seed";
import { CLASSES, SERIES } from "../constants/catalog";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.resolve(HERE, "../../backend/scripts/seed-export.json");

/**
 * Combos never had a `stream`, which is why `/combo-packs?stream=science-pcm`
 * returned the unfiltered list — five landing cards and four mega-menu links
 * pointing at a filter that could not work. Infer it from the member books so
 * the links mean something the moment the data lands in the database.
 */
function inferStream(itemSlugs: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const slug of itemSlugs) {
    const stream = SEED_BOOKS.find((b) => b.slug === slug)?.stream;
    if (stream) counts.set(stream, (counts.get(stream) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

/**
 * Admin-authored chapter lists are what the sales bot uses to answer "does this
 * cover trigonometry?" without reading a single page of the book. The seed has
 * no real chapter data, so we derive a plausible starting list from the subject
 * and mark it clearly — the owner replaces it per book in the admin panel.
 */
function starterChapters(subject: string, pages: number): string[] {
  const n = Math.max(6, Math.min(18, Math.round(pages / 18)));
  return Array.from({ length: n }, (_, i) => `${subject} — Chapter ${i + 1}`);
}

async function main() {
  const stdout = process.argv.includes("--stdout");
  const outArg = process.argv.indexOf("--out");
  const outPath = outArg > -1 ? path.resolve(process.argv[outArg + 1]!) : DEFAULT_OUT;

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "frontend/lib/data/seed.ts",
    counts: {
      books: SEED_BOOKS.length,
      combos: SEED_COMBOS.length,
      keyNotes: SEED_KEY_NOTES.length,
      reviews: SEED_REVIEWS.length,
    },
    taxonomy: {
      classes: CLASSES.map((c) => ({ id: c.id, label: c.label, labelMr: c.labelMr })),
      series: SERIES.map((s) => ({ id: s.id, label: s.label })),
    },
    books: SEED_BOOKS.map((b) => ({
      ...b,
      // Dropped deliberately: these point at /previews/<slug>-N.jpg, and that
      // directory has never existed. Preview pages now come from an uploaded
      // PDF plus admin-set free ranges, so exporting dead paths would only
      // reintroduce the broken-image bug on the other side of the cutover.
      previewPages: undefined,
      chapterList: starterChapters(b.subject, b.pages),
      marketingCopy: "",
      status: "published",
    })),
    combos: SEED_COMBOS.map((c) => ({
      ...c,
      stream: c.stream ?? inferStream(c.itemSlugs),
      status: "published",
    })),
    keyNotes: SEED_KEY_NOTES.map((k) => ({
      ...k,
      previewPages: undefined,
      status: "published",
    })),
    reviews: SEED_REVIEWS,
  };

  const json = JSON.stringify(payload, null, 2);

  if (stdout) {
    process.stdout.write(json);
    return;
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, json, "utf8");

  const withStream = payload.combos.filter((c) => c.stream).length;
  console.log(`wrote ${outPath}`);
  console.log(
    `  ${payload.counts.books} books · ${payload.counts.combos} combos ` +
      `(${withStream} with an inferred stream) · ${payload.counts.keyNotes} key notes ` +
      `· ${payload.counts.reviews} reviews`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
