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
  remove: (slug: string) => void;
  setQty: (slug: string, qty: number) => void;
  clear: () => void;
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      ready: false,

      add: (item, qty = 1) =>
        set((s) => {
          const existing = s.items.find((i) => i.slug === item.slug);
          return existing
            ? {
                items: s.items.map((i) =>
                  i.slug === item.slug ? { ...i, qty: Math.min(99, i.qty + qty) } : i,
                ),
              }
            : { items: [...s.items, { ...item, qty }] };
        }),

      remove: (slug) => set((s) => ({ items: s.items.filter((i) => i.slug !== slug) })),

      setQty: (slug, qty) =>
        set((s) => ({
          items:
            qty <= 0
              ? s.items.filter((i) => i.slug !== slug)
              : s.items.map((i) => (i.slug === slug ? { ...i, qty: Math.min(99, qty) } : i)),
        })),

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
