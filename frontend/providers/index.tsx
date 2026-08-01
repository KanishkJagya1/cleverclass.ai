"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { SearchProvider } from "@/features/search/search-context";

/**
 * Device capability probe.
 *
 * `backdrop-filter` is the single most expensive thing on this site. Rather
 * than ship the same blur budget to a flagship and a ₹12,000 Android, we set
 * data-perf="low" and glass.css drops live blur for opaque surfaces — a
 * still-premium result, at a fraction of the compositing cost.
 */
function useDeviceCapability() {
  React.useEffect(() => {
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { saveData?: boolean; effectiveType?: string };
    };

    const weak =
      (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) ||
      navigator.hardwareConcurrency <= 4 ||
      nav.connection?.saveData === true ||
      /2g|slow-2g/.test(nav.connection?.effectiveType ?? "");

    if (weak) document.documentElement.dataset.perf = "low";
  }, []);
}

/**
 * Lenis smooth scroll. Loaded dynamically and skipped entirely when the user
 * prefers reduced motion or the device is weak — hijacking scroll on a slow
 * phone is worse than no smoothing at all.
 */
function useSmoothScroll() {
  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (document.documentElement.dataset.perf === "low") return;

    let raf = 0;
    let lenis: { raf: (t: number) => void; destroy: () => void } | null = null;
    let cancelled = false;

    import("lenis").then(({ default: Lenis }) => {
      if (cancelled) return;
      lenis = new Lenis({ duration: 1.05, smoothWheel: true });
      const loop = (t: number) => {
        lenis?.raf(t);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      lenis?.destroy();
    };
  }, []);
}

export function Providers({ children }: { children: React.ReactNode }) {
  useDeviceCapability();
  useSmoothScroll();

  return (
    // Light by default. `enableSystem={false}` is deliberate: the brand
    // artwork is designed for light, and silently following an OS preference
    // means most Android users would never see the intended default.
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      <SearchProvider>
        {children}
        <Toaster
          position="bottom-center"
          offset={80}
          toastOptions={{
            classNames: {
              toast:
                "glass-panel !rounded-[var(--radius-lg)] !text-[var(--text-1)] !border-[var(--border-glass)]",
            },
          }}
        />
      </SearchProvider>
    </ThemeProvider>
  );
}
