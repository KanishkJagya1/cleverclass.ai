"use client";

import * as React from "react";
import Link from "next/link";
import { SITE } from "@/constants/catalog";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Wire to Sentry/LogRocket here. Console is the honest placeholder —
    // pretending errors are reported when they are not is worse than nothing.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-[var(--gutter)] py-20 text-center">
      <div className="max-w-md">
        <h1 className="text-[length:var(--text-2xl)]">Something went wrong</h1>
        <p className="mt-3 text-[length:var(--text-body)] text-[color:var(--text-2)]">
          This is on us, not you. Try again — and if it keeps happening, call{" "}
          <a href={`tel:${SITE.phones[0]}`} className="font-medium text-[color:var(--text-brand)]">
            {SITE.phones[0].replace("+91", "+91 ")}
          </a>{" "}
          and we&apos;ll take your order directly.
        </p>
        {error.digest && (
          <p className="tabular mt-3 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="secondary">
            <Link href="/">Back home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
