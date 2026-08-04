"use client";

import * as React from "react";
import { AlertTriangle, Eye, Lock, Redo2, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";
import { adminFetch, AdminApiError } from "./api";
import { useAdminAuth } from "./auth-context";
import { cn } from "@/lib/utils";

/* ==========================================================================
   Free-page ranges — "which pages are the printed sample?"
   ==========================================================================

   The canonical state is a list of RANGES, never a per-page boolean array. A
   400-page book would otherwise be a 400-element diff on every keystroke, and
   the API payload would be absurd. Every mutation goes through `normalise`,
   which sorts, clamps and merges — including MERGING ADJACENT ranges, so 1-5
   and 6-9 become 1-9 rather than leaving a zero-length locked gap between them.

   Two views of that one array, always in step:
     · the grid   — click or drag to paint, for "let me see it"
     · the list   — type "1-12", for "I already know what I want"
   ========================================================================== */

export interface PageRange {
  start: number;
  end: number;
}

export interface FreeRangesState {
  spec: string;
  ranges: PageRange[];
  gaps: PageRange[];
  freePages: number;
  pageCount: number;
  fraction: number;
  description: string;
  maxFraction: number;
  outline: { level: number; title: string; page: number }[];
  state: string;
}

function normalise(ranges: PageRange[], pageCount: number): PageRange[] {
  const clean = ranges
    .map((r) => ({
      start: Math.max(1, Math.min(r.start, r.end)),
      end: Math.min(pageCount, Math.max(r.start, r.end)),
    }))
    .filter((r) => r.start <= r.end && r.start <= pageCount)
    .sort((a, b) => a.start - b.start);

  const merged: PageRange[] = [];
  for (const r of clean) {
    const last = merged[merged.length - 1];
    // `+ 1` is adjacency, not just overlap — see the note above.
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

const isFree = (ranges: PageRange[], page: number) =>
  ranges.some((r) => page >= r.start && page <= r.end);

function togglePages(ranges: PageRange[], pages: number[], free: boolean, pageCount: number) {
  const set = new Set<number>();
  for (const r of ranges) for (let p = r.start; p <= r.end; p++) set.add(p);
  for (const p of pages) (free ? set.add(p) : set.delete(p));

  const out: PageRange[] = [];
  const sorted = [...set].sort((a, b) => a - b);
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && p === last.end + 1) last.end = p;
    else out.push({ start: p, end: p });
  }
  return normalise(out, pageCount);
}

const formatSpec = (ranges: PageRange[]) =>
  ranges.map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`)).join(", ");

const countPages = (ranges: PageRange[]) =>
  ranges.reduce((n, r) => n + (r.end - r.start + 1), 0);

/* -------------------------------------------------------------------------- */

export function FreeRangesEditor({
  slug,
  initial,
  onSaved,
}: {
  slug: string;
  initial: FreeRangesState;
  onSaved?: (state: FreeRangesState) => void;
}) {
  const { csrf } = useAdminAuth();
  const { pageCount, maxFraction, outline } = initial;

  const [ranges, setRanges] = React.useState<PageRange[]>(initial.ranges);
  const [history, setHistory] = React.useState<PageRange[][]>([initial.ranges]);
  const [cursor, setCursor] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmable, setConfirmable] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [specText, setSpecText] = React.useState(initial.spec);

  // Drag-paint state. `mode` is captured on pointerdown and then APPLIED to
  // every page entered — never toggled per page. Toggling on enter produces a
  // stripe pattern the moment you drag back across your own path, which is the
  // classic bug in this control.
  const paint = React.useRef<{ mode: "add" | "erase"; last: number } | null>(null);
  const [anchor, setAnchor] = React.useState<number | null>(null);

  const commit = React.useCallback(
    (next: PageRange[]) => {
      const normalised = normalise(next, pageCount);
      setRanges(normalised);
      setSpecText(formatSpec(normalised));
      setSaved(false);
      setError(null);
      setConfirmable(false);
      setHistory((h) => [...h.slice(0, cursor + 1), normalised].slice(-25));
      setCursor((c) => Math.min(c + 1, 24));
    },
    [cursor, pageCount],
  );

  const undo = () => {
    if (cursor === 0) return;
    const next = history[cursor - 1]!;
    setCursor(cursor - 1);
    setRanges(next);
    setSpecText(formatSpec(next));
  };
  const redo = () => {
    if (cursor >= history.length - 1) return;
    const next = history[cursor + 1]!;
    setCursor(cursor + 1);
    setRanges(next);
    setSpecText(formatSpec(next));
  };

  const free = countPages(ranges);
  const fraction = pageCount ? free / pageCount : 0;
  const overGuardrail = fraction > maxFraction;

  const save = async (force = false) => {
    setSaving(true);
    setError(null);
    try {
      const result = await adminFetch<FreeRangesState & { corpus: unknown }>(
        `/books/${slug}/free-ranges`,
        { method: "PUT", body: { spec: formatSpec(ranges), force }, csrf },
      );
      setSaved(true);
      setConfirmable(false);
      onSaved?.(result);
    } catch (err) {
      const message = err instanceof AdminApiError ? err.message : "Could not save.";
      setError(message);
      // The server refuses an unusually large give-away once, then takes the
      // admin at their word. Surface that as a confirm rather than a dead end.
      setConfirmable(message.includes("Confirm if you meant it"));
    } finally {
      setSaving(false);
    }
  };

  if (initial.state !== "ready") {
    return (
      <div className="surface-card p-5">
        <h2 className="text-[length:var(--text-base)] font-semibold text-[color:var(--text-1)]">
          Free pages
        </h2>
        <p className="mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          {initial.state === "none"
            ? "Upload a PDF first — you cannot choose pages you cannot see."
            : "Waiting for the PDF to finish processing."}
        </p>
      </div>
    );
  }

  return (
    <div className="surface-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[length:var(--text-base)] font-semibold text-[color:var(--text-1)]">
            Free pages
          </h2>
          <p className="mt-1 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            The printed-sample rule: these pages are readable for free, and they
            are the only pages the assistant can ever read.
          </p>
        </div>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="icon-sm" onClick={undo}
                  disabled={cursor === 0} aria-label="Undo">
            <Undo2 className="size-4" aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={redo}
                  disabled={cursor >= history.length - 1} aria-label="Redo">
            <Redo2 className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------ filmstrip + count */}
      <div className="mt-5">
        <div
          className="flex h-6 w-full overflow-hidden rounded-[var(--radius-sm)] bg-[var(--surface-0)]"
          role="img"
          aria-label={`${free} of ${pageCount} pages are free`}
        >
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
            <span
              key={page}
              className={isFree(ranges, page) ? "" : "opacity-100"}
              style={{
                flex: "1 1 0",
                background: isFree(ranges, page)
                  ? "var(--brand-base)"
                  : "var(--surface-0)",
              }}
            />
          ))}
        </div>
        <p
          className={cn(
            "tabular mt-2 text-[length:var(--text-sm)]",
            overGuardrail ? "text-[color:var(--signal-danger)]" : "text-[color:var(--text-2)]",
          )}
        >
          {free === 0
            ? "No free pages — the preview button will be hidden on the storefront."
            : `Giving away ${free} of ${pageCount} pages (${(fraction * 100).toFixed(1)}%).`}
          {overGuardrail && (
            <span className="ml-1 inline-flex items-center gap-1">
              <AlertTriangle className="size-3.5" aria-hidden />
              Above the {Math.round(maxFraction * 100)}% guideline.
            </span>
          )}
        </p>
      </div>

      {/* --------------------------------------------------------- presets */}
      <div className="mt-4 flex flex-wrap gap-2">
        {[6, 10, 15].map((n) => (
          <Button
            key={n}
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => commit([{ start: 1, end: Math.min(n, pageCount) }])}
          >
            First {n} pages
          </Button>
        ))}
        {outline.length > 1 && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              // Everything up to the second bookmark — i.e. chapter one.
              const end = Math.max(1, (outline[1]?.page ?? 2) - 1);
              commit([{ start: 1, end: Math.min(end, pageCount) }]);
            }}
          >
            First chapter
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={() => commit([])}>
          <Trash2 className="size-4" aria-hidden />
          Clear
        </Button>
      </div>

      {/* ------------------------------------------------------- page grid */}
      <div
        className="mt-5 grid gap-1"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(2.25rem, 1fr))" }}
        role="group"
        aria-label="Choose which pages are free"
        onPointerUp={() => {
          paint.current = null;
        }}
        onPointerLeave={() => {
          paint.current = null;
        }}
      >
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => {
          const on = isFree(ranges, page);
          return (
            <button
              key={page}
              type="button"
              aria-pressed={on}
              aria-label={`Page ${page}, ${on ? "free" : "locked"}`}
              className={cn(
                "flex h-9 select-none items-center justify-center rounded-[var(--radius-xs)]",
                "text-[length:var(--text-2xs)] tabular transition-colors",
                on
                  ? "bg-[var(--brand-base)] font-semibold text-[color:var(--brand-on)]"
                  : "bg-[var(--surface-0)] text-[color:var(--text-3)] hover:bg-[var(--border-1)]",
              )}
              // touch-action:none only while painting, so the grid still scrolls.
              style={{ touchAction: paint.current ? "none" : "auto" }}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
                if (e.shiftKey && anchor !== null) {
                  const [a, b] = anchor < page ? [anchor, page] : [page, anchor];
                  const span = Array.from({ length: b - a + 1 }, (_, k) => a + k);
                  commit(togglePages(ranges, span, !isFree(ranges, anchor), pageCount));
                  return;
                }
                paint.current = { mode: on ? "erase" : "add", last: page };
                setAnchor(page);
                commit(togglePages(ranges, [page], !on, pageCount));
              }}
              onPointerEnter={() => {
                const p = paint.current;
                if (!p || p.last === page) return;
                // Fill the whole span, so a fast drag cannot skip pages.
                const [a, b] = p.last < page ? [p.last, page] : [page, p.last];
                const span = Array.from({ length: b - a + 1 }, (_, k) => a + k);
                p.last = page;
                setRanges((current) =>
                  togglePages(current, span, p.mode === "add", pageCount),
                );
              }}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  commit(togglePages(ranges, [page], !on, pageCount));
                }
              }}
            >
              {page}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
        Click a page, or drag across several. Shift-click extends from the last
        page you touched.
      </p>

      {/* -------------------------------------------------- typed spec + gaps */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="range-spec">Or type the ranges</Label>
          <Input
            id="range-spec"
            value={specText}
            onChange={(e) => setSpecText(e.target.value)}
            onBlur={() => {
              // Parse leniently here; the server is the authority and will
              // reject anything genuinely wrong with a usable message.
              const parsed: PageRange[] = [];
              for (const chunk of specText.split(/[,;]+/)) {
                const m = chunk.trim().match(/^(\d+)\s*(?:[-–—]\s*(\d+))?$/);
                if (!m) continue;
                const start = Number(m[1]);
                const end = m[2] ? Number(m[2]) : start;
                parsed.push({ start, end });
              }
              commit(parsed);
            }}
            placeholder="1-12, 45, 60-64"
            aria-describedby="range-spec-hint"
          />
          <p id="range-spec-hint" className="mt-1 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
            Fastest if you already know the pages.
          </p>
        </div>

        <div>
          <Label>Locked sections readers will see</Label>
          <ul className="mt-1 space-y-1 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            {ranges.length === 0 ? (
              <li className="text-[color:var(--text-3)]">Nothing is free yet.</li>
            ) : (
              gapsOf(ranges, pageCount).map((g) => (
                <li key={`${g.start}-${g.end}`} className="flex items-center gap-2">
                  <Lock className="size-3.5 shrink-0 text-[color:var(--text-3)]" aria-hidden />
                  <span className="tabular">
                    {g.start === g.end ? `Page ${g.start}` : `Pages ${g.start}–${g.end}`}
                  </span>
                </li>
              ))
            )}
          </ul>
          <p className="mt-1 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
            Readers see these as locked, not skipped — that gap is the strongest
            reason to buy.
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------- save */}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--border-1)] pt-4">
        <Button type="button" onClick={() => void save(false)} loading={saving}>
          Save free pages
        </Button>
        {confirmable && (
          <Button type="button" variant="danger" onClick={() => void save(true)} loading={saving}>
            Yes, give away {(fraction * 100).toFixed(0)}%
          </Button>
        )}
        <Button asChild variant="secondary" size="sm">
          <a href={`/shop/${slug}/preview`} target="_blank" rel="noreferrer">
            <Eye className="size-4" aria-hidden />
            Preview as a customer
          </a>
        </Button>

        <span className="min-w-0 flex-1 text-[length:var(--text-sm)]">
          {error ? (
            <span role="alert" className="text-[color:var(--signal-danger)]">{error}</span>
          ) : saved ? (
            <span className="text-[color:var(--signal-gain)]">
              Saved — the assistant now reads only these pages.
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function gapsOf(ranges: PageRange[], pageCount: number): PageRange[] {
  const out: PageRange[] = [];
  let cursor = 1;
  for (const r of ranges) {
    if (r.start > cursor) out.push({ start: cursor, end: r.start - 1 });
    cursor = r.end + 1;
  }
  if (cursor <= pageCount) out.push({ start: cursor, end: pageCount });
  return out;
}
