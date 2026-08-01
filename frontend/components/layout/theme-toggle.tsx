"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Light is the default. `resolvedTheme` is unknowable on the server, so until
 * mount we render the light-mode icon — which matches the default and avoids a
 * hydration mismatch without hiding the control (hiding it would shift the
 * whole toolbar on hydration).
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      // 44px on touch, 36px once a pointer is available (WCAG 2.5.5).
      size="icon"
      className="lg:size-9"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {dark ? <Moon className="size-5" aria-hidden /> : <Sun className="size-5" aria-hidden />}
    </Button>
  );
}
