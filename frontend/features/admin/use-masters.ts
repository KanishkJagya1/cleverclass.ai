"use client";

/**
 * The five master lists, for form pickers.
 *
 * Reads the public catalogue endpoint rather than the admin one: it returns
 * only ACTIVE entries, which is exactly what a picker should offer. The admin
 * masters screen deliberately uses the other endpoint, because managing a list
 * means seeing the hidden entries too.
 *
 * Falls back to the hardcoded constants when the request fails. Without that,
 * a backend blip would render a book form with five empty dropdowns and no way
 * to tell that the data — not the catalogue — is missing.
 */

import * as React from "react";

import { CLASSES, SERIES, SUBJECTS } from "@/constants/catalog";

export interface MasterOption {
  code: string;
  label: string;
  appliesTo: string[];
}

export interface Masters {
  class: MasterOption[];
  series: MasterOption[];
  board: MasterOption[];
  subject: MasterOption[];
  stream: MasterOption[];
}

const FALLBACK: Masters = {
  class: CLASSES.map((c) => ({ code: c.id, label: c.label, appliesTo: [] })),
  series: SERIES.map((s) => ({ code: s.id, label: s.label, appliesTo: [] })),
  board: [
    { code: "state", label: "Maharashtra State Board", appliesTo: [] },
    { code: "cbse", label: "CBSE", appliesTo: [] },
  ],
  subject: SUBJECTS.map((s) => ({ code: s, label: s, appliesTo: [] })),
  stream: [
    { code: "science-pcm", label: "Science PCM", appliesTo: ["11", "12"] },
    { code: "science-pcb", label: "Science PCB", appliesTo: ["11", "12"] },
    { code: "science-pcbm", label: "Science PCBM", appliesTo: ["11", "12"] },
    { code: "commerce", label: "Commerce", appliesTo: ["11", "12"] },
    { code: "arts", label: "Arts", appliesTo: ["11", "12"] },
  ],
};

export function useMasters(): { masters: Masters; loading: boolean } {
  const [masters, setMasters] = React.useState<Masters>(FALLBACK);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/catalog/masters", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((data: Partial<Masters>) => {
        if (cancelled) return;
        // Per-kind fallback: a kind that is somehow empty keeps its constants
        // rather than rendering an unusable empty dropdown.
        setMasters({
          class: data.class?.length ? data.class : FALLBACK.class,
          series: data.series?.length ? data.series : FALLBACK.series,
          board: data.board?.length ? data.board : FALLBACK.board,
          subject: data.subject?.length ? data.subject : FALLBACK.subject,
          stream: data.stream?.length ? data.stream : FALLBACK.stream,
        });
      })
      .catch(() => {
        /* keep the fallback */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { masters, loading };
}
