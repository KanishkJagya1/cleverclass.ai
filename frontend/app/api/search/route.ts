import { NextResponse } from "next/server";
import { catalog } from "@/lib/data";

export const runtime = "nodejs";

/**
 * Lexical search over the catalogue.
 *
 * Semantic / natural-language search ("class 10 science books in English")
 * is handled by the FastAPI backend at /api/ai/search, which shares the
 * chatbot's vector index (D8). The palette calls this first because it is
 * instant, and falls back to the semantic endpoint when this returns nothing.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ hits: [] });

  const hits = await catalog.search(q, 12);
  return NextResponse.json(
    { hits },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
  );
}
