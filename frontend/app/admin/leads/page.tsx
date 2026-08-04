"use client";

import { Mail } from "lucide-react";
import { Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminData } from "@/features/admin/auth-context";

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
  const { data, error, loading, reload } = useAdminData<Lead[]>("/leads");

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

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : !data?.length ? (
        <EmptyState
          icon={Mail}
          title="Nothing yet"
          description="Messages from the contact form will appear here."
        />
      ) : (
        <ul className="space-y-3">
          {data.map((l) => (
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
    </>
  );
}
