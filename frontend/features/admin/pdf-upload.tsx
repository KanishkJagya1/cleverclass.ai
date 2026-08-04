"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetch } from "./api";
import { useAdminAuth } from "./auth-context";

export interface PdfStatus {
  state: "none" | "pending" | "processing" | "ready" | "failed";
  assetId?: string;
  pageCount?: number;
  pagesDone?: number;
  error?: string | null;
  originalName?: string;
  outline?: { level: number; title: string; page: number }[];
}

/**
 * Upload a book PDF and watch it process.
 *
 * `XMLHttpRequest`, not `fetch`: fetch has no upload-progress event, and a
 * 200 MB PDF over a domestic connection with no progress bar looks like a
 * hang. This is the one place XHR is still the right tool.
 *
 * The server returns 202 immediately and extracts text in the background, so
 * after the upload completes we poll until the asset is ready.
 */
export function PdfUpload({
  slug,
  status,
  onStatusChange,
}: {
  slug: string;
  status: PdfStatus;
  onStatusChange: (status: PdfStatus) => void;
}) {
  const { csrf } = useAdminAuth();
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const processing = status.state === "pending" || status.state === "processing";

  // Poll while the background worker runs. 1.2s is fast enough to feel live
  // and slow enough not to hammer a single-worker service.
  React.useEffect(() => {
    if (!processing) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await adminFetch<PdfStatus>(`/books/${slug}/pdf-status`);
        if (!cancelled) onStatusChange(next);
      } catch {
        /* a dropped poll is not worth surfacing; the next one will land */
      }
    };
    const id = setInterval(tick, 1200);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [processing, slug, onStatusChange]);

  const upload = (file: File) => {
    setError(null);
    setProgress(0);
    setUploading(true);

    const form = new FormData();
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/admin-api/books/${slug}/pdf`);
    xhr.withCredentials = true;
    if (csrf) xhr.setRequestHeader("X-CSRF-Token", csrf);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      setUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText);
          onStatusChange({
            state: "pending",
            assetId: body.assetId,
            pageCount: body.pageCount,
            pagesDone: 0,
            originalName: file.name,
            outline: body.outline ?? [],
          });
        } catch {
          onStatusChange({ state: "pending" });
        }
      } else {
        let message = `Upload failed (${xhr.status})`;
        try {
          message = JSON.parse(xhr.responseText).detail ?? message;
        } catch {
          /* non-JSON error body */
        }
        setError(message);
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setError("The upload could not reach the server.");
    };

    xhr.send(form);
  };

  return (
    <div className="surface-card p-5">
      <h2 className="text-[length:var(--text-base)] font-semibold text-[color:var(--text-1)]">
        Book PDF
      </h2>
      <p className="mt-1 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
        The pages you mark as free are rendered from this file. It is never
        served directly — only the free pages, one image at a time.
      </p>

      {status.state === "ready" && (
        <p className="mt-3 flex items-start gap-2 text-[length:var(--text-sm)] text-[color:var(--signal-gain)]">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {status.originalName} — {status.pageCount} pages, text extracted.
          </span>
        </p>
      )}

      {/* A scanned PDF still previews as images but gives the assistant
          nothing to read. Say so here rather than letting it be a mystery. */}
      {status.state === "ready" && status.error && (
        <p className="mt-3 flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--signal-warn-soft,var(--surface-0))] px-3 py-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{status.error}</span>
        </p>
      )}

      {status.state === "failed" && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-[length:var(--text-sm)] text-[color:var(--signal-danger)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{status.error ?? "That PDF could not be processed."}</span>
        </p>
      )}

      {processing && (
        <div className="mt-4">
          <p className="flex items-center gap-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            Extracting text — {status.pagesDone ?? 0} of {status.pageCount ?? "?"} pages
          </p>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-0)]"
            role="progressbar"
            aria-valuenow={status.pagesDone ?? 0}
            aria-valuemin={0}
            aria-valuemax={status.pageCount ?? 100}
            aria-label="Text extraction progress"
          >
            <div
              className="h-full bg-[var(--brand-base)] transition-[width] duration-[var(--duration-base)]"
              style={{
                width: `${Math.round(((status.pagesDone ?? 0) / (status.pageCount || 1)) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {uploading && (
        <div className="mt-4">
          <p className="text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            Uploading… {progress}%
          </p>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-0)]"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Upload progress"
          >
            <div
              className="h-full bg-[var(--brand-base)] transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[length:var(--text-sm)] text-[color:var(--signal-danger)]">
          {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }}
      />

      <Button
        type="button"
        variant={status.state === "ready" ? "secondary" : "primary"}
        className="mt-4"
        loading={uploading}
        onClick={() => inputRef.current?.click()}
      >
        <FileUp className="size-4" aria-hidden />
        {status.state === "ready" ? "Replace PDF" : "Upload PDF"}
      </Button>

      {status.state === "ready" && (
        <p className="mt-2 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
          Replacing the PDF clears the current free pages — page 12 of a new
          file is not page 12 of the old one.
        </p>
      )}
    </div>
  );
}
