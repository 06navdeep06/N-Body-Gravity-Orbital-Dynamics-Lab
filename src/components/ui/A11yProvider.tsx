"use client";

/**
 * Applies accessibility preferences to the document and hosts the
 * screen-reader live region.
 *
 * Preferences become `data-` attributes on <html>, so CSS can respond
 * globally (see globals.css) and any component can read them without
 * subscribing to the store.
 */

import { useEffect } from "react";
import { watchPreferences } from "@/lib/a11y/preferences";
import { useLocale } from "@/lib/i18n/use-locale";
import { useA11yStore } from "@/lib/stores/a11y-store";
import { useSimulationStore } from "@/lib/stores/simulation-store";

export function A11yProvider() {
  const reducedMotion = useA11yStore((s) => s.reducedMotion);
  const highContrast = useA11yStore((s) => s.highContrast);
  const colorBlindMode = useA11yStore((s) => s.colorBlindMode);
  const announcement = useA11yStore((s) => s.announcement);
  const { locale, t } = useLocale();

  // Sync from the OS on mount and whenever the media queries change.
  useEffect(() => {
    const sync = () => useA11yStore.getState().syncFromSystem();
    sync();
    return watchPreferences(sync);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.reducedMotion = String(reducedMotion);
    root.dataset.highContrast = String(highContrast);
    root.dataset.colorBlind = String(colorBlindMode);
    root.lang = locale;
  }, [reducedMotion, highContrast, colorBlindMode, locale]);

  // Announce simulation state changes for screen readers.
  useEffect(() => {
    return useSimulationStore.subscribe((state, prev) => {
      const announce = useA11yStore.getState().announce;
      if (state.isRunning !== prev.isRunning) {
        announce(state.isRunning ? t("announce.playing") : t("announce.paused"));
      } else if (state.presetId !== prev.presetId) {
        announce(`${t("announce.presetLoaded")}: ${state.presetId}`);
      } else if (state.selectedBodyId !== prev.selectedBodyId) {
        const name = state.system.bodies.find((b) => b.id === state.selectedBodyId)?.name;
        announce(name ? `${t("announce.bodySelected")}: ${name}` : t("announce.bodyDeselected"));
      }
    });
  }, [t]);

  return (
    <>
      {/*
        Two live regions: `polite` for routine state changes so they queue
        behind whatever the user is reading. Visually hidden, not
        display:none — the latter removes it from the accessibility tree.
      */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>
    </>
  );
}
