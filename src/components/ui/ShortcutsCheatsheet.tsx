"use client";

/** Keyboard shortcut reference, toggled with `?` (or Shift+/), closed with Esc. */

import { useEffect, useState } from "react";
import { PRESETS } from "@/lib/presets";

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["R", "Reset current preset"],
  ["G", "Toggle spacetime grid"],
  ["T", "Toggle trails"],
  ["N", "Toggle resonances"],
  ["W", "Toggle GW strain"],
  [`1–${PRESETS.length}`, "Load preset"],
  ["Esc", "Deselect body / close dialogs"],
  ["Delete", "Remove selected body"],
  ["Shift + drag", "Launch a new body (slingshot)"],
  ["?", "Toggle this cheatsheet"],
];

export function ShortcutsCheatsheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (e.key === "?") setOpen((v) => !v);
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!open) return null;

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/60"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-80 rounded-lg border border-zinc-700 bg-zinc-950 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2 border-b border-zinc-800 pb-2">
          <img src="/textures/logo.png" alt="Logo" className="h-5 w-5 object-contain" />
          <h3 className="text-sm font-semibold text-zinc-100">Keyboard Shortcuts</h3>
        </div>
        <div className="space-y-1.5">
          {SHORTCUTS.map(([key, desc]) => (
            <div key={key} className="flex items-center justify-between text-xs">
              <kbd className="rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200">
                {key}
              </kbd>
              <span className="text-zinc-400">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
