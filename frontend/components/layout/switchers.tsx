"use client";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { BOARDS, MEDIUMS } from "@/constants/catalog";
import { usePreferences } from "@/lib/store/preferences";
import { cn } from "@/lib/utils";

/**
 * `max-w` + `truncate` is load-bearing, not cosmetic. Labels vary from "CBSE"
 * (4 chars) to "सेमी-इंग्रजी" (12 Devanagari glyphs, visually wider still).
 * Without a width ceiling the longest pair grows the utilities cluster and
 * pushes the nav links onto a second line inside a fixed-height bar.
 */
const triggerCls = cn(
  "inline-flex h-8 min-w-0 max-w-[8.5rem] shrink items-center gap-1.5 rounded-full",
  "border border-[var(--border-1)] whitespace-nowrap",
  "bg-[var(--surface-1)]/60 px-3 text-[length:var(--text-xs)] font-medium text-[var(--text-2)]",
  "transition-colors hover:border-[var(--border-2)] hover:text-[var(--text-1)]",
);

const contentCls = cn(
  "glass-panel glass-edge z-[var(--z-dropdown)] min-w-52 p-1.5",
  "data-[state=open]:animate-[fadeDown_var(--duration-fast)_var(--ease-out-expo)]",
);

const itemCls = cn(
  "flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-sm)]",
  "px-3 py-2 text-[length:var(--text-sm)] text-[var(--text-2)] outline-none",
  "data-[highlighted]:bg-[var(--surface-0)] data-[highlighted]:text-[var(--text-1)]",
);

/**
 * Board and medium live in the navbar, not in settings, because they change
 * what the catalog *contains* (D3). Rendering a stable placeholder until the
 * store rehydrates keeps server and client HTML identical.
 */
export function BoardSwitcher() {
  const { board, setBoard, ready } = usePreferences();
  const current = BOARDS.find((b) => b.id === board) ?? BOARDS[0]!;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={triggerCls} aria-label={`Board: ${current.label}`}>
        <span className="truncate" suppressHydrationWarning>
          {ready ? current.short : BOARDS[0]!.short}
        </span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={contentCls} sideOffset={8} align="end">
          <p className="px-3 pb-1.5 pt-1 text-[length:var(--text-2xs)] font-semibold uppercase tracking-[var(--tracking-wide)] text-[var(--text-3)]">
            Board
          </p>
          {BOARDS.map((b) => (
            <DropdownMenu.Item key={b.id} className={itemCls} onSelect={() => setBoard(b.id)}>
              {b.label}
              {board === b.id && <Check className="size-4 text-[var(--brand-base)]" aria-hidden />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MediumSwitcher() {
  const { medium, setMedium, ready } = usePreferences();
  const current = MEDIUMS.find((m) => m.id === medium);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={triggerCls}
        aria-label={`Medium: ${current?.label ?? "All mediums"}`}
      >
        <span className="truncate" suppressHydrationWarning>
          {ready && current ? current.labelNative : "All mediums"}
        </span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={contentCls} sideOffset={8} align="end">
          <p className="px-3 pb-1.5 pt-1 text-[length:var(--text-2xs)] font-semibold uppercase tracking-[var(--tracking-wide)] text-[var(--text-3)]">
            Medium
          </p>
          <DropdownMenu.Item className={itemCls} onSelect={() => setMedium(null)}>
            All mediums
            {medium === null && <Check className="size-4 text-[var(--brand-base)]" aria-hidden />}
          </DropdownMenu.Item>
          {MEDIUMS.map((m) => (
            <DropdownMenu.Item key={m.id} className={itemCls} onSelect={() => setMedium(m.id)}>
              <span>
                {m.label}
                <span className="ml-2 text-[var(--text-3)]" lang="mr">
                  {m.id !== "english" && m.labelNative}
                </span>
              </span>
              {medium === m.id && <Check className="size-4 text-[var(--brand-base)]" aria-hidden />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
