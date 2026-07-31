import type { Board, ClassId, ClassNode, Medium, Series, Stream } from "@/types/catalog";

export const SITE = {
  name: "Kohinoor Tez",
  legalName: "Adwani Publishing House",
  tagline: "Every subject. Every class. One trusted guide.",
  description:
    "Educational guides, key notes and combo packs for Maharashtra State Board and CBSE — Classes Nursery to 12, in Marathi, Semi-English and English medium.",
  url: "https://kohinoortez.com",
  email: "kohinoortezz@gmail.com",
  phones: ["+917104299010", "+919209001126"],
  address: {
    street: "N87, MIDC, Hingna Road",
    city: "Nagpur",
    state: "Maharashtra",
    postalCode: "440016",
    country: "IN",
  },
  social: {
    facebook: "https://facebook.com/kohinoortez",
    instagram: "https://instagram.com/kohinoortez",
    linkedin: "https://linkedin.com/company/kohinoortez",
    twitter: "https://twitter.com/kohinoortez",
  },
  /** Drives the cart's free-shipping meter — the AOV lever (Phase 1 §7). */
  freeShippingThreshold: 200,
  flatShippingRate: 40,
} as const;

export const BOARDS: { id: Board; label: string; short: string }[] = [
  { id: "state", label: "Maharashtra State Board", short: "State Board" },
  { id: "cbse", label: "Central Board (CBSE)", short: "CBSE" },
];

export const MEDIUMS: { id: Medium; label: string; labelNative: string }[] = [
  { id: "marathi", label: "Marathi Medium", labelNative: "मराठी" },
  { id: "semi-english", label: "Semi-English Medium", labelNative: "सेमी-इंग्रजी" },
  { id: "english", label: "English Medium", labelNative: "English" },
];

export const SERIES: {
  id: Series;
  label: string;
  positioning: string;
  accent: string;
}[] = [
  {
    id: "kohinoor",
    label: "Kohinoor",
    positioning: "The complete guide. Every subject, every class.",
    accent: "var(--color-indigo-600)",
  },
  {
    id: "spark",
    label: "Spark",
    positioning: "Science stream, English medium. Built for 11th & 12th.",
    accent: "var(--color-amber-500)",
  },
  {
    id: "vidyamitra",
    label: "Vidyamitra",
    positioning: "Marathi & Semi-English companions for the middle years.",
    accent: "var(--color-emerald-600)",
  },
  {
    id: "winwings",
    label: "WinWings",
    positioning: "Exam-focused combo sets for Classes 9 & 10.",
    accent: "var(--color-violet-600)",
  },
  {
    id: "ekatmik",
    label: "Ekatmik",
    positioning: "Integrated, curriculum-aligned workbooks.",
    accent: "var(--color-indigo-400)",
  },
];

export const STREAMS: { id: Stream; label: string; subjects: string[] }[] = [
  { id: "science-pcm", label: "Science (PCM)", subjects: ["Physics", "Chemistry", "Mathematics"] },
  { id: "science-pcb", label: "Science (PCB)", subjects: ["Physics", "Chemistry", "Biology"] },
  { id: "science-pcbm", label: "Science (PCBM)", subjects: ["Physics", "Chemistry", "Biology", "Mathematics"] },
  { id: "commerce", label: "Commerce", subjects: ["Book Keeping & Accountancy", "Economics", "Organisation of Commerce", "Mathematics"] },
  { id: "arts", label: "Arts", subjects: ["History", "Political Science", "Geography", "Sociology"] },
];

const CORE_PRIMARY = ["Mathematics", "Science", "English", "Marathi", "Hindi", "Social Science"];
const CORE_SECONDARY = ["Mathematics", "Science", "English", "Marathi", "Hindi", "History", "Geography", "Political Science", "Sanskrit"];
const SENIOR = ["Physics", "Chemistry", "Biology", "Mathematics", "Book Keeping & Accountancy", "Economics", "History", "Political Science", "Geography", "English", "Marathi"];

export const CLASSES: ClassNode[] = [
  {
    id: "nursery", label: "Nursery & Pre-Primary", labelMr: "नर्सरी", short: "Nur",
    boards: ["state"], subjects: ["English", "Marathi", "Numbers", "Drawing"],
    description: "First books, alphabet and number practice for the earliest years.",
  },
  {
    id: "5", label: "Class 5", labelMr: "इयत्ता ५ वी", short: "5",
    boards: ["state", "cbse"], subjects: CORE_PRIMARY,
    description: "Scholarship-year foundations across every core subject.",
  },
  {
    id: "6", label: "Class 6", labelMr: "इयत्ता ६ वी", short: "6",
    boards: ["state", "cbse"], subjects: CORE_PRIMARY,
    description: "Chapter-wise guides matched to the current syllabus.",
  },
  {
    id: "7", label: "Class 7", labelMr: "इयत्ता ७ वी", short: "7",
    boards: ["state", "cbse"], subjects: CORE_PRIMARY,
    description: "Practice-led guides for the middle school years.",
  },
  {
    id: "8", label: "Class 8", labelMr: "इयत्ता ८ वी", short: "8",
    boards: ["state", "cbse"], subjects: CORE_SECONDARY,
    description: "Scholarship and foundation preparation in one set.",
  },
  {
    id: "9", label: "Class 9", labelMr: "इयत्ता ९ वी", short: "9",
    boards: ["state", "cbse"], subjects: CORE_SECONDARY,
    description: "The groundwork year for the board exam that follows.",
  },
  {
    id: "10", label: "Class 10 (SSC)", labelMr: "इयत्ता १० वी", short: "10",
    boards: ["state", "cbse"], subjects: CORE_SECONDARY, highlight: true,
    description: "Complete SSC preparation — guides, key notes, guessing papers.",
  },
  {
    id: "11", label: "Class 11 (FYJC)", labelMr: "इयत्ता ११ वी", short: "11",
    boards: ["state", "cbse"], subjects: SENIOR,
    streams: ["science-pcm", "science-pcb", "science-pcbm", "commerce", "arts"],
    description: "Stream-wise sets for Science, Commerce and Arts.",
  },
  {
    id: "12", label: "Class 12 (HSC)", labelMr: "इयत्ता १२ वी", short: "12",
    boards: ["state", "cbse"], subjects: SENIOR, highlight: true,
    streams: ["science-pcm", "science-pcb", "science-pcbm", "commerce", "arts"],
    description: "Full HSC syllabus coverage with solved board papers.",
  },
  {
    id: "board-exam", label: "Board Exam Special", labelMr: "बोर्ड परीक्षा", short: "Board",
    boards: ["state", "cbse"], subjects: ["Guessing Papers", "Solved Papers", "Question Banks"],
    description: "Guessing papers, previous-year sets and last-mile revision.",
  },
];

export const SUBJECTS = [
  "Mathematics", "Science", "Physics", "Chemistry", "Biology",
  "English", "Marathi", "Hindi", "Sanskrit",
  "History", "Geography", "Political Science", "Economics",
  "Social Science", "Book Keeping & Accountancy",
] as const;

export const SORT_OPTIONS = [
  { value: "relevance", label: "Relevance" },
  { value: "popularity", label: "Most popular" },
  { value: "rating", label: "Highest rated" },
  { value: "newest", label: "Newest first" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
] as const;

export const classById = (id: ClassId) => CLASSES.find((c) => c.id === id);
export const seriesById = (id: Series) => SERIES.find((s) => s.id === id);
export const mediumById = (id: Medium) => MEDIUMS.find((m) => m.id === id);
export const streamById = (id: Stream) => STREAMS.find((s) => s.id === id);
