"use client";

/**
 * Discount codes.
 *
 * Deactivating is offered prominently and deleting is not offered at all: a
 * coupon that has been redeemed is referenced by those orders, and removing it
 * would strand their discount with no explanation of where it came from.
 */

import * as React from "react";
import { Percent, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Skeleton } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminAuth } from "@/features/admin/auth-context";
import { adminFetch, AdminApiError } from "@/features/admin/api";
import { Pagination, usePaginatedAdminData } from "@/features/admin/pagination";
import { formatPrice } from "@/lib/utils";

interface Coupon {
  code: string;
  kind: string;
  value: number;
  is_active: number;
  used_count: number;
  usage_limit: number | null;
  total_discount: number;
}

const KINDS = [
  { value: "percent", label: "Percent off" },
  { value: "flat", label: "Flat amount off" },
  { value: "free_shipping", label: "Free shipping" },
  { value: "bxgy", label: "Buy X get Y" },
];

export default function AdminCouponsPage() {
  const { csrf } = useAdminAuth();
  const { data, error, loading, reload, page, setPage } =
    usePaginatedAdminData<Coupon>("/coupons", {}, 10);

  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function toggle(code: string, active: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      await adminFetch(`/coupons/${encodeURIComponent(code)}/active`, {
        method: "POST",
        body: { isActive: !active },
        csrf,
      });
      setNotice(`${code} is now ${active ? "off" : "live"}.`);
      reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't update that");
    } finally {
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setNotice(null);
    try {
      await adminFetch("/coupons", {
        method: "POST",
        body: {
          code: String(form.get("code") ?? "").toUpperCase(),
          description: String(form.get("description") ?? ""),
          kind: String(form.get("kind") ?? "percent"),
          value: Number(form.get("value") ?? 0),
          minCart: Number(form.get("minCart") ?? 0),
        },
        csrf,
      });
      setNotice("Coupon created and live.");
      setAdding(false);
      reload();
    } catch (err) {
      setNotice(
        err instanceof AdminApiError || err instanceof Error
          ? err.message
          : "Couldn't create that",
      );
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <ErrorState
        title="Couldn't load coupons"
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
        title="Coupons"
        description="Discount codes and what they have cost."
        action={
          <Button onClick={() => setAdding((v) => !v)}>
            <Plus className="mr-2 size-4" />
            {adding ? "Close" : "New coupon"}
          </Button>
        }
      />

      {notice ? (
        <p
          className="mb-4 rounded-[var(--radius-md)] border border-[var(--border-1)] p-3 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      {adding ? (
        <form onSubmit={create} className="surface-card mb-5 space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                Code
              </span>
              <Input name="code" required placeholder="SAVE10" className="uppercase" />
            </label>
            <label>
              <span className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                Type
              </span>
              <select
                name="kind"
                defaultValue="percent"
                className="min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--border-1)]
                           bg-[var(--surface-1)] px-3 text-[color:var(--text-1)]"
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                Value
              </span>
              <Input name="value" type="number" defaultValue={10} />
            </label>
            <label>
              <span className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                Minimum cart (₹)
              </span>
              <Input name="minCart" type="number" defaultValue={0} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
              Description
            </span>
            <Input name="description" placeholder="Shown at checkout" />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </form>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Percent}
          title="No coupons yet"
          description="Create one to run a discount."
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[length:var(--text-sm)]">
              <thead>
                <tr className="border-b border-[var(--border-1)] text-left text-[color:var(--text-3)]">
                  <Th>Code</Th>
                  <Th>Type</Th>
                  <Th>Used</Th>
                  <Th>Given away</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.code}
                    className="border-b border-[var(--border-1)] last:border-0"
                  >
                    <td className="py-2.5 pr-3 font-mono font-medium text-[color:var(--text-1)]">
                      {c.code}
                    </td>
                    <td className="py-2.5 pr-3 text-[color:var(--text-2)]">
                      {c.kind === "percent"
                        ? `${c.value}% off`
                        : c.kind === "flat"
                          ? `${formatPrice(c.value)} off`
                          : c.kind.replace("_", " ")}
                    </td>
                    <td className="tabular py-2.5 pr-3 text-[color:var(--text-2)]">
                      {c.used_count}
                      {c.usage_limit ? ` / ${c.usage_limit}` : ""}
                    </td>
                    {/* The number that matters when deciding whether to keep a
                        code running. */}
                    <td className="tabular py-2.5 pr-3 text-[color:var(--text-1)]">
                      {formatPrice(c.total_discount)}
                    </td>
                    <td className="py-2.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void toggle(c.code, Boolean(c.is_active))}
                        className={
                          c.is_active
                            ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-[length:var(--text-2xs)] font-medium text-emerald-600"
                            : "rounded-full bg-[var(--surface-0)] px-2 py-0.5 text-[length:var(--text-2xs)] font-medium text-[color:var(--text-3)]"
                        }
                      >
                        {c.is_active ? "Live" : "Off"}
                      </button>
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
              noun="coupon"
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
