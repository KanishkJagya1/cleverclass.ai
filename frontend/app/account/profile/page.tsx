import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";

export default function ProfilePage() {
  return (
    <div>
      <h1 className="text-[length:var(--text-3xl)]">Profile</h1>
      <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-2)]">
        Your name, contact details and default delivery address.
      </p>

      <form className="surface-card mt-8 max-w-2xl p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="p-name">Full name</Label>
            <Input id="p-name" autoComplete="name" />
          </div>
          <div>
            <Label htmlFor="p-email">Email</Label>
            <Input id="p-email" type="email" autoComplete="email" />
          </div>
          <div>
            <Label htmlFor="p-phone">Mobile</Label>
            <Input id="p-phone" inputMode="numeric" autoComplete="tel" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="p-address">Default address</Label>
            <Input id="p-address" autoComplete="street-address" />
          </div>
          <div>
            <Label htmlFor="p-city">City</Label>
            <Input id="p-city" autoComplete="address-level2" />
          </div>
          <div>
            <Label htmlFor="p-pin">Pincode</Label>
            <Input id="p-pin" inputMode="numeric" autoComplete="postal-code" />
          </div>
        </div>
        <Button type="button" className="mt-6" disabled>
          Save changes
        </Button>
        <p className="mt-3 text-[length:var(--text-xs)] text-[var(--text-3)]">
          Saving is disabled until the auth backend is connected.
        </p>
      </form>
    </div>
  );
}
