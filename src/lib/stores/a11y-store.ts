/**
 * Accessibility + locale state, kept separate from the simulation store so
 * toggling a preference doesn't invalidate physics subscribers.
 */

import { create } from "zustand";
import {
  persistPreferences,
  readPreferences,
  type A11yPreferences,
} from "@/lib/a11y/preferences";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/translations";

interface A11yState extends A11yPreferences {
  locale: Locale;
  /** Message queued for the screen-reader live region. */
  announcement: string;

  syncFromSystem: () => void;
  toggleColorBlindMode: () => void;
  setLocale: (locale: Locale) => void;
  announce: (message: string) => void;
}

export const useA11yStore = create<A11yState>((set, get) => ({
  // Server-render defaults; syncFromSystem() replaces these on mount, which
  // keeps the SSR and first client render identical (no hydration mismatch).
  reducedMotion: false,
  highContrast: false,
  colorBlindMode: false,
  locale: DEFAULT_LOCALE,
  announcement: "",

  syncFromSystem: () => set({ ...readPreferences() }),

  toggleColorBlindMode: () => {
    const colorBlindMode = !get().colorBlindMode;
    set({ colorBlindMode });
    persistPreferences({ colorBlindMode });
  },

  setLocale: (locale) => {
    set({ locale });
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem("locale", locale);
      } catch {
        // ignore
      }
    }
  },

  announce: (announcement) => set({ announcement }),
}));
