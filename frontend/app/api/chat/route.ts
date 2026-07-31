import { SITE } from "@/constants/catalog";

export const runtime = "edge";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

/**
 * Streams the FastAPI RAG response through to the browser.
 *
 * Proxying rather than calling the backend directly keeps everything on one
 * origin — no CORS, no preflight on every message, and the backend URL is
 * never exposed to the client.
 *
 * The stream is passed through untouched so tokens reach the UI as they are
 * produced; buffering here would defeat the entire point of streaming.
 */
export async function POST(request: Request) {
  let upstream: Response;

  try {
    upstream = await fetch(`${BACKEND}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.BACKEND_API_KEY ? { "X-API-Key": process.env.BACKEND_API_KEY } : {}),
      },
      body: await request.text(),
    });
  } catch {
    // The assistant is a sales channel; when it is down the user still needs a
    // route to a human, so the failure message carries the phone number.
    return new Response(
      JSON.stringify({
        error: "assistant_unavailable",
        message: `The assistant is temporarily unavailable. Please call ${SITE.phones[0]} or email ${SITE.email}.`,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(
      JSON.stringify({
        error: "assistant_error",
        message: `Something went wrong. Please call ${SITE.phones[0]} and we'll help directly.`,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
