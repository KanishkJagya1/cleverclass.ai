"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, MapPin, Plus, Star, Trash2 } from "lucide-react";
import { auth, AuthError, type User } from "@/lib/auth/provider";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";

/**
 * Profile and saved addresses, wired to the real API.
 *
 * This page used to render a disabled form under the note "Saving is disabled
 * until the auth backend is connected" — which stopped being true the moment
 * the customer auth service shipped. It was telling people their details could
 * not be saved while the endpoint sat there working.
 */

interface Address {
  id: string;
  label: string;
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

type AddressDraft = Omit<Address, "id" | "isDefault">;

const BLANK: AddressDraft = {
  label: "Home", name: "", phone: "", line1: "", line2: "", city: "",
  state: "", pincode: "",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/auth/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
    cache: "no-store",
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    throw new AuthError(
      typeof detail === "string" ? detail : "Could not save. Please try again.",
      response.status,
    );
  }
  return data as T;
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = React.useState<User | null>(null);
  const [addresses, setAddresses] = React.useState<Address[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [draft, setDraft] = React.useState<AddressDraft | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const session = await auth.getSession().catch(() => null);
      if (!alive) return;
      if (!session) {
        router.replace("/login?next=/account/profile");
        return;
      }
      setUser(session);
      setName(session.name);
      setPhone(session.phone);
      const data = await api<{ addresses: Address[] }>("addresses").catch(() => ({
        addresses: [] as Address[],
      }));
      if (!alive) return;
      setAddresses(data.addresses);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await auth.updateProfile({ name, phone });
      setUser(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function reloadAddresses() {
    const data = await api<{ addresses: Address[] }>("addresses");
    setAddresses(data.addresses);
  }

  async function submitAddress(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setError(null);
    try {
      if (editingId) {
        await api(`addresses/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(draft),
        });
      } else {
        await api("addresses", { method: "POST", body: JSON.stringify(draft) });
      }
      setDraft(null);
      setEditingId(null);
      await reloadAddresses();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Could not save the address.");
    }
  }

  if (loading) {
    return (
      <div>
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-8 h-64 max-w-2xl rounded-[var(--radius-lg)]" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[length:var(--text-3xl)]">Profile</h1>
      <p className="mt-2 text-[length:var(--text-body)] text-[color:var(--text-2)]">
        Your contact details and saved delivery addresses.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-6 max-w-2xl rounded-[var(--radius-md)] border border-[var(--signal-danger)] bg-[var(--signal-danger-soft)] px-3.5 py-2.5 text-[length:var(--text-sm)] text-[color:var(--signal-danger)]"
        >
          {error}
        </div>
      )}

      <form onSubmit={saveProfile} className="surface-card mt-6 max-w-2xl p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="p-name">Full name</Label>
            <Input
              id="p-name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="p-email">Email</Label>
            {/* Read-only on purpose: changing the address on an account is an
                identity change and needs re-verification, not a text field. */}
            <Input id="p-email" type="email" value={user?.email ?? ""} disabled />
            <p className="mt-1 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
              {user?.emailVerified ? "Confirmed" : "Not confirmed yet"}
            </p>
          </div>
          <div>
            <Label htmlFor="p-phone">Mobile</Label>
            <Input
              id="p-phone"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-6 flex items-center gap-3">
          <Button type="submit" loading={saving}>
            Save changes
          </Button>
          {saved && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 text-[length:var(--text-sm)] text-[color:var(--signal-gain)]"
            >
              <Check className="size-4" aria-hidden />
              Saved
            </span>
          )}
        </div>
      </form>

      {/* ------------------------------------------------------ addresses -- */}
      <section className="mt-10 max-w-2xl" aria-labelledby="addresses">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="addresses" className="text-[length:var(--text-xl)]">
            Delivery addresses
          </h2>
          {!draft && addresses.length < 10 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDraft({ ...BLANK, name: user?.name ?? "", phone: user?.phone ?? "" });
                setEditingId(null);
              }}
            >
              <Plus className="size-4" aria-hidden />
              Add address
            </Button>
          )}
        </div>

        {addresses.length === 0 && !draft && (
          <p className="mt-4 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            No saved addresses yet. Add one and checkout will fill itself in.
          </p>
        )}

        <ul className="mt-4 space-y-3">
          {addresses.map((address) => (
            <li key={address.id} className="surface-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                    <MapPin className="size-4 text-[color:var(--brand-base)]" aria-hidden />
                    {address.label}
                    {address.isDefault && (
                      <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[length:var(--text-xs)] text-[color:var(--text-brand)]">
                        Default
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                    {address.name && `${address.name} · `}
                    {[address.line1, address.line2, address.city, address.state, address.pincode]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {!address.isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Make ${address.label} the default address`}
                      onClick={async () => {
                        await api(`addresses/${address.id}/default`, { method: "POST" });
                        await reloadAddresses();
                      }}
                    >
                      <Star className="size-4" aria-hidden />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDraft({
                        label: address.label, name: address.name, phone: address.phone,
                        line1: address.line1, line2: address.line2, city: address.city,
                        state: address.state, pincode: address.pincode,
                      });
                      setEditingId(address.id);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${address.label}`}
                    onClick={async () => {
                      await api(`addresses/${address.id}`, { method: "DELETE" });
                      await reloadAddresses();
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {draft && (
          <form onSubmit={submitAddress} className="surface-card mt-4 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="a-label">Label</Label>
                <Input
                  id="a-label"
                  placeholder="Home, School, Hostel"
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="a-name">Recipient name</Label>
                <Input
                  id="a-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="a-line1">Street address</Label>
                <Input
                  id="a-line1"
                  autoComplete="street-address"
                  value={draft.line1}
                  onChange={(e) => setDraft({ ...draft, line1: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="a-line2">Area / landmark</Label>
                <Input
                  id="a-line2"
                  value={draft.line2}
                  onChange={(e) => setDraft({ ...draft, line2: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="a-city">City</Label>
                <Input
                  id="a-city"
                  autoComplete="address-level2"
                  value={draft.city}
                  onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="a-state">State</Label>
                <Input
                  id="a-state"
                  autoComplete="address-level1"
                  value={draft.state}
                  onChange={(e) => setDraft({ ...draft, state: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="a-pin">Pincode</Label>
                <Input
                  id="a-pin"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  value={draft.pincode}
                  onChange={(e) => setDraft({ ...draft, pincode: e.target.value })}
                />
                <FieldError>
                  {draft.pincode && !/^\d{6}$/.test(draft.pincode)
                    ? "Pincode must be 6 digits"
                    : undefined}
                </FieldError>
              </div>
              <div>
                <Label htmlFor="a-phone">Contact number</Label>
                <Input
                  id="a-phone"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={draft.phone}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <Button type="submit">{editingId ? "Save address" : "Add address"}</Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDraft(null);
                  setEditingId(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
