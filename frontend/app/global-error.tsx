"use client";

/**
 * Last resort: an error in the root layout itself, where no app chrome and none
 * of the design tokens are guaranteed to have loaded. Everything here is inline
 * and self-contained on purpose.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // A root-layout failure is the one error that never reaches a route boundary,
  // so it must at least reach the console with its digest for correlation with
  // the server log.
  console.error("[global-error]", error.digest ?? "", error);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          background: "#F8FAFC",
          color: "#0F172A",
          padding: "2rem",
        }}
      >
        <main style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.75rem" }}>
            Something went wrong
          </h1>
          <p style={{ margin: "0 0 1.5rem", color: "#475569", lineHeight: 1.6 }}>
            The page failed to load. Please try again, or call us on
            +91 71042 99010 and we&apos;ll help directly.
          </p>
          <button
            onClick={reset}
            style={{
              background: "#4F46E5",
              color: "#fff",
              border: 0,
              borderRadius: "0.5rem",
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
