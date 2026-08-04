import { Suspense } from "react";
import type { Metadata } from "next";
import Client from "./client";

export const metadata: Metadata = {
  title: "Confirm your email",
  robots: { index: false, follow: false },
};

// The client component reads its token from useSearchParams, which cannot be
// prerendered without a boundary — the build fails with "Error occurred
// prerendering page" rather than degrading.
export default function Page() {
  return (
    <Suspense>
      <Client />
    </Suspense>
  );
}
