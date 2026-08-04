"use client";

import { ScrollText } from "lucide-react";
import { Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminData } from "@/features/admin/auth-context";

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
  const { data, error, loading, reload } = useAdminData<AuditRow[]>("/audit");

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

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : !data?.length ? (
        <EmptyState icon={ScrollText} title="No activity recorded yet" />
      ) : (
        <ul className="divide-y divide-[var(--border-1)]">
          {data.map((a) => {
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
    </>
  );
}
