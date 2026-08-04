/**
 * Order submission proxy.
 *
 * Server-side so the client's IP reaches the backend's rate limiter and the
 * API key never touches the browser.
 *
 * The contract that matters: this resolves only AFTER the order row exists.
 * The UI must not render a confirmation before it does — a checkout that says
 * "received" without persisting anything loses real orders, and you find out
 * from an angry phone call rather than a log.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const base = process.env.CATALOG_API_URL ?? process.env.BACKEND_URL;
  if (!base) {
    console.error("[orders] no backend configured — submission refused");
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.BACKEND_API_KEY ? { "X-API-Key": process.env.BACKEND_API_KEY } : {}),
        "X-Forwarded-For":
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
      },
      body: JSON.stringify(body),
      // Generous: an order is worth waiting for, and a timeout here means a
      // customer who thinks they ordered and did not.
      signal: AbortSignal.timeout(15000),
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error(`[orders] backend ${res.status}`, payload);
      return NextResponse.json(
        {
          error:
            res.status === 422
              ? (payload as { detail?: string }).detail ?? "Please check the details."
              : res.status === 429
                ? "Too many orders from this connection. Please call us."
                : "We couldn't record that order.",
        },
        { status: res.status === 422 ? 400 : res.status === 429 ? 429 : 502 },
      );
    }

    return NextResponse.json(payload, { status: 201 });
  } catch (err) {
    console.error("[orders] submission failed", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
