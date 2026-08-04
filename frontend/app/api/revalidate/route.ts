/**
 * On-demand cache invalidation, called by the backend after an admin save.
 *
 * Product pages carry `export const revalidate = 43200`. Without this route a
 * staff price edit would not appear for twelve hours — long enough that staff
 * assume the save failed and save again. This is what makes the admin panel
 * trustworthy, not optional polish.
 *
 * Auth is an HMAC over the raw body with a shared secret, compared in constant
 * time. A bearer token would work too, but an HMAC also proves the body was not
 * tampered with, and this endpoint can evict the entire catalogue cache.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

export const runtime = "nodejs"; // node:crypto is unavailable on edge
export const dynamic = "force-dynamic";

/** Reject anything older than this so a captured request cannot be replayed. */
const MAX_SKEW_MS = 5 * 60 * 1000;

function verify(raw: string, signature: string | null, timestamp: string | null): string | null {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return "REVALIDATE_SECRET is not configured";
  if (!signature || !timestamp) return "Missing signature headers";

  const age = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_SKEW_MS) return "Stale or invalid timestamp";

  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");

  // timingSafeEqual throws on a length mismatch, which would itself leak length.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "Bad signature";

  return null;
}

export async function POST(request: Request) {
  const raw = await request.text();

  const error = verify(
    raw,
    request.headers.get("x-cc-signature"),
    request.headers.get("x-cc-timestamp"),
  );
  if (error) {
    // Deliberately vague to the caller; specific in the log.
    console.warn(`[revalidate] rejected: ${error}`);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { tags?: string[]; paths?: string[] };
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const tags = Array.isArray(body.tags) ? body.tags.slice(0, 50) : [];
  const paths = Array.isArray(body.paths) ? body.paths.slice(0, 50) : [];

  // Next 16 requires a cache-life profile alongside the tag. `expire: 0` is an
  // immediate purge, which is the whole point of an admin-triggered webhook.
  for (const tag of tags) revalidateTag(tag, { expire: 0 });
  for (const path of paths) revalidatePath(path);

  console.info(`[revalidate] tags=${tags.join(",") || "-"} paths=${paths.join(",") || "-"}`);
  return NextResponse.json({ revalidated: true, tags, paths, at: Date.now() });
}
