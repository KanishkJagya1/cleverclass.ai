/**
 * Contact / newsletter submission proxy.
 *
 * Server-side so `BACKEND_API_KEY` never reaches the browser, and so the
 * client's IP is forwarded for rate limiting.
 *
 * Both forms this backs used to resolve a `setTimeout` and then claim success.
 * The contract here is the opposite: the caller only sees `ok: true` if the row
 * actually exists.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = { contact: "/leads/contact", newsletter: "/leads/newsletter" } as const;
type Kind = keyof typeof KINDS;

export async function POST(request: Request) {
  let body: { kind?: string; [k: string]: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const kind = body.kind as Kind | undefined;
  if (!kind || !(kind in KINDS)) {
    return NextResponse.json({ error: "unknown form" }, { status: 400 });
  }

  const base = process.env.CATALOG_API_URL ?? process.env.BACKEND_URL;
  if (!base) {
    console.error("[leads] no backend configured — submission dropped");
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const { kind: _kind, ...payload } = body;

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}${KINDS[kind]}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.BACKEND_API_KEY ? { "X-API-Key": process.env.BACKEND_API_KEY } : {}),
        // First hop only; the backend reads the same header.
        "X-Forwarded-For":
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[leads] backend ${res.status}: ${detail.slice(0, 300)}`);
      // 422 means the payload failed validation — surface that, not a 500.
      return NextResponse.json(
        { error: res.status === 422 ? "validation" : "failed" },
        { status: res.status === 422 ? 400 : 502 },
      );
    }

    return NextResponse.json(await res.json());
  } catch (err) {
    console.error("[leads] submission failed", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
