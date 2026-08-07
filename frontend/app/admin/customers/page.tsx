"use client";

/**
 * Registered users.
 *
 * A list screen deliberately shows no addresses — the backend's row shape
 * omits them, because a screenshot of this page should not be a data leak.
 * Addresses live on the individual customer record where there is a reason to
 * look at one.
 */

import * as React from "react";
import { Search, Users } from "lucide-react";

import { Input, Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { Pagination, usePaginatedAdminData } from "@/features/admin/pagination";
import { formatPrice } from "@/lib/utils";

interface CustomerRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  emailVerified: boolean;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  orderCount: number;
  totalSpend: number;
}

// Must match `customer_admin.set_status`, which accepts active|disabled.
// "blocked" was wrong and the filter silently returned nothing.
const STATUSES = ["", "active", "disabled", "anonymised"] as const;

export default function AdminCustomersPage() {
  const [term, setTerm] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [debounced, setDebounced] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(t);
  }, [term]);

  const { data, error, loading, reload, page, setPage } =
    usePaginatedAdminData<CustomerRow>(
      "/customers",
      { q: debounced, status },
      10,
    );

  if (error) {
    return (
      <ErrorState
        title="Couldn't load users"
        description={error}
        onRetry={reload}
        showPhone={false}
      />
    );
  }

  const rows = data?.items ?? [];

  return (
    <>
      <AdminPageHeader
        title="Users"
        description={
          data ? `${data.total} registered` : "Everyone with an account."
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--text-3)]"
            aria-hidden
          />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Name, email or mobile"
            aria-label="Search users"
            className="pl-9"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Account status"
          className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--border-1)]
                     bg-[var(--surface-1)] px-3 text-[color:var(--text-1)]"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "" ? "Any status" : s}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={debounced || status ? "No users match" : "No users yet"}
          description={
            debounced || status
              ? "Try a different search or clear the filter."
              : "Accounts created on the site will appear here."
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[length:var(--text-sm)]">
              <thead>
                <tr className="border-b border-[var(--border-1)] text-left text-[color:var(--text-3)]">
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Mobile</Th>
                  <Th>Registered</Th>
                  <Th>Orders</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-[var(--border-1)] last:border-0"
                  >
                    <td className="py-2.5 pr-3 font-medium text-[color:var(--text-1)]">
                      {c.name || "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-[color:var(--text-2)]">
                      {c.email}
                      {/* Shown because an unverified address is the usual
                          reason a customer says they never got the email. */}
                      {!c.emailVerified ? (
                        <span className="ml-1.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[length:var(--text-2xs)] font-medium text-amber-700">
                          unverified
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3 tabular text-[color:var(--text-2)]">
                      {c.phone || "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-[color:var(--text-2)]">
                      {new Date(c.createdAt).toLocaleDateString("en-IN")}
                    </td>
                    <td className="py-2.5 pr-3 tabular text-[color:var(--text-2)]">
                      {c.orderCount}
                      {c.totalSpend > 0 ? (
                        <span className="ml-1 text-[color:var(--text-3)]">
                          · {formatPrice(c.totalSpend)}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5">
                      <StatusBadge status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <Pagination
              page={page}
              totalPages={data?.totalPages ?? 0}
              total={data?.total ?? 0}
              perPage={data?.perPage ?? 10}
              onPage={setPage}
              noun="user"
            />
          </div>
        </>
      )}
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="py-2 pr-3 text-[length:var(--text-xs)] font-medium uppercase tracking-wide">
      {children}
    </th>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "bg-emerald-500/10 text-emerald-600"
      : status === "disabled"
        ? "bg-destructive/10 text-destructive"
        : "bg-[var(--surface-0)] text-[color:var(--text-3)]";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[length:var(--text-2xs)] font-medium ${tone}`}
    >
      {status}
    </span>
  );
}
