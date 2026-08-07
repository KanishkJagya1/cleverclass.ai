"use client";

/**
 * Master data — the five lists the catalogue is built from.
 *
 * The usage count is the most important column on this screen. `books` stores
 * these values as text, not as a foreign key, so deleting one that is in use
 * would silently strand every book using it. The backend refuses; this shows
 * the number up front so the refusal is never a surprise.
 */

import * as React from "react";
import { Layers, Pencil, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Skeleton } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminAuth, useAdminData } from "@/features/admin/auth-context";
import { adminFetch, AdminApiError } from "@/features/admin/api";

type Kind = "class" | "series" | "board" | "subject" | "stream";

const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: "class", label: "Classes", hint: "Nursery, Class 5–12, Board Exam" },
  { id: "series", label: "Series", hint: "Kohinoor, Vidyamitra, Spark…" },
  { id: "board", label: "Boards", hint: "State, CBSE" },
  { id: "subject", label: "Subjects", hint: "Science, Mathematics…" },
  { id: "stream", label: "Streams", hint: "Classes 11–12 only" },
];

interface Master {
  id: string;
  kind: Kind;
  code: string;
  label: string;
  labelMr: string;
  appliesTo: string[];
  sortOrder: number;
  isActive: boolean;
  usageCount: number;
}

interface MastersResponse {
  items: Master[];
  streamClasses: string[];
}

export default function AdminMastersPage() {
  const { csrf } = useAdminAuth();
  const [kind, setKind] = React.useState<Kind>("class");
  const { data, error, loading, reload } =
    useAdminData<MastersResponse>("/masters");

  const [editing, setEditing] = React.useState<Master | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [message, setMessage] = React.useState<
    { tone: "ok" | "bad"; text: string } | null
  >(null);
  const [busy, setBusy] = React.useState(false);

  const rows = (data?.items ?? []).filter((m) => m.kind === kind);

  async function remove(m: Master) {
    if (
      !window.confirm(
        `Delete “${m.label}”? This cannot be undone, but it is refused if any book still uses it.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await adminFetch(`/masters/${m.id}`, { method: "DELETE", csrf });
      setMessage({ tone: "ok", text: `Deleted ${m.label}.` });
      reload();
    } catch (err) {
      // The 409 body explains how many books use it and offers deactivation —
      // far more useful than a generic failure toast.
      setMessage({
        tone: "bad",
        text:
          err instanceof AdminApiError || err instanceof Error
            ? err.message
            : "Couldn't delete that",
      });
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(m: Master) {
    setBusy(true);
    setMessage(null);
    try {
      await adminFetch(`/masters/${m.id}`, {
        method: "PUT",
        body: { isActive: !m.isActive },
        csrf,
      });
      setMessage({
        tone: "ok",
        text: `${m.label} is now ${m.isActive ? "hidden" : "visible"}.`,
      });
      reload();
    } catch (err) {
      setMessage({
        tone: "bad",
        text: err instanceof Error ? err.message : "Couldn't update that",
      });
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <ErrorState
        title="Couldn't load master data"
        description={error}
        onRetry={reload}
        showPhone={false}
      />
    );
  }

  return (
    <>
      <AdminPageHeader
        title="Master data"
        description="The lists every book is built from. Changes appear across the shop immediately."
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus className="mr-2 size-4" />
            Add {KINDS.find((k) => k.id === kind)?.label.replace(/e?s$/, "")}
          </Button>
        }
      />

      {message ? (
        <p
          className={
            message.tone === "ok"
              ? "mb-4 rounded-[var(--radius-md)] border border-emerald-500/40 bg-emerald-500/10 p-3 text-[length:var(--text-sm)]"
              : "mb-4 rounded-[var(--radius-md)] border border-destructive/40 bg-destructive/10 p-3 text-[length:var(--text-sm)]"
          }
          role="status"
        >
          {message.text}
        </p>
      ) : null}

      <div
        className="mb-5 flex flex-wrap gap-2"
        role="tablist"
        aria-label="Master type"
      >
        {KINDS.map((k) => {
          const count = (data?.items ?? []).filter((m) => m.kind === k.id).length;
          return (
            <button
              key={k.id}
              role="tab"
              aria-selected={kind === k.id}
              onClick={() => setKind(k.id)}
              className={
                kind === k.id
                  ? "min-h-11 rounded-[var(--radius-sm)] bg-[var(--brand)] px-4 text-[length:var(--text-sm)] font-medium text-white"
                  : "min-h-11 rounded-[var(--radius-sm)] border border-[var(--border-1)] px-4 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
              }
            >
              {k.label}
              <span className="ml-1.5 opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <p className="mb-3 text-[length:var(--text-sm)] text-[color:var(--text-3)]">
        {KINDS.find((k) => k.id === kind)?.hint}
      </p>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="surface-card p-8 text-center">
          <Layers className="mx-auto size-8 text-[color:var(--text-3)]" />
          <p className="mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            Nothing here yet.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[length:var(--text-sm)]">
            <thead>
              <tr className="border-b border-[var(--border-1)] text-left text-[color:var(--text-3)]">
                <Th>Label</Th>
                <Th>Code</Th>
                {kind === "stream" ? <Th>Classes</Th> : null}
                <Th>Books</Th>
                <Th>Visible</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-[var(--border-1)] last:border-0"
                >
                  <td className="py-2.5 pr-3">
                    <span className="font-medium text-[color:var(--text-1)]">
                      {m.label}
                    </span>
                    {m.labelMr ? (
                      <span className="ml-2 text-[color:var(--text-3)]">
                        {m.labelMr}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-[length:var(--text-xs)] text-[color:var(--text-2)]">
                    {m.code}
                  </td>
                  {kind === "stream" ? (
                    <td className="py-2.5 pr-3 text-[color:var(--text-2)]">
                      {m.appliesTo.join(", ") || "—"}
                    </td>
                  ) : null}
                  <td className="py-2.5 pr-3 tabular text-[color:var(--text-2)]">
                    {m.usageCount}
                  </td>
                  <td className="py-2.5 pr-3">
                    <button
                      type="button"
                      onClick={() => void toggleActive(m)}
                      disabled={busy}
                      className={
                        m.isActive
                          ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-[length:var(--text-2xs)] font-medium text-emerald-600"
                          : "rounded-full bg-[var(--surface-0)] px-2 py-0.5 text-[length:var(--text-2xs)] font-medium text-[color:var(--text-3)]"
                      }
                    >
                      {m.isActive ? "Visible" : "Hidden"}
                    </button>
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      type="button"
                      aria-label={`Edit ${m.label}`}
                      onClick={() => setEditing(m)}
                      className="mr-1 inline-flex size-9 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--text-2)] hover:bg-[var(--surface-0)]"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${m.label}`}
                      disabled={busy}
                      onClick={() => void remove(m)}
                      className="inline-flex size-9 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--text-2)] hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding || editing ? (
        <MasterDialog
          kind={kind}
          master={editing}
          streamClasses={data?.streamClasses ?? ["11", "12"]}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={(text) => {
            setAdding(false);
            setEditing(null);
            setMessage({ tone: "ok", text });
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`py-2 pr-3 text-[length:var(--text-xs)] font-medium uppercase tracking-wide ${className}`}
    >
      {children}
    </th>
  );
}

function MasterDialog({
  kind,
  master,
  streamClasses,
  onClose,
  onSaved,
}: {
  kind: Kind;
  master: Master | null;
  streamClasses: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { csrf } = useAdminAuth();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [applies, setApplies] = React.useState<string[]>(
    master?.appliesTo ?? streamClasses,
  );

  // A code in use cannot change — the books store it. Saying so on the field
  // beats letting them type a new one and rejecting it on save.
  const codeLocked = Boolean(master && master.usageCount > 0);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const payload = {
        label: String(form.get("label") ?? ""),
        labelMr: String(form.get("labelMr") ?? ""),
        sortOrder: Number(form.get("sortOrder") ?? 0),
        ...(kind === "stream" ? { appliesTo: applies } : {}),
        ...(codeLocked ? {} : { code: String(form.get("code") ?? "") }),
      };
      if (master) {
        await adminFetch(`/masters/${master.id}`, {
          method: "PUT",
          body: payload,
          csrf,
        });
      } else {
        await adminFetch("/masters", {
          method: "POST",
          body: { kind, isActive: true, ...payload },
          csrf,
        });
      }
      onSaved(master ? `Updated ${payload.label}.` : `Added ${payload.label}.`);
    } catch (err) {
      setError(
        err instanceof AdminApiError || err instanceof Error
          ? err.message
          : "Couldn't save that",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={master ? "Edit master" : "Add master"}
    >
      <div className="w-full max-w-md rounded-[var(--radius-lg)] bg-[var(--surface-1)] p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
            {master ? `Edit ${master.label}` : `Add ${kind}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-9 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--text-2)]"
          >
            <X className="size-4" />
          </button>
        </div>

        {error ? (
          <p className="mb-3 rounded-[var(--radius-sm)] border border-destructive/40 bg-destructive/10 p-2.5 text-[length:var(--text-sm)]">
            {error}
          </p>
        ) : null}

        <form onSubmit={save} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
              Label
            </span>
            <Input name="label" defaultValue={master?.label ?? ""} required />
          </label>

          <label className="block">
            <span className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
              Marathi label (optional)
            </span>
            <Input name="labelMr" defaultValue={master?.labelMr ?? ""} />
          </label>

          <label className="block">
            <span className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
              Code
            </span>
            <Input
              name="code"
              defaultValue={master?.code ?? ""}
              disabled={codeLocked}
              required={!codeLocked}
            />
            <span className="mt-1 block text-[length:var(--text-xs)] text-[color:var(--text-3)]">
              {codeLocked
                ? `Used by ${master?.usageCount} book${master?.usageCount === 1 ? "" : "s"}, so it cannot change. Edit the label instead.`
                : "Stored on every book and used in URLs. Spaces and capitals are converted automatically."}
            </span>
          </label>

          {kind === "stream" ? (
            <fieldset>
              <legend className="mb-1 text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                Applies to
              </legend>
              <div className="flex gap-3">
                {streamClasses.map((c) => (
                  <label
                    key={c}
                    className="flex min-h-11 items-center gap-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
                  >
                    <input
                      type="checkbox"
                      checked={applies.includes(c)}
                      onChange={(e) =>
                        setApplies((prev) =>
                          e.target.checked
                            ? [...prev, c]
                            : prev.filter((x) => x !== c),
                        )
                      }
                    />
                    Class {c}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <label className="block">
            <span className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
              Sort order
            </span>
            <Input
              name="sortOrder"
              type="number"
              defaultValue={master?.sortOrder ?? 0}
            />
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
