/**
 * Download, match, process and organise every book cover from kohinoortez.com.
 *
 *   npm run download:covers
 *
 * Source: the live WooCommerce Store API (`/wp-json/wc/store/v1/products`),
 * which is public, unauthenticated, paginated and returns structured JSON with
 * image URLs and category taxonomy. No HTML scraping, no Playwright — rendering
 * a page to read data the server already hands you as JSON is wasted work.
 *
 * Flags:
 *   --refresh          re-fetch the product list instead of using the cache
 *   --force            re-download and reprocess covers that already exist
 *   --allow-reuse      let one product cover serve several slugs (see §MATCHING)
 *   --min-score <n>    matching threshold (default 10)
 *   --concurrency <n>  parallel downloads (default 4)
 *   --dry-run          match and report, write no images
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { SEED_BOOKS, SEED_COMBOS } from "../lib/data/seed";
import type { Book, ClassId, Combo, Medium, Series } from "../types/catalog";

/* ========================================================================== */
/* Config                                                                     */
/* ========================================================================== */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COVERS_DIR = path.join(ROOT, "public", "covers");
const CACHE_DIR = path.join(ROOT, "scripts", ".cache");
const PRODUCTS_CACHE = path.join(CACHE_DIR, "products.json");
const REPORT_PATH = path.join(ROOT, "download-report.json");
const MISSING_PATH = path.join(ROOT, "missing-covers.txt");
const UNMATCHED_PATH = path.join(ROOT, "unmatched-products.txt");
const SCRAPED_CATALOG = path.join(CACHE_DIR, "catalog-scraped.json");

const API = "https://kohinoortez.com/wp-json/wc/store/v1/products";
const PER_PAGE = 100;

const COVER_WIDTH = 600;
const COVER_HEIGHT = 800;
const JPEG_QUALITY = 82;

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback: number) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
};

const OPTS = {
  refresh: flag("refresh"),
  force: flag("force"),
  allowReuse: flag("allow-reuse"),
  dryRun: flag("dry-run"),
  minScore: opt("min-score", 10),
  concurrency: Math.max(1, Math.min(8, opt("concurrency", 4))),
};

/* ========================================================================== */
/* Types                                                                      */
/* ========================================================================== */

interface WooProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  images: { id: number; src: string; thumbnail?: string; alt?: string }[];
  categories: { id: number; name: string; slug: string }[];
  prices?: { price?: string; regular_price?: string };
}

/** A product reduced to the same taxonomy axes the project uses. */
interface ProductFacts {
  product: WooProduct;
  title: string;
  imageUrl: string | null;
  classId: ClassId | null;
  series: Series | null;
  medium: Medium | null;
  subjects: string[];
  board: "state" | "cbse";
  isCombo: boolean;
  tokens: Set<string>;
}

interface Target {
  slug: string;
  kind: "book" | "combo";
  title: string;
  classId: ClassId;
  series: Series | null;
  medium: Medium;
  subject: string | null;
  board: "state" | "cbse";
}

interface ReportRow {
  slug: string;
  productTitle: string | null;
  productId: number | null;
  productUrl: string | null;
  imageUrl: string | null;
  savedFile: string | null;
  score: number | null;
  status: "downloaded" | "skipped-exists" | "failed" | "unmatched" | "dry-run";
  reason?: string;
}

/* ========================================================================== */
/* Normalisation                                                              */
/* ========================================================================== */

const HTML_ENTITIES: Record<string, string> = {
  "&#038;": "&", "&amp;": "&", "&#8211;": "-", "&ndash;": "-",
  "&#8212;": "-", "&mdash;": "-", "&#8217;": "'", "&rsquo;": "'",
  "&#8216;": "'", "&quot;": '"', "&#039;": "'", "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&#?\w+;/g, (m) => HTML_ENTITIES[m] ?? m);
}

/** Devanagari digits appear in titles like "इयत्ता १०वी". */
const DEVANAGARI_DIGITS = "०१२३४५६७८९";
function normaliseDigits(s: string): string {
  return s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
}

const ROMAN: Record<string, string> = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6",
  vii: "7", viii: "8", ix: "9", x: "10", xi: "11", xii: "12",
};

function normalise(s: string): string {
  return normaliseDigits(decodeEntities(s))
    .toLowerCase()
    .replace(/[|–—_/(),.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Class                                                                      */
/* -------------------------------------------------------------------------- */

function extractClass(text: string, categories: string[]): ClassId | null {
  const cats = categories.map(normalise).join(" ");
  const hay = `${cats} ${normalise(text)}`;

  if (/\bnursery\b|pre[\s-]?primary|\bkg\b/.test(hay)) return "nursery";

  // Categories are the most reliable signal: "Class 10th", "kohinoor 9th".
  const catMatch = cats.match(/\b(?:class|std|standard)?\s*(\d{1,2})\s*(?:th|st|nd|rd)?\b/);
  if (catMatch?.[1]) {
    const n = Number(catMatch[1]);
    if (n >= 5 && n <= 12) return String(n) as ClassId;
  }

  const titleMatch = hay.match(/\b(?:class|std|standard|इयत्ता)\s*\.?\s*(\d{1,2})/);
  if (titleMatch?.[1]) {
    const n = Number(titleMatch[1]);
    if (n >= 5 && n <= 12) return String(n) as ClassId;
  }

  // "Class X", "Std. XII"
  const roman = hay.match(/\b(?:class|std|standard)\s*\.?\s*(x{0,2}i{0,3}v?i{0,3})\b/);
  if (roman?.[1] && ROMAN[roman[1]]) {
    const n = Number(ROMAN[roman[1]]);
    if (n >= 5 && n <= 12) return String(n) as ClassId;
  }

  if (/\bssc\b/.test(hay)) return "10";
  if (/\bhsc\b|\bfyjc\b/.test(hay)) return /\bfyjc\b/.test(hay) ? "11" : "12";

  return null;
}

/* -------------------------------------------------------------------------- */
/* Series                                                                     */
/* -------------------------------------------------------------------------- */

const SERIES_PATTERNS: [Series, RegExp][] = [
  ["kohinoor", /kohinoor|कोहिनूर/],
  ["spark", /\bspark\b/],
  ["vidyamitra", /vidyamitra|vidyamitr|विद्यमित्र|विद्यामित्र/],
  ["winwings", /winwings?|विनविंग्स/],
  ["ekatmik", /ekatmik|एकात्मिक/],
];

function extractSeries(text: string, categories: string[]): Series | null {
  const hay = `${categories.map(normalise).join(" ")} ${normalise(text)}`;
  for (const [series, re] of SERIES_PATTERNS) if (re.test(hay)) return series;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Medium                                                                     */
/* -------------------------------------------------------------------------- */

function extractMedium(text: string, categories: string[]): Medium | null {
  const cats = categories.map(normalise).join(" ");
  const hay = `${cats} ${normalise(text)}`;

  // Order matters: "semi english" contains "english".
  if (/semi[\s-]*english|अर्ध[\s-]*इंग्रजी|सेमी[\s-]*इंग्लिश|सेमी[\s-]*इंग्रजी/.test(hay))
    return "semi-english";
  if (/marathi\s*medium|मराठी\s*माध्यम|\bmarathi\s*combo\b|\bmarathi\b\s*(?:pack|set|book)/.test(hay))
    return "marathi";
  if (/english\s*medium|इंग्रजी\s*माध्यम|\benglish\s*combo\b/.test(hay)) return "english";

  // Weak fallbacks from category names only.
  if (/\bmarathi\b/.test(cats)) return "marathi";
  if (/\benglish\b/.test(cats)) return "english";

  return null; // genuinely unknown — treated as neutral, never penalised hard
}

/* -------------------------------------------------------------------------- */
/* Subject                                                                    */
/* -------------------------------------------------------------------------- */

/** Canonical subject → the aliases that appear in real product titles,
 *  including Marathi transliterations and NCERT chapter-book names. */
const SUBJECT_ALIASES: [string, RegExp][] = [
  ["Book Keeping & Accountancy", /book\s*keeping|bookkeeping|accountancy|accounts|पुस्तपालन|लेखाकर्म/],
  ["Political Science", /political\s*science|democratic\s*politics|civics|rajyashastra|राज्यशास्त्र|नागरिकशास्त्र/],
  ["Social Science", /social\s*science|samajik|समाजशास्त्र|sociology/],
  ["Mathematics", /mathematic|\bmaths?\b|ganit|गणित|algebra|geometry|बीजगणित|भूमिती/],
  ["Physics", /physics|भौतिक/],
  ["Chemistry", /chemistry|रसायन/],
  ["Biology", /biology|जीवशास्त्र|jeev/],
  ["Geography", /geograph|bhugol|भूगोल|contemporary\s*india/],
  ["History", /history|itihas|इतिहास/],
  ["Economics", /economic|arthashastra|अर्थशास्त्र/],
  ["Sanskrit", /sanskrit|संस्कृत|amod|mandarah/],
  ["Hindi", /\bhindi\b|हिंदी|lokbharati|sulabhbharati|लोकभारती|सुलभभारती/],
  // Checked before Marathi: "My English" / "First Flight" are English readers.
  ["English", /\benglish\b|first\s*flight|footprints|my\s*english|kumarbharati\s*english/],
  ["Marathi", /\bmarathi\b|मराठी|balbharati|बालभारती|kumarbharati|कुमारभारती|aksharbharati/],
  // Broadest last: "Science & Technology", "Vigyan va Tantragyan".
  ["Science", /science|vigyan|vidnyan|vignyan|विज्ञान|tantragyan|tantradnyan|तंत्रज्ञान|technology/],
];

/**
 * Medium phrases must be removed BEFORE subject detection.
 *
 * English, Marathi and Hindi are each both a medium and a subject. Left in,
 * "Organization of Commerce (English Medium)" reads as the subject English,
 * and "Ganit Bhag 2 | Marathi & Semi English Medium Guide" reads as Marathi —
 * both produce a confidently wrong cover. Consume the medium once, then look
 * for the subject in what remains.
 */
const MEDIUM_NOISE = [
  /marathi\s*(?:&|and)?\s*semi[\s-]*english\s*medium/g,
  /semi[\s-]*english\s*medium/g,
  /semi[\s-]*english/g,
  /english\s*medium/g,
  /marathi\s*medium/g,
  /hindi\s*medium/g,
  // Devanagari forms. The conjunction variants ("मराठी व अर्ध-इंग्रजी",
  // Marathi *and* semi-English) appear without माध्यम, so they need their own
  // patterns — and they must be listed before the bare मराठी माध्यम rule.
  /मराठी\s*(?:व|आणि|&|and)\s*अर्ध[\s-]*इंग्रजी(?:\s*माध्यम)?/g,
  /मराठी\s*(?:व|आणि|&|and)\s*सेमी[\s-]*इंग्लिश(?:\s*माध्यम)?/g,
  /मराठी\s*माध्यम\s*(?:व|आणि|&|and)\s*अर्ध[\s-]*इंग्रजी/g,
  /मराठी\s*माध्यम/g,
  /अर्ध[\s-]*इंग्रजी/g,
  /सेमी[\s-]*इंग्लिश/g,
  /इंग्रजी\s*माध्यम/g,
  // Latin form without the trailing "medium".
  /marathi\s*(?:&|and)\s*semi[\s-]*english/g,
  // Stream/combo descriptors that also name languages, e.g.
  // "PCM with English & Hindi – Complete Set".
  /with\s+english\s*(?:&|and)\s*hindi/g,
  /with\s+english\s*(?:&|and)\s*marathi/g,
  /english\s*(?:&|and)\s*hindi/g,
];

function stripMediumNoise(hay: string): string {
  let out = hay;
  for (const re of MEDIUM_NOISE) out = out.replace(re, " ");
  return out.replace(/\s+/g, " ").trim();
}

function extractSubjects(text: string): string[] {
  const hay = stripMediumNoise(normalise(text));
  const found: string[] = [];
  for (const [subject, re] of SUBJECT_ALIASES) if (re.test(hay)) found.push(subject);
  return found;
}

/* -------------------------------------------------------------------------- */
/* Combo / board                                                              */
/* -------------------------------------------------------------------------- */

function isCombo(text: string, categories: string[]): boolean {
  const hay = `${categories.map(normalise).join(" ")} ${normalise(text)}`;
  return /\bcombo\b|complete\s*set|book\s*set|study\s*pack|full\s*syllabus|संपूर्ण\s*संच|संच|पॅक|study\s*material/.test(hay);
}

function extractBoard(text: string, categories: string[]): "state" | "cbse" {
  const hay = `${categories.map(normalise).join(" ")} ${normalise(text)}`;
  return /\bcbse\b|central\s*board|ncert/.test(hay) ? "cbse" : "state";
}

/* ========================================================================== */
/* Fetching                                                                   */
/* ========================================================================== */

async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(45_000),
        headers: { "User-Agent": "kohinoor-cover-sync/1.0 (+internal asset migration)" },
      });
      if (res.ok) return res;
      // 4xx other than 429 will not improve with retrying.
      if (res.status < 500 && res.status !== 429) {
        throw new Error(`HTTP ${res.status}`);
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 800 * 2 ** i));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchAllProducts(): Promise<WooProduct[]> {
  if (!OPTS.refresh && existsSync(PRODUCTS_CACHE)) {
    const cached = JSON.parse(await readFile(PRODUCTS_CACHE, "utf8")) as WooProduct[];
    console.log(`  Using cached product list (${cached.length} products). --refresh to re-fetch.`);
    return cached;
  }

  const first = await fetchWithRetry(`${API}?per_page=${PER_PAGE}&page=1`);
  const total = Number(first.headers.get("x-wp-total") ?? 0);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const all = (await first.json()) as WooProduct[];

  console.log(`  ${total} products across ${pages} page(s)`);

  // Sequential paging: this is someone's live production store, and four
  // requests do not need parallelising.
  for (let page = 2; page <= pages; page++) {
    const res = await fetchWithRetry(`${API}?per_page=${PER_PAGE}&page=${page}`);
    all.push(...((await res.json()) as WooProduct[]));
    process.stderr.write(`\r  fetched page ${page}/${pages}`);
  }
  process.stderr.write("\n");

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(PRODUCTS_CACHE, JSON.stringify(all, null, 2));
  return all;
}

/* ========================================================================== */
/* Facts + targets                                                            */
/* ========================================================================== */

function toFacts(p: WooProduct): ProductFacts {
  const title = decodeEntities(p.name);
  const cats = (p.categories ?? []).map((c) => c.name);
  const searchText = `${title} ${cats.join(" ")}`;

  return {
    product: p,
    title,
    imageUrl: p.images?.[0]?.src ?? null,
    classId: extractClass(title, cats),
    series: extractSeries(title, cats),
    medium: extractMedium(title, cats),
    subjects: extractSubjects(title),
    board: extractBoard(title, cats),
    isCombo: isCombo(title, cats),
    tokens: new Set(normalise(searchText).split(" ").filter((t) => t.length > 2)),
  };
}

function bookTarget(b: Book): Target {
  return {
    slug: b.slug,
    kind: "book",
    title: b.title,
    classId: b.classId,
    series: b.series,
    medium: b.medium,
    subject: b.subject,
    board: b.board,
  };
}

function comboTarget(c: Combo): Target {
  return {
    slug: c.slug,
    kind: "combo",
    title: c.title,
    classId: c.classId,
    series: null, // combos in the seed data are not series-specific
    medium: c.medium,
    subject: null,
    board: c.board,
  };
}

/* ========================================================================== */
/* MATCHING                                                                   */
/*                                                                            */
/* Hard filters first, then additive scoring. The hard filters encode one      */
/* rule: a WRONG cover is worse than a MISSING cover. A parent who orders a    */
/* Class 9 guide because the page showed a Class 9 cover has been actively     */
/* misled; a missing image is merely unfinished.                              */
/* ========================================================================== */

function score(target: Target, facts: ProductFacts): number | null {
  // --- hard filters --------------------------------------------------------
  if (!facts.imageUrl) return null;
  if (facts.isCombo !== (target.kind === "combo")) return null;
  if (facts.classId && facts.classId !== target.classId) return null;
  if (!facts.classId) return null; // unknown class is never safe to guess
  if (target.series && facts.series && facts.series !== target.series) return null;

  // A book target REQUIRES a positive subject match. Allowing a product whose
  // subject we could not determine to satisfy any subject slug is how
  // "Organization of Commerce" ends up on the Class 11 English page.
  if (target.subject) {
    if (facts.subjects.length === 0) return null;
    if (!facts.subjects.includes(target.subject)) return null;
  }

  // --- additive ------------------------------------------------------------
  let s = 5; // class matched and survived every hard filter

  if (target.series && facts.series === target.series) s += 5;
  if (target.subject) {
    // SUBJECT_ALIASES is ordered most-specific-first, so subjects[0] is the
    // title's primary subject. A secondary hit is weaker evidence.
    s += facts.subjects[0] === target.subject ? 6 : 3;
  }
  if (target.kind === "combo") s += 4; // combos have no subject to score on

  if (facts.medium === target.medium) s += 3;
  else if (facts.medium && facts.medium !== target.medium) s -= 2;

  if (facts.board === target.board) s += 2;
  else s -= 3;

  // Light lexical tiebreaker between otherwise identical candidates.
  const targetTokens = normalise(target.title).split(" ").filter((t) => t.length > 3);
  const overlap = targetTokens.filter((t) => facts.tokens.has(t)).length;
  s += Math.min(2, overlap * 0.25);

  return s;
}

interface Assignment {
  target: Target;
  facts: ProductFacts;
  score: number;
}

function assign(targets: Target[], products: ProductFacts[]): {
  matched: Assignment[];
  unmatchedTargets: Target[];
  usedProductIds: Set<number>;
} {
  const candidates: Assignment[] = [];

  for (const target of targets) {
    for (const facts of products) {
      const s = score(target, facts);
      if (s !== null && s >= OPTS.minScore) candidates.push({ target, facts, score: s });
    }
  }

  // Greedy best-first. Deterministic tiebreak on slug so re-runs are stable.
  candidates.sort((a, b) => b.score - a.score || a.target.slug.localeCompare(b.target.slug));

  const matched: Assignment[] = [];
  const takenSlugs = new Set<string>();
  const takenProducts = new Set<number>();

  for (const c of candidates) {
    if (takenSlugs.has(c.target.slug)) continue;
    // Default 1:1. Reusing one cover across three medium variants of a title
    // puts a visibly wrong image on two of them, so it is opt-in.
    if (!OPTS.allowReuse && takenProducts.has(c.facts.product.id)) continue;
    takenSlugs.add(c.target.slug);
    takenProducts.add(c.facts.product.id);
    matched.push(c);
  }

  return {
    matched,
    unmatchedTargets: targets.filter((t) => !takenSlugs.has(t.slug)),
    usedProductIds: takenProducts,
  };
}

/* ========================================================================== */
/* Download + process                                                         */
/* ========================================================================== */

async function processOne(a: Assignment): Promise<ReportRow> {
  const file = `${a.target.slug}-front.jpg`;
  const dest = path.join(COVERS_DIR, file);

  const base: ReportRow = {
    slug: a.target.slug,
    productTitle: a.facts.title,
    productId: a.facts.product.id,
    productUrl: a.facts.product.permalink,
    imageUrl: a.facts.imageUrl,
    savedFile: `public/covers/${file}`,
    score: Math.round(a.score * 100) / 100,
    status: "downloaded",
  };

  if (OPTS.dryRun) return { ...base, status: "dry-run" };

  // Resume: a non-empty existing file is left alone.
  if (!OPTS.force && existsSync(dest) && statSync(dest).size > 0) {
    return { ...base, status: "skipped-exists" };
  }

  try {
    const res = await fetchWithRetry(a.facts.imageUrl!);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error("empty response body");

    await sharp(buf)
      .resize(COVER_WIDTH, COVER_HEIGHT, { fit: "cover", position: "centre" })
      .toColorspace("srgb")
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(dest);

    return base;
  } catch (err) {
    return {
      ...base,
      savedFile: null,
      status: "failed",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Bounded worker pool with an inline progress bar. */
async function runPool(items: Assignment[]): Promise<ReportRow[]> {
  const results: ReportRow[] = [];
  let cursor = 0;
  let done = 0;

  const draw = () => {
    const pct = items.length ? done / items.length : 1;
    const width = 28;
    const filled = Math.round(pct * width);
    process.stderr.write(
      `\r  [${"█".repeat(filled)}${"░".repeat(width - filled)}] ` +
        `${done}/${items.length} (${Math.round(pct * 100)}%)   `,
    );
  };

  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      results.push(await processOne(item));
      done++;
      draw();
    }
  };

  draw();
  await Promise.all(Array.from({ length: OPTS.concurrency }, worker));
  process.stderr.write("\n");
  return results;
}

/* ========================================================================== */
/* Main                                                                       */
/* ========================================================================== */

async function main() {
  console.log("\nKohinoor Tez — cover sync\n");

  await mkdir(COVERS_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  // 1. Targets, straight from the project's authoritative slug list.
  const targets: Target[] = [
    ...SEED_BOOKS.map(bookTarget),
    ...SEED_COMBOS.map(comboTarget),
  ];
  console.log(`  ${SEED_BOOKS.length} book slugs + ${SEED_COMBOS.length} combo slugs = ${targets.length} targets`);

  // 2. Live catalogue.
  console.log("\n→ Fetching catalogue");
  const raw = await fetchAllProducts();
  const products = raw.map(toFacts);
  const withImages = products.filter((p) => p.imageUrl);
  console.log(`  ${products.length} products, ${withImages.length} with a cover image`);

  // Byproduct: the real catalogue, already normalised onto this project's
  // taxonomy. This is the import file for replacing the generated seed data.
  await writeFile(
    SCRAPED_CATALOG,
    JSON.stringify(
      products.map((p) => ({
        wooId: p.product.id,
        wooSlug: p.product.slug,
        title: p.title,
        permalink: p.product.permalink,
        image: p.imageUrl,
        price: p.product.prices?.price ? Number(p.product.prices.price) / 100 : null,
        classId: p.classId,
        series: p.series,
        medium: p.medium,
        subjects: p.subjects,
        board: p.board,
        format: p.isCombo ? "combo" : "book",
        categories: p.product.categories.map((c) => c.name),
      })),
      null,
      2,
    ),
  );

  // 3. Match.
  console.log("\n→ Matching");
  const { matched, unmatchedTargets, usedProductIds } = assign(targets, withImages);
  console.log(
    `  ${matched.length} matched · ${unmatchedTargets.length} unmatched ` +
      `(threshold ${OPTS.minScore}${OPTS.allowReuse ? ", reuse allowed" : ", 1:1"})`,
  );

  // 4. Download + process.
  console.log(`\n→ Downloading (concurrency ${OPTS.concurrency})`);
  const rows = await runPool(matched);

  for (const t of unmatchedTargets) {
    rows.push({
      slug: t.slug,
      productTitle: null,
      productId: null,
      productUrl: null,
      imageUrl: null,
      savedFile: null,
      score: null,
      status: "unmatched",
      reason: `No product scored >= ${OPTS.minScore} for ${t.kind} ${t.classId}/${t.subject ?? "-"}/${t.medium}`,
    });
  }

  // 5. Reports.
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  await writeFile(
    REPORT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: API,
        options: OPTS,
        totals: {
          targets: targets.length,
          productsFetched: products.length,
          productsWithImages: withImages.length,
          productsUsed: usedProductIds.size,
          ...counts,
        },
        rows: rows.sort((a, b) => a.slug.localeCompare(b.slug)),
      },
      null,
      2,
    ),
  );

  const missing = rows
    .filter((r) => r.status === "unmatched" || r.status === "failed")
    .map((r) => r.slug)
    .sort();
  await writeFile(MISSING_PATH, missing.join("\n") + (missing.length ? "\n" : ""));

  const unusedProducts = withImages
    .filter((p) => !usedProductIds.has(p.product.id))
    .map((p) => `${p.product.id}\t${p.title}\t${p.imageUrl}`)
    .sort();
  await writeFile(UNMATCHED_PATH, unusedProducts.join("\n") + (unusedProducts.length ? "\n" : ""));

  // 6. Summary.
  console.log("\n── Summary ─────────────────────────────────");
  console.log(`  downloaded      ${counts["downloaded"] ?? 0}`);
  console.log(`  already present ${counts["skipped-exists"] ?? 0}`);
  console.log(`  failed          ${counts["failed"] ?? 0}`);
  console.log(`  unmatched       ${counts["unmatched"] ?? 0}`);
  if (counts["dry-run"]) console.log(`  dry-run         ${counts["dry-run"]}`);
  console.log(`  site products not used  ${unusedProducts.length}`);
  console.log("────────────────────────────────────────────");
  console.log(`  covers   → public/covers/`);
  console.log(`  report   → download-report.json`);
  console.log(`  missing  → missing-covers.txt`);
  console.log(`  leftover → unmatched-products.txt`);
  console.log(`  catalogue→ scripts/.cache/catalog-scraped.json\n`);
}

main().catch((err) => {
  console.error("\nFailed:", err);
  process.exit(1);
});
