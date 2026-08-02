import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { POLICIES } from "../policy-content";

export function generateStaticParams() {
  return Object.keys(POLICIES).map((policy) => ({ policy }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ policy: string }>;
}): Promise<Metadata> {
  const { policy } = await params;
  const doc = POLICIES[policy];
  if (!doc) return {};

  return {
    title: doc.title,
    description: doc.description,
    alternates: { canonical: `/${policy}` },
  };
}

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ policy: string }>;
}) {
  const { policy } = await params;
  const doc = POLICIES[policy];
  if (!doc) notFound();

  return (
    <div className="container-prose py-12 md:py-16">
      <h1 className="text-[length:var(--text-4xl)]">{doc.title}</h1>
      <p className="mt-3 text-[length:var(--text-sm)] text-[color:var(--text-3)]">
        Last updated {doc.updated}
      </p>

      <div className="mt-10 space-y-10">
        {doc.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="text-[length:var(--text-xl)]">{s.heading}</h2>
            <div className="mt-3 space-y-3">
              {s.body.map((p, i) => (
                <p
                  key={i}
                  className="text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--text-2)]"
                >
                  {p}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
