"use client";

/**
 * Global keyboard shortcuts:
 *   Space  play/pause        R      reset current preset
 *   G      spacetime grid    T      trails
 *   1–8    load preset N     Esc    deselect body
 *   Delete remove selected   ?      cheatsheet (handled by the sheet itself)
 *
 * Ignores keystrokes while typing in inputs/selects/textareas.
 */

import { useEffect } from "react";
import { PRESETS } from "@/lib/presets";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { useTimelineStore } from "@/lib/stores/timeline-store";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const store = useSimulationStore.getState();

      switch (e.key) {
        case " ":
          e.preventDefault();
          store.togglePlay();
          break;
        case "r":
        case "R": {
          const preset = PRESETS.find((p) => p.id === store.presetId) ?? PRESETS[0];
          if (preset) {
            store.loadPreset(preset);
            useTimelineStore.getState().clearHistory();
          }
          break;
        }
        case "g":
        case "G":
          store.toggleShowSpacetimeGrid();
          break;
        case "t":
        case "T":
          store.toggleShowTrails();
          break;
        case "n":
        case "N":
          store.toggleShowResonances();
          break;
        case "w":
        case "W":
          store.toggleShowGwStrain();
          break;
        case "Escape":
          store.selectBody(null);
          break;
        case "Delete":
        case "Backspace":
          if (store.selectedBodyId) store.removeBody(store.selectedBodyId);
          break;
        default: {
          const digit = Number(e.key);
          if (Number.isInteger(digit) && digit >= 1 && digit <= PRESETS.length) {
            const preset = PRESETS[digit - 1];
            if (preset) {
              store.loadPreset(preset);
              useTimelineStore.getState().clearHistory();
            }
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
