"use client";

import { useTheme } from "next-themes";
import { BOARDS, MEDIUMS } from "@/constants/catalog";
import { usePreferences } from "@/lib/store/preferences";
import { cn } from "@/lib/utils";

/** Preferences are duplicated here for discoverability; the navbar switchers
    remain the primary control because they change what the catalogue shows. */
export default function SettingsPage() {
  const { board, medium, setBoard, setMedium } = usePreferences();
  const { theme, setTheme } = useTheme();

  const Row = ({
    label,
    options,
    value,
    onChange,
  }: {
    label: string;
    options: { id: string; label: string }[];
    value: string | null;
    onChange: (v: string) => void;
  }) => (
    <div className="border-b border-[var(--border-1)] py-5 last:border-0">
      <p className="text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">{label}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            aria-pressed={value === o.id}
            className={cn(
              "rounded-[var(--radius-md)] border px-3.5 py-2 text-[length:var(--text-sm)] transition-colors",
              value === o.id
                ? "border-[var(--brand-base)] bg-[var(--brand-soft)] text-[color:var(--text-brand)]"
                : "border-[var(--border-1)] text-[color:var(--text-2)] hover:border-[var(--border-2)]",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <h1 className="text-[length:var(--text-3xl)]">Settings</h1>

      <div className="surface-card mt-8 max-w-2xl px-6">
        <Row
          label="Board"
          options={BOARDS.map((b) => ({ id: b.id, label: b.label }))}
          value={board}
          onChange={(v) => setBoard(v as (typeof BOARDS)[number]["id"])}
        />
        <Row
          label="Preferred medium"
          options={[{ id: "all", label: "All mediums" }, ...MEDIUMS.map((m) => ({ id: m.id, label: m.label }))]}
          value={medium ?? "all"}
          onChange={(v) => setMedium(v === "all" ? null : (v as (typeof MEDIUMS)[number]["id"]))}
        />
        <Row
          label="Appearance"
          options={[
            { id: "light", label: "Light" },
            { id: "dark", label: "Dark" },
          ]}
          value={theme ?? "light"}
          onChange={setTheme}
        />
      </div>
    </div>
  );
}
