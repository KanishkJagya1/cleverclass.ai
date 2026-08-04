import type { Metadata } from "next";
import { AdminAuthProvider } from "@/features/admin/auth-context";
import { AdminShell } from "@/features/admin/shell";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · CleverClass Admin" },
  // Never index the admin panel, and never leak an admin URL as a referrer.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

// Nothing here is cacheable: every screen shows live operational data, and a
// stale book list is how you overwrite someone else's edit.
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthProvider>
      <AdminShell>{children}</AdminShell>
    </AdminAuthProvider>
  );
}
