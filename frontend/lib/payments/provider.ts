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
 * Records a real order request against the API.
 *
 * NOT a payment. No money moves — this persists the request and returns its
 * reference, and the shop confirms by phone. It implements `PaymentProvider`
 * so that when a real gateway is added it slots in beside this one and the
 * checkout UI does not change.
 *
 * It resolves only once the row exists. The previous stub awaited a timer and
 * returned `success` unconditionally, which meant a customer could complete
 * checkout, see a reference number, and have nothing recorded anywhere.
 */
export const requestOrderProvider: PaymentProvider = {
  name: "order-request",
  async createOrder(draft): Promise<PaymentResult> {
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: draft.items.map((i) => ({ slug: i.slug, qty: i.qty })),
          name: draft.shipping.fullName,
          phone: draft.shipping.phone,
          email: draft.shipping.email || undefined,
          address1: draft.shipping.address1,
          address2: draft.shipping.address2 ?? "",
          city: draft.shipping.city,
          state: draft.shipping.state,
          pincode: draft.shipping.pincode,
          source: "checkout",
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        return {
          status: "failed",
          orderId: "",
          message: (body as { error?: string }).error ?? "We couldn't record that order.",
        };
      }

      return {
        status: "success",
        orderId: (body as { orderNumber: string }).orderNumber,
        message: (body as { message?: string }).message,
      };
    } catch {
      return {
        status: "failed",
        orderId: "",
        message:
          "We couldn't reach our server. Nothing has been charged and your cart is intact.",
      };
    }
  },
};

export const payments: PaymentProvider = requestOrderProvider;
