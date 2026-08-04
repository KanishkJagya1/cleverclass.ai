import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthShell } from "../auth-shell";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  // AuthShell reads useSearchParams (?next=, ?error= from the Google
  // callback), which opts the tree into client-side rendering. Without a
  // boundary here the prerender fails outright: "Error occurred prerendering
  // page". The fallback is the empty page frame, which is what the visitor
  // would see for the split second before hydration anyway.
  return (
    <Suspense>
      <AuthShell mode="login" />
    </Suspense>
  );
}
