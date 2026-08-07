"use client";

/**
 * Staff accounts and roles — the privilege boundary.
 *
 * Only a super admin reaches this screen, and the backend refuses to let
 * anyone change their own role or deactivate themselves. That guard exists
 * because the failure is unrecoverable from the UI: demote the last super
 * admin and the only fix is editing SQL on the server.
 *
 * Permissions are shown per role rather than hidden behind a name, so choosing
 * "Manager" is an informed decision rather than a guess.
 */

import * as React from "react";
import { ShieldCheck, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Skeleton } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/error-state";
import { AdminPageHeader } from "@/features/admin/shell";
import { useAdminAuth, useAdminData } from "@/features/admin/auth-context";
import { adminFetch, AdminApiError } from "@/features/admin/api";

interface Role {
  id: string;
  permissions: string[];
}

interface Staff {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export default function AdminStaffPage() {
  const { csrf, user } = useAdminAuth();
  const { data, error, loading, reload } = useAdminData<{
    roles: Role[];
    staff: Staff[];
  }>("/staff");

  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function act(id: string, body: Record<string, unknown>, path: string,
                     message: string) {
    setBusy(id);
    setNotice(null);
    try {
      await adminFetch(`/staff/${encodeURIComponent(id)}/${path}`, {
        method: "POST",
        body,
        csrf,
      });
      setNotice(message);
      reload();
    } catch (err) {
      // The backend's refusals here are meaningful ("you cannot change your
      // own role"), so they are surfaced verbatim.
      setNotice(
        err instanceof AdminApiError || err instanceof Error
          ? err.message
          : "That didn't work",
      );
    } finally {
      setBusy(null);
    }
  }

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy("new");
    setNotice(null);
    try {
      await adminFetch("/staff", {
        method: "POST",
        body: {
          email: String(form.get("email")),
          name: String(form.get("name")),
          password: String(form.get("password")),
          role: String(form.get("role")),
        },
        csrf,
      });
      setNotice("Staff account created.");
      setAdding(false);
      reload();
    } catch (err) {
      setNotice(
        err instanceof AdminApiError || err instanceof Error
          ? err.message
          : "Couldn't create that account",
      );
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <ErrorState
        title="Couldn't load staff"
        description={error}
        onRetry={reload}
        showPhone={false}
      />
    );
  }

  const roles = data?.roles ?? [];
  const staff = data?.staff ?? [];

  return (
    <>
      <AdminPageHeader
        title="Staff"
        description="Who can sign in, and what each of them may do."
        action={
          <Button onClick={() => setAdding((v) => !v)}>
            <UserPlus className="mr-2 size-4" />
            {adding ? "Close" : "Add staff"}
          </Button>
        }
      />

      {notice ? (
        <p
          className="mb-4 rounded-[var(--radius-md)] border border-[var(--border-1)] p-3 text-[length:var(--text-sm)] text-[color:var(--text-2)]"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      {adding ? (
        <form onSubmit={create} className="surface-card mb-5 space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                Name
              </span>
              <Input name="name" required />
            </label>
            <label>
              <span className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                Email
              </span>
              <Input name="email" type="email" required autoComplete="off" />
            </label>
            <label>
              <span className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                Temporary password
              </span>
              <Input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </label>
            <label>
              <span className="mb-1 block text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                Role
              </span>
              <select
                name="role"
                defaultValue={roles[roles.length - 1]?.id ?? "staff"}
                className="min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--border-1)]
                           bg-[var(--surface-1)] px-3 capitalize text-[color:var(--text-1)]"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Button type="submit" disabled={busy === "new"}>
            {busy === "new" ? "Creating…" : "Create account"}
          </Button>
        </form>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {staff.map((u) => {
              const isSelf = u.id === user?.id;
              return (
                <li
                  key={u.id}
                  className="surface-card flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-[color:var(--text-1)]">
                      {u.name || u.email}
                      {isSelf ? (
                        <span className="ml-2 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                          (you)
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                      {u.email}
                    </p>
                    <p className="text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                      {u.lastLoginAt
                        ? `Last signed in ${new Date(u.lastLoginAt).toLocaleString("en-IN")}`
                        : "Never signed in"}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={u.role}
                      // Disabled on your own row: the backend refuses it, and
                      // offering a control that always fails is worse than
                      // not offering it.
                      disabled={isSelf || busy === u.id}
                      onChange={(e) =>
                        void act(
                          u.id,
                          { role: e.target.value },
                          "role",
                          `${u.name || u.email} is now ${e.target.value.replace("_", " ")}.`,
                        )
                      }
                      aria-label={`Role for ${u.email}`}
                      className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--border-1)]
                                 bg-[var(--surface-1)] px-3 capitalize text-[color:var(--text-1)]
                                 disabled:opacity-50"
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.id.replace("_", " ")}
                        </option>
                      ))}
                    </select>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSelf || busy === u.id}
                      onClick={() =>
                        void act(
                          u.id,
                          { isActive: !u.isActive },
                          "active",
                          `${u.email} ${u.isActive ? "can no longer sign in" : "can sign in again"}.`,
                        )
                      }
                    >
                      {u.isActive ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>

          <h2 className="mb-3 mt-8 flex items-center gap-2 font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
            <ShieldCheck className="size-5" aria-hidden />
            What each role can do
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {roles.map((r) => (
              <div key={r.id} className="surface-card p-4">
                <p className="font-medium capitalize text-[color:var(--text-1)]">
                  {r.id.replace("_", " ")}
                </p>
                <ul className="mt-2 flex flex-wrap gap-1">
                  {r.permissions.map((perm) => (
                    <li
                      key={perm}
                      className="rounded bg-[var(--surface-0)] px-1.5 py-0.5 font-mono text-[length:var(--text-2xs)] text-[color:var(--text-2)]"
                    >
                      {perm}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
