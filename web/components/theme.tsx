"use client";

import { useSyncExternalStore } from "react";

type Choice = "system" | "light" | "dark";
const LABEL: Record<Choice, string> = { system: "Same as device", light: "Light", dark: "Dark" };

const listeners = new Set<() => void>();
const read = (): Choice => {
  try {
    return (localStorage.getItem("theme") as Choice | null) ?? "system";
  } catch {
    return "system"; // storage blocked: the device decides
  }
};

function choose(choice: Choice) {
  try {
    if (choice === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", choice);
  } catch {}
  (window as unknown as { __applyTheme?: () => void }).__applyTheme?.();
  listeners.forEach((l) => l());
}

/** System, Light or Dark, kept on this device; window.__applyTheme comes from THEME (lib/theme.ts). */
export function ThemeChoice() {
  const current = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    read,
    () => "system" as Choice,
  );
  return (
    <fieldset className="flex w-fit gap-1 rounded-lg border border-rule bg-tint p-1">
      <legend className="sr-only">Appearance</legend>
      {(["system", "light", "dark"] as const).map((c) => (
        <label
          key={c}
          className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-semibold has-focus-visible:outline-2 has-focus-visible:outline-accent ${
            current === c ? "bg-paper text-ink shadow-[inset_0_0_0_1px_var(--color-rule)]" : "text-ink-2 hover:text-ink"
          }`}
        >
          <input type="radio" name="theme" value={c} checked={current === c} onChange={() => choose(c)} className="sr-only" />
          {LABEL[c]}
        </label>
      ))}
    </fieldset>
  );
}
