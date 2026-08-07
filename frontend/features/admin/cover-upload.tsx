"use client";

/**
 * Book cover upload.
 *
 * Shows the current cover and replaces it. There is deliberately only ever one
 * front cover per book — the backend replaces rather than appends, because a
 * list that accumulates every upload silently keeps showing the first one.
 */

import * as React from "react";
import { ImageIcon, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAdminAuth } from "@/features/admin/auth-context";
import { adminFetch, AdminApiError } from "@/features/admin/api";

const MAX_MB = 8;

export function CoverUpload({
  slug,
  initialSrc,
}: {
  slug: string;
  initialSrc?: string | null;
}) {
  const { csrf } = useAdminAuth();
  const [src, setSrc] = React.useState<string | null>(initialSrc ?? null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<
    { tone: "ok" | "bad"; text: string } | null
  >(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    // Checked here as well as on the server so the person does not wait for an
    // 8 MB round trip to be told the file is too big.
    if (file.size > MAX_MB * 1024 * 1024) {
      setMessage({
        tone: "bad",
        text: `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_MB} MB.`,
      });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await adminFetch<{ src: string }>(
        `/books/${encodeURIComponent(slug)}/cover`,
        { method: "POST", body, csrf },
      );
      // Cache-busted: the URL is content-hashed, but if someone re-uploads the
      // identical file the hash is the same and the browser would show the old
      // render.
      setSrc(`${result.src}?v=${Date.now()}`);
      setMessage({ tone: "ok", text: "Cover updated." });
    } catch (err) {
      setMessage({
        tone: "bad",
        text:
          err instanceof AdminApiError || err instanceof Error
            ? err.message
            : "Couldn't upload that",
      });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="surface-card p-4">
      <h2 className="font-medium text-[color:var(--text-1)]">Cover image</h2>
      <p className="mt-0.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
        The front cover shown in the shop. JPG, PNG or WebP, up to {MAX_MB} MB.
      </p>

      <div className="mt-3 flex flex-wrap items-start gap-4">
        <div className="grid h-40 w-32 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-1)] bg-[var(--surface-0)]">
          {src ? (
            // Plain <img>: the src is a runtime API path, not something
            // next/image can size at build time.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt="Current cover"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="text-center">
              <ImageIcon className="mx-auto size-6 text-[color:var(--text-3)]" />
              <p className="mt-1 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                No cover
              </p>
            </div>
          )}
        </div>

        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="mr-2 size-4" />
            {busy ? "Uploading…" : src ? "Replace cover" : "Upload cover"}
          </Button>

          {message ? (
            <p
              className={
                message.tone === "ok"
                  ? "mt-2 text-[length:var(--text-sm)] text-emerald-600"
                  : "mt-2 text-[length:var(--text-sm)] text-destructive"
              }
              role="status"
            >
              {message.text}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
