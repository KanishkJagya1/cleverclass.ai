"use client";

/**
 * One order, with everything an operator needs to act on it.
 *
 * Status changes offer only the moves the state machine will accept — the
 * backend already computes `allowedNext`, so the UI never presents a button
 * that fails on click.
 */

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pin, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminAuth, useAdminData } from "@/features/admin/auth-context";
import { adminFetch, AdminApiError } from "@/features/admin/api";
import { formatPrice } from "@/lib/utils";

interface OrderNote {
  id: string;
  author: string;
  body: string;
  pinned: boolean;
  createdAt: string;
}

interface OrderDetail {
  order: {
    orderNumber: string;
    status: string;
    statusLabel: string;
    allowedNext: { status: string; label: string }[];
    customerName: string;
    phone: string;
    email?: string | null;
    city?: string;
    pincode?: string;
    total: number;
    createdAt?: string;
    stockApplied: boolean;
    items?: { slug: string; title: string; qty: number; lineTotal: number }[];
  };
  timeline: { status: string; note?: string; at: string; actor?: string }[];
  notes: OrderNote[];
  shipment: {
    carrierName?: string;
    carrierCode?: string;
    awb?: string;
    status?: string;
    statusLabel?: string;
    trackingUrl?: string | null;
    expectedAt?: string | null;
  } | null;
  carriers: { code: string; name: string }[];
}

export default function AdminOrderDetailPage() {
  const params = useParams<{ orderNumber: string }>();
  const orderNumber = decodeURIComponent(String(params.orderNumber));
  const router = useRouter();
  const { csrf } = useAdminAuth();

  const { data, error, loading, reload } = useAdminData<OrderDetail>(
    `/orders/${encodeURIComponent(orderNumber)}`,
  );

  const [note, setNote] = React.useState("");
  const [pinned, setPinned] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const run = React.useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setActionError(null);
      try {
        await fn();
        reload();
      } catch (err) {
        setActionError(
          err instanceof AdminApiError || err instanceof Error
            ? err.message
            : "That didn't work",
        );
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  if (error) {
    return (
      <ErrorState
        title="Couldn't load that order"
        description={error}
        onRetry={reload}
        showPhone={false}
      />
    );
  }

  if (loading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-64 rounded-[var(--radius-md)]" />
        <Skeleton className="h-40 w-full rounded-[var(--radius-md)]" />
      </div>
    );
  }

  const { order, timeline, notes } = data;

  return (
    <>
      <Link
        href="/admin/orders"
        className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
      >
        <ArrowLeft className="size-4" />
        All orders
      </Link>

      <AdminPageHeader
        title={order.orderNumber}
        description={`${order.customerName} · ${order.phone}`}
      />

      {notice ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border-1)] p-3 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          {notice}
        </div>
      ) : null}

      {actionError ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-destructive/40 bg-destructive/10 p-3 text-[length:var(--text-sm)]">
          {actionError}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <section className="surface-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                  Status
                </p>
                <p className="font-medium text-[color:var(--text-1)]">
                  {order.statusLabel}
                </p>
              </div>
              <p className="tabular text-lg font-semibold text-[color:var(--text-1)]">
                {formatPrice(order.total)}
              </p>
            </div>

            {order.allowedNext.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border-1)] pt-3">
                {/* Only the moves the machine accepts — never a button that
                    fails on click. */}
                {order.allowedNext.map((next) => (
                  <Button
                    key={next.status}
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        adminFetch(
                          `/orders/${encodeURIComponent(order.orderNumber)}/status`,
                          { method: "POST", body: { status: next.status }, csrf },
                        ),
                      )
                    }
                  >
                    Mark {next.label}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="mt-3 border-t border-[var(--border-1)] pt-3 text-[length:var(--text-sm)] text-[color:var(--text-3)]">
                This order is in a final state.
              </p>
            )}
          </section>

          {order.items?.length ? (
            <section className="surface-card p-4">
              <h2 className="mb-2 font-medium text-[color:var(--text-1)]">Items</h2>
              <ul className="space-y-1 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                {order.items.map((it) => (
                  <li key={it.slug} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">
                      {it.title} × {it.qty}
                    </span>
                    <span className="tabular shrink-0">
                      {formatPrice(it.lineTotal)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <ShipmentSection
            orderNumber={order.orderNumber}
            shipment={data.shipment}
            carriers={data.carriers}
            csrf={csrf}
            onDone={(msg) => {
              setActionError(null);
              setNotice(msg);
              reload();
            }}
          />

          <section className="surface-card p-4">
            <h2 className="mb-2 font-medium text-[color:var(--text-1)]">Timeline</h2>
            {timeline.length === 0 ? (
              <p className="text-[length:var(--text-sm)] text-[color:var(--text-3)]">
                Nothing recorded yet.
              </p>
            ) : (
              <ol className="space-y-2 text-[length:var(--text-sm)]">
                {timeline.map((t, i) => (
                  <li key={`${t.at}-${i}`} className="flex flex-wrap gap-x-2">
                    <span className="font-medium text-[color:var(--text-1)]">
                      {t.status}
                    </span>
                    {t.note ? (
                      <span className="text-[color:var(--text-2)]">{t.note}</span>
                    ) : null}
                    <span className="ml-auto text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                      {new Date(t.at).toLocaleString("en-IN")}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <section className="surface-card p-4">
          <h2 className="mb-1 font-medium text-[color:var(--text-1)]">
            Internal notes
          </h2>
          {/* Said plainly on the screen, not just in the schema — someone will
              otherwise type a reply to the customer here. */}
          <p className="mb-3 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
            Staff only. The customer never sees these.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!note.trim()) return;
              void run(async () => {
                await adminFetch(
                  `/orders/${encodeURIComponent(order.orderNumber)}/notes`,
                  { method: "POST", body: { body: note, pinned }, csrf },
                );
                setNote("");
                setPinned(false);
              });
            }}
            className="space-y-2"
          >
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="e.g. Customer asked us to call after 6pm"
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border-1)]
                         bg-[var(--surface-1)] p-2 text-[length:var(--text-sm)]
                         text-[color:var(--text-1)]"
            />
            <div className="flex items-center justify-between gap-2">
              <label className="flex min-h-11 items-center gap-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(e) => setPinned(e.target.checked)}
                />
                Pin to top
              </label>
              <Button type="submit" size="sm" disabled={busy || !note.trim()}>
                Add note
              </Button>
            </div>
          </form>

          <ul className="mt-4 space-y-3">
            {notes.length === 0 ? (
              <li className="text-[length:var(--text-sm)] text-[color:var(--text-3)]">
                No notes yet.
              </li>
            ) : (
              notes.map((n) => (
                <li
                  key={n.id}
                  className="rounded-[var(--radius-sm)] border border-[var(--border-1)] p-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="whitespace-pre-wrap text-[length:var(--text-sm)] text-[color:var(--text-1)]">
                      {n.body}
                    </p>
                    <button
                      type="button"
                      aria-label="Delete note"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          adminFetch(
                            `/orders/${encodeURIComponent(order.orderNumber)}/notes/${n.id}`,
                            { method: "DELETE", csrf },
                          ),
                        )
                      }
                      className="shrink-0 text-[color:var(--text-3)] hover:text-[color:var(--text-1)]"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                    {n.pinned ? <Pin className="size-3" /> : null}
                    {n.author} · {new Date(n.createdAt).toLocaleString("en-IN")}
                  </p>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </>
  );
}


/**
 * Dispatch details.
 *
 * Recording a shipment does NOT move the order to "shipped" — that is a
 * separate, deliberate click above. Coupling them would mean typing an AWB to
 * check a format silently notified the customer their parcel was on its way.
 */
function ShipmentSection({
  orderNumber,
  shipment,
  carriers,
  csrf,
  onDone,
}: {
  orderNumber: string;
  shipment: OrderDetail["shipment"];
  carriers: { code: string; name: string }[];
  csrf: string | undefined;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await adminFetch(`/orders/${encodeURIComponent(orderNumber)}/shipment`, {
        method: "POST",
        body: {
          carrierCode: String(form.get("carrierCode")),
          awb: String(form.get("awb")),
          charge: Number(form.get("charge") ?? 0),
          notes: String(form.get("notes") ?? ""),
        },
        csrf,
      });
      onDone("Shipment recorded. Mark the order shipped when it leaves.");
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

  if (shipment?.awb) {
    return (
      <section className="surface-card p-4">
        <h2 className="mb-2 font-medium text-[color:var(--text-1)]">Shipment</h2>
        <p className="text-[length:var(--text-sm)] text-[color:var(--text-2)]">
          {shipment.carrierName ?? shipment.carrierCode} ·{" "}
          <span className="tabular">{shipment.awb}</span>
          {shipment.statusLabel ? ` · ${shipment.statusLabel}` : ""}
        </p>
        {shipment.trackingUrl ? (
          <a
            href={shipment.trackingUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex min-h-11 items-center text-[length:var(--text-sm)] font-medium text-[color:var(--text-brand)]"
          >
            Track this parcel
          </a>
        ) : null}
      </section>
    );
  }

  return (
    <section className="surface-card p-4">
      <h2 className="font-medium text-[color:var(--text-1)]">Shipment</h2>
      <p className="mb-3 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
        Recording this does not mark the order shipped — do that above when it
        actually leaves.
      </p>
      {error ? (
        <p className="mb-2 text-[length:var(--text-sm)] text-destructive">{error}</p>
      ) : null}
      <form onSubmit={submit} className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <select
            name="carrierCode"
            aria-label="Carrier"
            className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--border-1)]
                       bg-[var(--surface-1)] px-3 text-[color:var(--text-1)]"
          >
            {carriers.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            name="awb"
            required
            placeholder="Tracking / AWB number"
            aria-label="AWB"
            className="min-h-11 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-1)]
                       bg-[var(--surface-1)] px-3 text-[color:var(--text-1)]"
          />
        </div>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Saving…" : "Record shipment"}
        </Button>
      </form>
    </section>
  );
}
