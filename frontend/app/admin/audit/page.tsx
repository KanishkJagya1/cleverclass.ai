"use client";

import * as React from "react";

import { ScrollText, Search } from "lucide-react";
import { Input, Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import {
  Pagination,
  usePaginatedAdminData,
} from "@/features/admin/pagination";

interface AuditRow {
  id: number;
  action: string;
  entity: string | null;
  entity_id: string | null;
  detail: string;
  ip: string | null;
  email: string | null;
  created_at: string;
}

function summarise(detail: string): string {
  try {
    const parsed = JSON.parse(detail || "{}");
    return Object.entries(parsed)
      .map(([k, v]) => `${k}=${v}`)
      .join("  ");
  } catch {
    // A stored detail that is not valid JSON is not worth failing a page over.
    return "";
  }
}

export default function AdminAuditPage() {
  // Filtering by entity id is what turns this from a scrolling wall into an
  // answer to "who changed this order, and when".
  const [entity, setEntity] = React.useState("");
  const [entityId, setEntityId] = React.useState("");
  const [debouncedId, setDebouncedId] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedId(entityId.trim()), 300);
    return () => clearTimeout(t);
  }, [entityId]);

  const { data, error, loading, reload, page, setPage } =
    usePaginatedAdminData<AuditRow>("/audit", {
      entity,
      entityId: debouncedId,
    }, 10);
  const rows = data?.items ?? [];

  if (error) {
    return (
      <ErrorState title="Couldn't load activity" description={error} onRetry={reload} showPhone={false} />
    );
  }

  return (
    <>
      <AdminPageHeader
        title="Activity"
        description="Every admin action, with who did it and when."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-[length:var(--text-sm)]">
          <span className="sr-only">Entity type</span>
          <select
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            aria-label="Entity type"
            className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--border-1)]
                       bg-[var(--surface-1)] px-3 text-[color:var(--text-1)]"
          >
            <option value="">Everything</option>
            <option value="book">Books</option>
            <option value="order">Orders</option>
            <option value="books">Bulk imports</option>
            <option value="customer">Customers</option>
            <option value="ticket">Support tickets</option>
            <option value="admin">Staff</option>
          </select>
        </label>
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--text-3)]"
            aria-hidden
          />
          <Input
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder="Order number or book slug"
            aria-label="Filter by id"
            className="pl-9"
          />
        </div>
        {entity || entityId ? (
          <button
            type="button"
            onClick={() => {
              setEntity("");
              setEntityId("");
            }}
            className="min-h-11 text-[length:var(--text-sm)] font-medium text-[color:var(--text-brand)]"
          >
            Clear
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No activity recorded yet" />
      ) : (
        <ul className="divide-y divide-[var(--border-1)]">
          {rows.map((a) => {
            const detail = summarise(a.detail);
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-[length:var(--text-sm)]"
              >
                <span className="font-medium text-[color:var(--text-1)]">{a.action}</span>
                {a.entity_id && <span className="text-[color:var(--text-2)]">{a.entity_id}</span>}
                {detail && (
                  <span className="tabular text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                    {detail}
                  </span>
                )}
                <span className="ml-auto text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                  {a.email ?? "—"} · {new Date(a.created_at).toLocaleString("en-IN")}
                </span>
              </li>
            );
          })}
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
            noun="entry"
          />
        </div>
      ) : null}
    </>
  );
}
