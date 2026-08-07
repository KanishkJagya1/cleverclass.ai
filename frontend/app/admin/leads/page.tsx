"use client";

import * as React from "react";

import { Mail } from "lucide-react";
import { Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import {
  Pagination,
  usePaginatedAdminData,
} from "@/features/admin/pagination";

interface Lead {
  id: string;
  kind: string;
  name: string;
  email: string;
  phone: string;
  topic: string;
  message: string;
  handled: number;
  created_at: string;
}

export default function AdminLeadsPage() {
  // Unhandled-only is the default view: the question this screen answers is
  // "what has nobody replied to", and with everything mixed in the new
  // enquiries sink below the fold as older ones pile up.
  const [kind, setKind] = React.useState("");
  const [unhandledOnly, setUnhandledOnly] = React.useState(true);

  const { data, error, loading, reload, page, setPage } =
    usePaginatedAdminData<Lead>("/leads", {
      kind,
      handled: unhandledOnly ? "false" : "",
    }, 10);
  const rows = data?.items ?? [];

  if (error) {
    return (
      <ErrorState title="Couldn't load enquiries" description={error} onRetry={reload} showPhone={false} />
    );
  }

  return (
    <>
      <AdminPageHeader
        title="Enquiries"
        description="Contact form submissions and newsletter signups."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[length:var(--text-sm)]">
          <span className="sr-only">Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            aria-label="Enquiry kind"
            className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--border-1)]
                       bg-[var(--surface-1)] px-3 text-[color:var(--text-1)]"
          >
            <option value="">All kinds</option>
            <option value="contact">Contact form</option>
            <option value="newsletter">Newsletter</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          <input
            type="checkbox"
            checked={unhandledOnly}
            onChange={(e) => setUnhandledOnly(e.target.checked)}
          />
          Unhandled only
        </label>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="Nothing yet"
          description="Messages from the contact form will appear here."
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((l) => (
            <li key={l.id} className="surface-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-[color:var(--text-1)]">
                  {l.name || l.email}
                  <span className="ml-2 rounded-full bg-[var(--surface-0)] px-2 py-0.5 text-[length:var(--text-2xs)] font-medium text-[color:var(--text-2)]">
                    {l.kind}
                  </span>
                </p>
                <p className="text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                  {new Date(l.created_at).toLocaleString("en-IN")}
                </p>
              </div>
              <p className="mt-1 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                <a href={`mailto:${l.email}`} className="text-[color:var(--text-brand)]">
                  {l.email}
                </a>
                {l.phone && (
                  <>
                    {" · "}
                    <a href={`tel:${l.phone}`} className="text-[color:var(--text-brand)]">
                      {l.phone}
                    </a>
                  </>
                )}
                {l.topic && <> · {l.topic}</>}
              </p>
              {l.message && (
                <p className="mt-2 whitespace-pre-wrap text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                  {l.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 ? (
        <div className="mt-4">
          <Pagination
            page={page}
            totalPages={data?.totalPages ?? 0}
            total={data?.total ?? 0}
            perPage={data?.perPage ?? 50}
            onPage={setPage}
            noun="enquiry"
          />
        </div>
      ) : null}
    </>
  );
}
