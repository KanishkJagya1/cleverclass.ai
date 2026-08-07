"use client";

/**
 * Email templates.
 *
 * Two things this screen is careful about:
 *
 *   * **Preview before save.** The backend renders with sample data without
 *     persisting, so a broken template is caught here rather than by the first
 *     customer who receives it.
 *   * **Variables are chips, not typed.** A mistyped `{{order_number}}` renders
 *     as literal braces in a real email. Clicking inserts the exact name.
 *
 * Test-send goes only to the signed-in admin — that limit is enforced by the
 * backend, and it is what stops this being an open relay with a login page.
 */

import * as React from "react";
import { Mail, RotateCcw, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Skeleton } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminAuth, useAdminData } from "@/features/admin/auth-context";
import { adminFetch, AdminApiError } from "@/features/admin/api";

interface TemplateRow {
  key: string;
  name: string;
  description: string;
  subject: string | null;
  updatedAt: string | null;
}

export default function AdminTemplatesPage() {
  const { data, error, loading, reload } = useAdminData<{
    templates: TemplateRow[];
  }>("/templates");
  const [openKey, setOpenKey] = React.useState<string | null>(null);

  if (error) {
    return (
      <ErrorState
        title="Couldn't load templates"
        description={error}
        onRetry={reload}
        showPhone={false}
      />
    );
  }

  const rows = data?.templates ?? [];

  return (
    <>
      <AdminPageHeader
        title="Email templates"
        description="What customers receive. Preview before saving — these go out automatically."
      />

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => (
            <li key={t.key} className="surface-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-[color:var(--text-1)]">
                    <Mail className="size-4 text-[color:var(--text-3)]" aria-hidden />
                    {t.name}
                  </p>
                  <p className="mt-0.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                    {t.description}
                  </p>
                  <p className="text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                    {t.updatedAt
                      ? `Customised ${new Date(t.updatedAt).toLocaleDateString("en-IN")}`
                      : "Using the built-in default"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setOpenKey(openKey === t.key ? null : t.key)}
                >
                  {openKey === t.key ? "Close" : "Edit"}
                </Button>
              </div>

              {openKey === t.key ? (
                <TemplateEditor templateKey={t.key} onSaved={reload} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function TemplateEditor({
  templateKey,
  onSaved,
}: {
  templateKey: string;
  onSaved: () => void;
}) {
  const { csrf } = useAdminAuth();
  const { data, loading, reload } = useAdminData<{
    template: { subject: string; source: string };
    variables: string[];
  }>(`/templates/${encodeURIComponent(templateKey)}`, [templateKey]);

  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [preview, setPreview] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (data?.template) {
      setSubject(data.template.subject ?? "");
      setBody(data.template.source ?? "");
    }
  }, [data]);

  function insert(variable: string) {
    const el = bodyRef.current;
    const token = `{{${variable}}}`;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    // Inserted at the cursor rather than appended — appending to the end of a
    // 200-line template is not where anyone wants it.
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function call<T>(path: string, payload?: unknown): Promise<T> {
    return adminFetch<T>(`/templates/${encodeURIComponent(templateKey)}${path}`, {
      method: "POST",
      body: payload,
      csrf,
    });
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setNotice(
        err instanceof AdminApiError || err instanceof Error
          ? err.message
          : "That didn't work",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading || !data) {
    return <Skeleton className="mt-3 h-64 w-full rounded-[var(--radius-md)]" />;
  }

  return (
    <div className="mt-4 space-y-3 border-t border-[var(--border-1)] pt-4">
      {notice ? (
        <p
          className="rounded-[var(--radius-sm)] border border-[var(--border-1)] p-2.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      <label className="block">
        <span className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
          Subject
        </span>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>

      <div>
        <span className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
          Available variables
        </span>
        <div className="flex flex-wrap gap-1.5">
          {data.variables.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insert(v)}
              className="rounded bg-[var(--surface-0)] px-2 py-1 font-mono text-[length:var(--text-xs)] text-[color:var(--text-2)] hover:bg-[var(--border-1)]"
            >
              {`{{${v}}}`}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
          Body
        </span>
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={14}
          className="w-full rounded-[var(--radius-sm)] border border-[var(--border-1)]
                     bg-[var(--surface-1)] p-3 font-mono text-[length:var(--text-xs)]
                     text-[color:var(--text-1)]"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const res = await call<{ html: string }>("/preview", {
                subject,
                body,
              });
              setPreview(res.html);
            })
          }
        >
          Preview
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await adminFetch(`/templates/${encodeURIComponent(templateKey)}`, {
                method: "PUT",
                body: { subject, body },
                csrf,
              });
              setNotice("Saved. New emails use this immediately.");
              reload();
              onSaved();
            })
          }
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await call("/test-send");
              // Named explicitly so nobody wonders where it went — the backend
              // will not send anywhere else.
              setNotice("Sent to your own address.");
            })
          }
        >
          <Send className="mr-2 size-4" />
          Test send
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (!window.confirm("Discard your version and go back to the built-in default?")) {
              return;
            }
            void run(async () => {
              await call("/reset");
              setNotice("Back to the default.");
              reload();
              onSaved();
            });
          }}
        >
          <RotateCcw className="mr-2 size-4" />
          Reset
        </Button>
      </div>

      {preview ? (
        <div>
          <p className="mb-1 text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
            Preview with sample data
          </p>
          {/* Sandboxed: this is rendered HTML from a template that can contain
              anything, and it must not be able to touch the admin session. */}
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={preview}
            className="h-96 w-full rounded-[var(--radius-sm)] border border-[var(--border-1)] bg-white"
          />
        </div>
      ) : null}
    </div>
  );
}
