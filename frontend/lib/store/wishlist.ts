"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WishlistState {
  slugs: string[];
  ready: boolean;
  toggle: (slug: string) => void;
  has: (slug: string) => boolean;
  clear: () => void;
}

export const useWishlist = create<WishlistState>()(
  persist(
    (set, get) => ({
      slugs: [],
      ready: false,
      toggle: (slug) =>
        set((s) => ({
          slugs: s.slugs.includes(slug)
            ? s.slugs.filter((x) => x !== slug)
            : [...s.slugs, slug],
        })),
      has: (slug) => get().slugs.includes(slug),
      clear: () => set({ slugs: [] }),
    }),
    {
      name: "kt-wishlist",
      partialize: (s) => ({ slugs: s.slugs }),
      onRehydrateStorage: () => (state) => state && (state.ready = true),
    },
  ),
);

export const useWishlistCount = () => useWishlist((s) => (s.ready ? s.slugs.length : 0));
