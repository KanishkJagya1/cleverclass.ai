"use client";

/**
 * Bulk catalogue import.
 *
 * Built around the dry run, not the upload. Choosing a file validates it and
 * shows exactly what would change; the button that writes appears only once
 * the file is clean. Someone pasting 300 rows out of Excel cannot see what the
 * file contains, so the tool has to show them before it touches the catalogue.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminAuth } from "@/features/admin/auth-context";
import { adminFetch, AdminApiError } from "@/features/admin/api";

interface BulkResult {
  dryRun: boolean;
  rows: number;
  created: number;
  updated: number;
  errors: string[];
  sampleCreated: string[];
  sampleUpdated: string[];
  applied: boolean;
}

export default function BulkImportPage() {
  const router = useRouter();
  const { csrf } = useAdminAuth();
  const [file, setFile] = React.useState<File | null>(null);
  const [result, setResult] = React.useState<BulkResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const send = React.useCallback(
    async (chosen: File, apply: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const body = new FormData();
        body.append("file", chosen);
        const data = await adminFetch<BulkResult>(
          `/books/bulk?apply=${apply}`,
          { method: "POST", body, csrf },
        );
        setResult(data);
        if (data.applied) {
          // Land on the catalogue so the operator can see what changed rather
          // than trusting a success message.
          setTimeout(() => router.push("/admin/books"), 1500);
        }
      } catch (err) {
        setError(
          err instanceof AdminApiError || err instanceof Error
            ? err.message
            : "Import failed",
        );
      } finally {
        setBusy(false);
      }
    },
    [csrf, router],
  );

  function onPick(chosen: File | null) {
    setFile(chosen);
    setResult(null);
    setError(null);
    if (chosen) void send(chosen, false); // validate immediately, write nothing
  }

  const clean = result !== null && result.errors.length === 0 && !result.applied;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Bulk import"
        description="Upload a CSV to add or update books. Nothing is written until you confirm."
      />

      <section className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">1. Start from the template</h2>
            <p className="text-sm text-muted-foreground">
              It carries every accepted column and one worked example row.
            </p>
          </div>
          <Button asChild variant="outline">
            <a href="/admin-api/books/bulk/template" download>
              <Download className="mr-2 size-4" />
              Download template
            </a>
          </Button>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-medium">2. Choose your file</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Save as <strong>CSV UTF-8</strong> so Marathi titles survive. Up to
          2000 rows.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0
                     file:bg-primary file:px-4 file:py-2 file:text-sm
                     file:font-medium file:text-primary-foreground"
        />
        {file ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {file.name} · {(file.size / 1024).toFixed(0)} KB
          </p>
        ) : null}
      </section>

      {busy ? (
        <p className="text-sm text-muted-foreground">Checking the file…</p>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {error}
        </div>
      ) : null}

      {result ? (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-medium">
            {result.applied ? "Imported" : "3. Check what would change"}
          </h2>

          {result.errors.length > 0 ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm font-medium text-destructive">
                {result.errors.length} problem
                {result.errors.length === 1 ? "" : "s"} — nothing was written.
                Fix these and choose the file again.
              </p>
              <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg bg-muted/50 p-3">
                {result.errors.map((e) => (
                  <li key={e} className="font-mono text-xs">
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                <Stat label="Rows" value={result.rows} />
                <Stat label="New books" value={result.created} />
                <Stat label="Updated" value={result.updated} />
              </div>

              {result.sampleCreated.length > 0 ? (
                <Sample
                  title="New (first 10)"
                  items={result.sampleCreated}
                  note="New books are created as drafts — publish them once you have checked them."
                />
              ) : null}
              {result.sampleUpdated.length > 0 ? (
                <Sample
                  title="Updated (first 10)"
                  items={result.sampleUpdated}
                  note="Only the columns present in your file are changed."
                />
              ) : null}
            </>
          )}

          {result.applied ? (
            <p className="mt-4 text-sm font-medium text-emerald-600">
              Done. Taking you to the catalogue…
            </p>
          ) : null}

          {clean && file ? (
            <Button
              className="mt-4"
              disabled={busy}
              onClick={() => void send(file, true)}
            >
              <Upload className="mr-2 size-4" />
              Apply {result.rows} row{result.rows === 1 ? "" : "s"}
            </Button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Sample({
  title,
  items,
  note,
}: {
  title: string;
  items: string[];
  note: string;
}) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {items.map((slug) => (
          <li key={slug} className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
            {slug}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
