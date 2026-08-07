"use client";

/**
 * Revenue and what sells.
 *
 * The chart is plain SVG bars rather than a charting library. At one series of
 * up to 365 points that is the whole requirement, and it avoids shipping
 * ~100 KB of JavaScript to draw thirty rectangles.
 *
 * Cancelled, refunded and returned orders are excluded from every figure by
 * the backend — the chart and the headline read the same date-aligned window,
 * so they cannot disagree.
 */

import * as React from "react";
import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";

import { Skeleton } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminData } from "@/features/admin/auth-context";
import { formatPrice } from "@/lib/utils";

interface Point {
  date: string;
  orders: number;
  revenue: number;
}

interface Dashboard {
  summary: {
    orders: number;
    revenue: number;
    aov: number;
    newCustomers: number;
    change: {
      orders: number | null;
      revenue: number | null;
      aov: number | null;
    };
  };
  series: Point[];
  topProducts: { slug: string; title: string; units: number; revenue: number }[];
  operational: Record<string, number>;
}

const RANGES = [7, 30, 90, 365];

export default function AdminAnalyticsPage() {
  const [days, setDays] = React.useState(30);
  const { data, error, loading, reload } = useAdminData<Dashboard>(
    `/analytics?days=${days}`,
    [days],
  );

  if (error) {
    return (
      <ErrorState
        title="Couldn't load analytics"
        description={error}
        onRetry={reload}
        showPhone={false}
      />
    );
  }

  return (
    <>
      <AdminPageHeader
        title="Analytics"
        description="Cancelled and refunded orders are excluded from every figure here."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {RANGES.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            className={
              days === d
                ? "min-h-11 rounded-[var(--radius-sm)] bg-[var(--brand)] px-4 text-[length:var(--text-sm)] font-medium text-white"
                : "min-h-11 rounded-[var(--radius-sm)] border border-[var(--border-1)] px-4 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
            }
          >
            {d === 365 ? "1 year" : `${d} days`}
          </button>
        ))}
      </div>

      {loading || !data ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-[var(--radius-lg)]" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-[var(--radius-lg)]" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Revenue"
              value={formatPrice(data.summary.revenue)}
              change={data.summary.change.revenue}
            />
            <Stat
              label="Orders"
              value={data.summary.orders}
              change={data.summary.change.orders}
            />
            <Stat
              label="Average order"
              value={formatPrice(data.summary.aov)}
              change={data.summary.change.aov}
            />
            <Stat label="New customers" value={data.summary.newCustomers} />
          </div>

          <h2 className="mb-3 mt-8 font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
            Daily revenue
          </h2>
          <Chart series={data.series} />

          <h2 className="mb-3 mt-8 font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
            Best sellers
          </h2>
          {data.topProducts.length === 0 ? (
            <p className="surface-card p-5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
              Nothing sold in this period.
            </p>
          ) : (
            <div className="surface-card overflow-x-auto p-0">
              <table className="w-full min-w-[520px] text-[length:var(--text-sm)]">
                <thead>
                  <tr className="border-b border-[var(--border-1)] text-left text-[color:var(--text-3)]">
                    <th className="px-4 py-2 text-[length:var(--text-xs)] font-medium uppercase tracking-wide">
                      Book
                    </th>
                    <th className="px-4 py-2 text-[length:var(--text-xs)] font-medium uppercase tracking-wide">
                      Units
                    </th>
                    <th className="px-4 py-2 text-right text-[length:var(--text-xs)] font-medium uppercase tracking-wide">
                      Revenue
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts.map((p) => (
                    <tr
                      key={p.slug}
                      className="border-b border-[var(--border-1)] last:border-0"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/admin/books/${p.slug}`}
                          className="text-[color:var(--text-brand)]"
                        >
                          {p.title}
                        </Link>
                      </td>
                      <td className="tabular px-4 py-2.5 text-[color:var(--text-2)]">
                        {p.units}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-[color:var(--text-1)]">
                        {formatPrice(p.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

function Chart({ series }: { series: Point[] }) {
  if (series.length === 0) {
    return (
      <p className="surface-card p-5 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
        No data yet.
      </p>
    );
  }

  const max = Math.max(...series.map((p) => p.revenue), 1);
  const width = 100;
  const gap = 0.15;
  const barWidth = width / series.length;

  return (
    <div className="surface-card p-4">
      <svg
        viewBox={`0 0 ${width} 40`}
        preserveAspectRatio="none"
        className="h-48 w-full"
        role="img"
        aria-label={`Daily revenue for the last ${series.length} days`}
      >
        {series.map((p, i) => {
          // A zero day still gets a hairline so the axis reads as continuous
          // rather than looking like missing data.
          const h = p.revenue === 0 ? 0.3 : (p.revenue / max) * 38;
          return (
            <rect
              key={p.date}
              x={i * barWidth + gap}
              y={40 - h}
              width={Math.max(0.4, barWidth - gap * 2)}
              height={h}
              rx={0.3}
              className={
                p.revenue === 0
                  ? "fill-[var(--border-1)]"
                  : "fill-[var(--brand)]"
              }
            >
              <title>{`${p.date}: ${p.revenue} (${p.orders} orders)`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-2 flex justify-between text-[length:var(--text-xs)] text-[color:var(--text-3)]">
        <span>{series[0]?.date}</span>
        <span>peak {formatPrice(max)}</span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  change,
}: {
  label: string;
  value: string | number;
  change?: number | null;
}) {
  return (
    <div className="surface-card p-5">
      <p className="text-[length:var(--text-xs)] font-medium uppercase tracking-[var(--tracking-wide)] text-[color:var(--text-3)]">
        {label}
      </p>
      <p className="tabular mt-2 font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-bold text-[color:var(--text-1)]">
        {value}
      </p>
      {/* null means "no previous period to compare with" — deliberately not
          rendered as 0%, which would claim a flat month that never happened. */}
      {change === null || change === undefined ? (
        <p className="mt-1 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
          No earlier period to compare
        </p>
      ) : (
        <p
          className={
            "mt-1 flex items-center gap-1 text-[length:var(--text-xs)] " +
            (change >= 0 ? "text-emerald-600" : "text-[color:var(--signal-danger)]")
          }
        >
          {change >= 0 ? (
            <TrendingUp className="size-3" aria-hidden />
          ) : (
            <TrendingDown className="size-3" aria-hidden />
          )}
          {Math.abs(change)}% vs the period before
        </p>
      )}
    </div>
  );
}
