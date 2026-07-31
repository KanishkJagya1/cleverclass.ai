"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Board, Medium } from "@/types/catalog";

/**
 * Board + medium are site-wide context (D3): they change what the catalog
 * *contains*, not merely how it is sorted. Persisted so a Marathi-medium
 * State Board family never has to re-declare themselves.
 */
interface PreferencesState {
  board: Board;
  medium: Medium | null;
  ready: boolean;
  setBoard: (b: Board) => void;
  setMedium: (m: Medium | null) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      board: "state",
      medium: null,
      ready: false,
      setBoard: (board) => set({ board }),
      setMedium: (medium) => set({ medium }),
    }),
    {
      name: "kt-preferences",
      partialize: (s) => ({ board: s.board, medium: s.medium }),
      onRehydrateStorage: () => (state) => state && (state.ready = true),
    },
  ),
);
