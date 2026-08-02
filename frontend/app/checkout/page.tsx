"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, CreditCard, Lock, PackageCheck } from "lucide-react";
import { useCart, useCartTotals } from "@/lib/store/cart";
import { payments, type ShippingDetails } from "@/lib/payments/provider";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, formatPrice } from "@/lib/utils";

/* Indian pincode + mobile validation — a generic `.min(1)` here produces
   undeliverable orders, which is a real cost, not a nicety. */
const schema = z.object({
  fullName: z.string().min(2, "Enter your full name"),
  phone: z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number"),
  email: z.string().email("Enter a valid email"),
  address1: z.string().min(5, "Enter your address"),
  address2: z.string().optional(),
  city: z.string().min(2, "Enter your city"),
  state: z.string().min(2, "Enter your state"),
  pincode: z.string().regex(/^\d{6}$/, "Enter a 6-digit pincode"),
});

const STEPS = ["Details", "Shipping", "Payment"] as const;

export default function CheckoutPage() {
  const { items, ready, clear } = useCart();
  const totals = useCartTotals();
  const [step, setStep] = React.useState(0);
  const [placing, setPlacing] = React.useState(false);
  const [orderId, setOrderId] = React.useState<string | null>(null);

  const form = useForm<ShippingDetails>({
    resolver: zodResolver(schema),
    mode: "onBlur",
  });

  if (!ready) return null;

  if (orderId) {
    return (
      <div className="container-prose py-16 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-[var(--signal-gain-soft)] text-[color:var(--signal-gain)]">
          <PackageCheck className="size-6" aria-hidden />
        </span>
        <h1 className="mt-6 text-[length:var(--text-3xl)]">Order placed</h1>
        <p className="mt-3 text-[length:var(--text-body)] text-[color:var(--text-2)]">
          Your order reference is{" "}
          <span className="tabular font-semibold text-[color:var(--text-1)]">{orderId}</span>. We've
          sent a confirmation to your email and will call if anything needs checking.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href="/account/track">Track this order</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/shop">Continue shopping</Link>
          </Button>
        </div>
        {/* Account creation is offered AFTER the order, never as a gate before it. */}
        <p className="mt-10 text-[length:var(--text-sm)] text-[color:var(--text-3)]">
          Want your orders and downloads in one place?{" "}
          <Link href="/signup" className="text-[color:var(--text-brand)] underline underline-offset-4">
            Create an account
          </Link>
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="container-page py-16">
        <EmptyState
          title="Nothing to check out"
          description="Add a few books or a combo pack first."
          action={{ label: "Browse books", href: "/shop" }}
        />
      </div>
    );
  }

  const place = form.handleSubmit(async (shipping) => {
    setPlacing(true);
    const result = await payments.createOrder({
      items,
      shipping,
      subtotal: totals.subtotal,
      shippingCost: totals.shipping,
      total: totals.total,
    });
    setPlacing(false);
    if (result.status === "success") {
      setOrderId(result.orderId);
      clear();
    }
  });

  return (
    <div className="container-page py-8 md:py-12">
      <h1 className="text-[length:var(--text-3xl)]">Checkout</h1>

      {/* Steps */}
      <ol className="mt-6 flex items-center gap-2" aria-label="Checkout progress">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full text-[length:var(--text-xs)] font-semibold",
                i < step
                  ? "bg-[var(--signal-gain)] text-white"
                  : i === step
                    ? "bg-[var(--brand-base)] text-[color:var(--brand-on)]"
                    : "bg-[var(--surface-0)] text-[color:var(--text-3)]",
              )}
            >
              {i < step ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span
              className={cn(
                "text-[length:var(--text-sm)]",
                i === step ? "font-medium text-[color:var(--text-1)]" : "text-[color:var(--text-3)]",
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="h-px flex-1 bg-[var(--border-1)]" aria-hidden />
            )}
          </li>
        ))}
      </ol>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
        <form onSubmit={place} className="surface-card p-6" noValidate>
          {step === 0 && (
            <fieldset>
              <legend className="text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
                Your details
              </legend>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="fullName">Full name</Label>
                  <Input id="fullName" autoComplete="name" {...form.register("fullName")} />
                  <FieldError>{form.formState.errors.fullName?.message}</FieldError>
                </div>
                <div>
                  <Label htmlFor="phone">Mobile number</Label>
                  <Input id="phone" inputMode="numeric" autoComplete="tel" {...form.register("phone")} />
                  <FieldError>{form.formState.errors.phone?.message}</FieldError>
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
                  <FieldError>{form.formState.errors.email?.message}</FieldError>
                </div>
              </div>
              <Button
                type="button"
                className="mt-6"
                onClick={async () => {
                  const ok = await form.trigger(["fullName", "phone", "email"]);
                  if (ok) setStep(1);
                }}
              >
                Continue to shipping
              </Button>
            </fieldset>
          )}

          {step === 1 && (
            <fieldset>
              <legend className="text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
                Shipping address
              </legend>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="address1">Address</Label>
                  <Input id="address1" autoComplete="address-line1" {...form.register("address1")} />
                  <FieldError>{form.formState.errors.address1?.message}</FieldError>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="address2">Apartment, landmark (optional)</Label>
                  <Input id="address2" autoComplete="address-line2" {...form.register("address2")} />
                </div>
                <div>
                  <Label htmlFor="city">City</Label>
                  <Input id="city" autoComplete="address-level2" {...form.register("city")} />
                  <FieldError>{form.formState.errors.city?.message}</FieldError>
                </div>
                <div>
                  <Label htmlFor="state">State</Label>
                  <Input id="state" autoComplete="address-level1" defaultValue="Maharashtra" {...form.register("state")} />
                  <FieldError>{form.formState.errors.state?.message}</FieldError>
                </div>
                <div>
                  <Label htmlFor="pincode">Pincode</Label>
                  <Input id="pincode" inputMode="numeric" autoComplete="postal-code" {...form.register("pincode")} />
                  <FieldError>{form.formState.errors.pincode?.message}</FieldError>
                </div>
              </div>
              <div className="mt-6 flex gap-3">
                <Button type="button" variant="secondary" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button
                  type="button"
                  onClick={async () => {
                    const ok = await form.trigger(["address1", "city", "state", "pincode"]);
                    if (ok) setStep(2);
                  }}
                >
                  Continue to payment
                </Button>
              </div>
            </fieldset>
          )}

          {step === 2 && (
            <fieldset>
              <legend className="text-[length:var(--text-lg)] font-semibold text-[color:var(--text-1)]">
                Payment
              </legend>
              <div className="mt-5 rounded-[var(--radius-lg)] border border-dashed border-[var(--border-2)] bg-[var(--surface-0)]/60 p-5">
                <p className="flex items-center gap-2 text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
                  <CreditCard className="size-4" aria-hidden />
                  Payment gateway not yet connected
                </p>
                <p className="mt-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                  This build routes through a stubbed payment provider. Wiring
                  Razorpay, PhonePe or Stripe means implementing one interface —
                  the checkout flow above stays exactly as it is.
                </p>
              </div>
              <div className="mt-6 flex gap-3">
                <Button type="button" variant="secondary" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button type="submit" loading={placing}>
                  <Lock className="size-4" aria-hidden />
                  Place order · {formatPrice(totals.total)}
                </Button>
              </div>
            </fieldset>
          )}
        </form>

        <aside className="lg:sticky lg:top-[calc(var(--nav-h)+1.5rem)] lg:self-start">
          <div className="surface-card p-5">
            <h2 className="text-[length:var(--text-base)] font-semibold text-[color:var(--text-1)]">
              Order summary
            </h2>
            <ul className="mt-4 space-y-3">
              {items.map((i) => (
                <li key={i.slug} className="flex justify-between gap-3 text-[length:var(--text-sm)]">
                  <span className="clamp-2 text-[color:var(--text-2)]">
                    {i.title} <span className="text-[color:var(--text-3)]">× {i.qty}</span>
                  </span>
                  <span className="tabular shrink-0 font-medium">{formatPrice(i.price * i.qty)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 space-y-2 border-t border-[var(--border-1)] pt-4 text-[length:var(--text-sm)]">
              <div className="flex justify-between">
                <dt className="text-[color:var(--text-2)]">Subtotal</dt>
                <dd className="tabular">{formatPrice(totals.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[color:var(--text-2)]">Shipping</dt>
                <dd className="tabular">
                  {totals.shipping === 0 ? (
                    <span className="text-[color:var(--signal-gain)]">Free</span>
                  ) : (
                    formatPrice(totals.shipping)
                  )}
                </dd>
              </div>
              <div className="flex justify-between border-t border-[var(--border-1)] pt-2.5 text-[length:var(--text-lg)] font-semibold">
                <dt>Total</dt>
                <dd className="tabular">{formatPrice(totals.total)}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
