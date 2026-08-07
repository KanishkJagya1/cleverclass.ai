"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CartItem } from "@/types/catalog";
import { orderTotals } from "@/lib/utils";

interface CartState {
  items: CartItem[];
  /** Hydration guard — see note below. */
  ready: boolean;
  add: (item: Omit<CartItem, "qty">, qty?: number) => void;
  /**
   * `delivery` is optional on purpose: omitting it removes BOTH formats of the
   * title, which is what "remove this book" means from a cart row that shows
   * only one of them.
   */
  remove: (slug: string, delivery?: CartItem["delivery"]) => void;
  setQty: (slug: string, qty: number, delivery?: CartItem["delivery"]) => void;
  clear: () => void;
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      ready: false,

      add: (item, qty = 1) =>
        set((s) => {
          // Matched on slug AND delivery. Keying on slug alone merged the
          // printed copy and the e-book into one line at one price.
          const delivery = item.delivery ?? "physical";
          const same = (i: CartItem) =>
            i.slug === item.slug && (i.delivery ?? "physical") === delivery;
          const existing = s.items.find(same);
          return existing
            ? {
                items: s.items.map((i) =>
                  same(i) ? { ...i, qty: Math.min(99, i.qty + qty) } : i,
                ),
              }
            : { items: [...s.items, { ...item, delivery, qty }] };
        }),

      remove: (slug, delivery) =>
        set((s) => ({
          items: s.items.filter((i) =>
            delivery
              ? !(i.slug === slug && (i.delivery ?? "physical") === delivery)
              : i.slug !== slug,
          ),
        })),

      setQty: (slug, qty, delivery) =>
        set((s) => {
          const hit = (i: CartItem) =>
            i.slug === slug &&
            (delivery ? (i.delivery ?? "physical") === delivery : true);
          return {
            items:
              qty <= 0
                ? s.items.filter((i) => !hit(i))
                : s.items.map((i) =>
                    hit(i) ? { ...i, qty: Math.min(99, qty) } : i,
                  ),
          };
        }),

      clear: () => set({ items: [] }),
    }),
    {
      name: "kt-cart",
      partialize: (s) => ({ items: s.items }),
      // `ready` flips only after localStorage is read. Every consumer renders
      // a neutral state until then — otherwise the server HTML (empty cart)
      // and the client's first paint (restored cart) disagree and React
      // throws a hydration mismatch on the badge count.
      onRehydrateStorage: () => (state) => state && (state.ready = true),
    },
  ),
);

/* Selectors — subscribing to derived values keeps the badge from re-rendering
   the whole tree on every quantity change. */
export const useCartCount = () =>
  useCart((s) => (s.ready ? s.items.reduce((n, i) => n + i.qty, 0) : 0));

export const useCartSubtotal = () =>
  useCart((s) => s.items.reduce((n, i) => n + i.price * i.qty, 0));

export function useCartTotals() {
  const subtotal = useCartSubtotal();
  return orderTotals(subtotal);
}
