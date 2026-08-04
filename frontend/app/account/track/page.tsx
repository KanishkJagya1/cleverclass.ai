"use client";

import * as React from "react";
import { PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";
import { SITE } from "@/constants/catalog";

/**
 * Guest-accessible by design. Most orders here are placed without an account,
 * so gating tracking behind a login would send those customers to the phone
 * line instead — which costs the business money.
 */
export default function TrackOrderPage() {
  const [submitted, setSubmitted] = React.useState(false);

  return (
    <div>
      <h1 className="text-[length:var(--text-3xl)]">Track your order</h1>
      <p className="mt-2 max-w-lg text-[length:var(--text-body)] text-[color:var(--text-2)]">
        Enter your order reference and the mobile number you ordered with. No
        account needed.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
        }}
        className="surface-card mt-8 max-w-md p-6"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="order">Order reference</Label>
            <Input id="order" placeholder="KT-XXXXXX" required />
          </div>
          <div>
            <Label htmlFor="phone">Mobile number</Label>
            <Input id="phone" inputMode="numeric" placeholder="10-digit number" required />
          </div>
        </div>
        <Button type="submit" full className="mt-5">
          <PackageSearch className="size-4" aria-hidden />
          Track order
        </Button>
      </form>

      {submitted && (
        <div className="surface-card mt-6 max-w-md p-5" role="status">
          <p className="text-[length:var(--text-sm)] text-[color:var(--text-2)]">
            Order tracking connects to the fulfilment system, which is not wired
            in this build. For now, call{" "}
            <a href={`tel:${SITE.phones[0]}`} className="font-medium text-[color:var(--text-brand)]">
              {SITE.phones[0]}
            </a>{" "}
            with your reference and we&apos;ll check it for you.
          </p>
        </div>
      )}
    </div>
  );
}
