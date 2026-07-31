/**
 * Payment seam.
 *
 * Phase 1 §2.1 put real payments out of scope. This interface is what keeps
 * that decision cheap: when Razorpay / PhonePe / Stripe is chosen, one module
 * implements `PaymentProvider` and the checkout UI does not change.
 */
import type { CartItem } from "@/types/catalog";

export interface ShippingDetails {
  fullName: string;
  phone: string;
  email: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  pincode: string;
}

export interface OrderDraft {
  items: CartItem[];
  shipping: ShippingDetails;
  subtotal: number;
  shippingCost: number;
  total: number;
}

export interface PaymentResult {
  status: "success" | "failed" | "pending";
  orderId: string;
  message?: string;
}

export interface PaymentProvider {
  readonly name: string;
  createOrder(draft: OrderDraft): Promise<PaymentResult>;
}

/**
 * Stub. Generates a plausible order id and always succeeds, so the whole
 * checkout flow — including the confirmation screen — is testable today.
 */
export const stubPaymentProvider: PaymentProvider = {
  name: "stub",
  async createOrder(draft) {
    await new Promise((r) => setTimeout(r, 900));
    const stamp = Date.now().toString(36).toUpperCase().slice(-6);
    return {
      status: "success",
      orderId: `KT-${stamp}`,
      message: `Order for ${draft.items.length} item(s) recorded.`,
    };
  },
};

export const payments: PaymentProvider = stubPaymentProvider;
