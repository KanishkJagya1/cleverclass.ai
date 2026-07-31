/**
 * Seed catalog (D5).
 *
 * Generated deterministically from the real taxonomy rather than hand-written
 * as 300 literals: it stays consistent with `constants/catalog.ts`, gives the
 * filters realistic counts to work against, and is a fraction of the code.
 *
 * Deterministic on purpose — no Math.random(), because SSG would otherwise
 * produce different ratings on every build and blow ISR cache coherence.
 *
 * Replace by pointing `CATALOG_SOURCE` at a real adapter; nothing else changes.
 */
import { CLASSES, SERIES } from "@/constants/catalog";
import type { Book, ClassId, Combo, KeyNote, Medium, Review, Series } from "@/types/catalog";

/** FNV-1a — stable across builds and platforms. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}
const pick = <T,>(arr: readonly T[], seed: string): T =>
  arr[Math.floor(hash(seed) * arr.length)] ?? arr[0]!;
const between = (seed: string, min: number, max: number) =>
  min + Math.floor(hash(seed) * (max - min + 1));

const SUBJECT_MR: Record<string, string> = {
  Mathematics: "गणित",
  Science: "विज्ञान",
  English: "इंग्रजी",
  Marathi: "मराठी",
  Hindi: "हिंदी",
  Sanskrit: "संस्कृत",
  History: "इतिहास",
  Geography: "भूगोल",
  "Political Science": "राज्यशास्त्र",
  "Social Science": "समाजशास्त्र",
  Physics: "भौतिकशास्त्र",
  Chemistry: "रसायनशास्त्र",
  Biology: "जीवशास्त्र",
  Economics: "अर्थशास्त्र",
  "Book Keeping & Accountancy": "पुस्तपालन व लेखाकर्म",
};

/** Which series realistically publishes for which class + medium. */
function seriesFor(classId: ClassId, medium: Medium): Series[] {
  if (classId === "nursery") return ["ekatmik"];
  if (classId === "board-exam") return ["kohinoor", "winwings"];
  const n = Number(classId);
  const out: Series[] = ["kohinoor"];
  if (n >= 11 && medium === "english") out.push("spark");
  if (n >= 5 && n <= 8) out.push("vidyamitra", "ekatmik");
  if (n === 9 || n === 10) out.push("winwings", "vidyamitra");
  return out;
}

const cover = (slug: string, kind: "front" | "back" | "inside", label: string) => ({
  src: `/covers/${slug}-${kind}.jpg`,
  alt: `${label} — ${kind} cover`,
  kind,
  width: 600,
  height: 800,
});

function makeBook(classId: ClassId, subject: string, medium: Medium, series: Series): Book {
  const node = CLASSES.find((c) => c.id === classId)!;
  const seriesLabel = SERIES.find((s) => s.id === series)!.label;
  const slug = `${series}-${classId}-${subject}-${medium}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const title =
    classId === "nursery"
      ? `${seriesLabel} Nursery ${subject} Workbook`
      : `${seriesLabel} ${node.label.replace(/ \(.*\)/, "")} ${subject}${
          medium === "english" ? "" : medium === "semi-english" ? " (Semi-English)" : ""
        }`;

  const price = between(slug + "p", 3, 12) * 10;
  const hasDiscount = hash(slug + "d") > 0.45;
  const n = Number(classId);

  return {
    id: slug,
    slug,
    title,
    titleMr:
      medium !== "english" && SUBJECT_MR[subject]
        ? `${seriesLabel} ${node.labelMr} ${SUBJECT_MR[subject]}`
        : undefined,
    series,
    board: series === "kohinoor" && hash(slug + "b") > 0.78 ? "cbse" : "state",
    classId,
    medium,
    subject,
    stream:
      n >= 11
        ? ["Physics", "Chemistry", "Biology", "Mathematics"].includes(subject)
          ? "science-pcm"
          : ["Book Keeping & Accountancy", "Economics"].includes(subject)
            ? "commerce"
            : ["History", "Political Science", "Geography"].includes(subject)
              ? "arts"
              : undefined
        : undefined,
    price,
    mrp: hasDiscount ? Math.round((price * between(slug + "m", 115, 135)) / 100 / 5) * 5 : undefined,
    images: [
      cover(slug, "front", title),
      cover(slug, "back", title),
      cover(slug, "inside", title),
    ],
    previewPages: Array.from({ length: 6 }, (_, i) => `/previews/${slug}-${i + 1}.jpg`),
    pages: between(slug + "pg", 96, 320),
    isbn: `978-93-${between(slug + "i1", 10000, 99999)}-${between(slug + "i2", 10, 99)}-${between(slug + "i3", 0, 9)}`,
    edition: `${between(slug + "e", 2024, 2026)} Edition`,
    description: `${title} is a chapter-wise guide aligned to the current ${
      node.label
    } syllabus. Every chapter includes summarised theory, solved textbook exercises, board-pattern questions and practice sets prepared by experienced ${subject} teachers.`,
    highlights: [
      "Chapter-wise summarised theory",
      "All textbook exercises solved",
      "Board-pattern practice questions",
      "Previous years' questions marked",
      medium === "marathi" ? "Complete Marathi medium" : "Aligned to the latest syllabus",
    ],
    rating: Math.round((3.9 + hash(slug + "r") * 1.1) * 10) / 10,
    reviewCount: between(slug + "rc", 8, 340),
    inStock: hash(slug + "s") > 0.06,
    publishedAt: `${between(slug + "y", 2024, 2026)}-0${between(slug + "mo", 1, 9)}-15`,
  };
}

/* --------------------------------------------------------------------------
   Books
   -------------------------------------------------------------------------- */
function buildBooks(): Book[] {
  const books: Book[] = [];
  for (const node of CLASSES) {
    const mediums: Medium[] =
      node.id === "nursery" ? ["english"] : ["marathi", "semi-english", "english"];
    for (const medium of mediums) {
      for (const subject of node.subjects) {
        for (const series of seriesFor(node.id, medium)) {
          // Keep the catalog realistic: not every series prints every subject.
          if (hash(`${series}${node.id}${subject}${medium}`) > 0.62) continue;
          books.push(makeBook(node.id, subject, medium, series));
        }
      }
    }
  }

  // Link medium variants of the same title — powers the wrong-purchase guard.
  const byKey = new Map<string, Book[]>();
  for (const b of books) {
    const key = `${b.series}|${b.classId}|${b.subject}`;
    byKey.set(key, [...(byKey.get(key) ?? []), b]);
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const b of group) b.variants = group.filter((g) => g.slug !== b.slug).map((g) => g.slug);
  }

  // Best-seller ranks: deterministic, weighted toward board years.
  [...books]
    .sort(
      (a, b) =>
        hash(b.slug + "bs") * (b.classId === "10" || b.classId === "12" ? 1.6 : 1) -
        hash(a.slug + "bs") * (a.classId === "10" || a.classId === "12" ? 1.6 : 1),
    )
    .slice(0, 24)
    .forEach((b, i) => (b.bestSellerRank = i + 1));

  return books;
}

export const SEED_BOOKS: Book[] = buildBooks();

/* --------------------------------------------------------------------------
   Combos — the AOV engine (Phase 1 §7)
   -------------------------------------------------------------------------- */
function buildCombos(): Combo[] {
  const combos: Combo[] = [];
  for (const node of CLASSES) {
    if (node.id === "nursery") continue;
    const mediums: Medium[] = ["marathi", "semi-english", "english"];
    for (const medium of mediums) {
      const items = SEED_BOOKS.filter(
        (b) => b.classId === node.id && b.medium === medium && b.inStock,
      ).slice(0, 8);
      if (items.length < 3) continue;

      const slug = `${node.id}-complete-set-${medium}`;
      const itemsTotal = items.reduce((s, b) => s + b.price, 0);
      const price = Math.round((itemsTotal * between(slug, 70, 85)) / 100 / 5) * 5;
      const title = `${node.label.replace(/ \(.*\)/, "")} Complete Set`;

      combos.push({
        id: slug,
        slug,
        title,
        titleMr: `${node.labelMr} संपूर्ण संच`,
        board: "state",
        classId: node.id,
        medium,
        price,
        mrp: itemsTotal,
        itemSlugs: items.map((b) => b.slug),
        images: [cover(slug, "front", title)],
        highlights: [
          `${items.length} books covering every core subject`,
          "One delivery, one price",
          "Free shipping included",
          "Matched editions — no syllabus mismatch",
        ],
        description: `Every ${node.label} guide you need in a single pack. Buying the ${items.length} titles separately costs ₹${itemsTotal}; as a set it is ₹${price}.`,
        rating: Math.round((4.2 + hash(slug + "r") * 0.7) * 10) / 10,
        reviewCount: between(slug + "rc", 20, 210),
        inStock: true,
        publishedAt: "2026-04-01",
      });
    }
  }
  return combos;
}

export const SEED_COMBOS: Combo[] = buildCombos();

/* --------------------------------------------------------------------------
   Key Notes — free preview, routes to the paid guide (D1, Flow C)
   -------------------------------------------------------------------------- */
function buildKeyNotes(): KeyNote[] {
  const notes: KeyNote[] = [];
  for (const node of CLASSES) {
    if (!["5", "6", "7", "8", "9", "10"].includes(node.id)) continue;
    for (const subject of node.subjects.slice(0, 5)) {
      for (const medium of ["marathi", "semi-english"] as Medium[]) {
        const slug = `${node.id}-${subject}-${medium}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-");
        const related = SEED_BOOKS.find(
          (b) => b.classId === node.id && b.subject === subject && b.medium === medium,
        );
        notes.push({
          id: `kn-${slug}`,
          slug,
          title: `${node.label.replace(/ \(.*\)/, "")} ${subject} Key Notes`,
          titleMr: SUBJECT_MR[subject]
            ? `${node.labelMr} ${SUBJECT_MR[subject]} की-नोट्स`
            : undefined,
          classId: node.id,
          subject,
          medium,
          board: "state",
          chapters: Array.from(
            { length: between(slug, 8, 16) },
            (_, i) => `Chapter ${i + 1}`,
          ),
          previewPages: Array.from({ length: 12 }, (_, i) => `/notes/${slug}-${i + 1}.jpg`),
          totalPages: between(slug + "t", 48, 140),
          relatedBookSlug: related?.slug,
          updatedAt: "2026-06-01",
        });
      }
    }
  }
  return notes;
}

export const SEED_KEY_NOTES: KeyNote[] = buildKeyNotes();

/* --------------------------------------------------------------------------
   Reviews
   -------------------------------------------------------------------------- */
const REVIEW_BODIES = [
  "Exactly matched my daughter's syllabus. The solved exercises saved us hours of tuition.",
  "Printing and paper quality are genuinely good for the price. Delivery took four days to Nagpur.",
  "Bought the whole set. Cheaper than buying each book separately and everything arrived together.",
  "The chapter summaries are the best part — my son revises the whole unit in twenty minutes.",
  "Board-pattern questions at the end of each chapter are very close to the actual paper.",
  "Marathi medium edition, clearly printed, no confusing translations. Recommended.",
];
const REVIEW_AUTHORS = ["Sunita P.", "Rahul D.", "Anjali K.", "Mahesh J.", "Priya S.", "Vikram T."];

export const SEED_REVIEWS: Review[] = SEED_BOOKS.flatMap((b) =>
  Array.from({ length: between(b.slug + "nr", 2, 5) }, (_, i) => {
    const seed = `${b.slug}-${i}`;
    return {
      id: `rv-${seed}`,
      productSlug: b.slug,
      author: pick(REVIEW_AUTHORS, seed + "a"),
      rating: between(seed + "rt", 4, 5),
      title: pick(["Worth it", "Exactly as described", "Good buy", "Very useful"], seed + "t"),
      body: pick(REVIEW_BODIES, seed + "b"),
      date: `2026-0${between(seed + "m", 1, 7)}-${between(seed + "d", 10, 28)}`,
      verified: hash(seed + "v") > 0.25,
    };
  }),
);
