"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

/**
 * Catalogue routes read through the API. When it is unreachable we show this
 * rather than fabricating products — a customer ordering a book at a price we
 * invented is far worse than a customer seeing an error.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[catalog route]", error);
  }, [error]);

  return (
    <div className="container-page">
      <ErrorState
        title="We couldn't load this page"
        description="Our catalogue is briefly unavailable. Your cart is safe — try again in a moment."
        onRetry={reset}
      />
    </div>
  );
}
