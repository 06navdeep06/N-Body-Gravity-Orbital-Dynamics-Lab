"use client";

/**
 * Locale hook. Resolves `navigator.language` (or a stored override) to one
 * of the supported locales, falling back to English, and returns a `t()`
 * lookup.
 *
 * Detection runs in an effect rather than during render so the server and
 * the first client render agree — reading navigator.language during render
 * would produce a hydration mismatch for any non-English visitor.
 */

import { useCallback, useEffect } from "react";
import { useA11yStore } from "@/lib/stores/a11y-store";
import {
  DEFAULT_LOCALE,
  LOCALES,
  TRANSLATIONS,
  type Locale,
  type TranslationKey,
} from "./translations";

/** Maps a BCP-47 tag ("es-MX", "ja") onto a supported locale. */
export function resolveLocale(tag: string | undefined | null): Locale {
  if (!tag) return DEFAULT_LOCALE;
  const base = tag.toLowerCase().split("-")[0];
  return (LOCALES as readonly string[]).includes(base ?? "")
    ? (base as Locale)
    : DEFAULT_LOCALE;
}

/** Reads a translation with an English fallback, then the key itself. */
export function translate(locale: Locale, key: TranslationKey): string {
  return TRANSLATIONS[locale][key] ?? TRANSLATIONS[DEFAULT_LOCALE][key] ?? key;
}

export function useLocale() {
  const locale = useA11yStore((s) => s.locale);
  const setLocale = useA11yStore((s) => s.setLocale);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("locale");
    } catch {
      // Storage unavailable — fall through to navigator detection.
    }
    const resolved = resolveLocale(stored ?? navigator.language);
    if (resolved !== useA11yStore.getState().locale) {
      useA11yStore.getState().setLocale(resolved);
    }
  }, []);

  const t = useCallback((key: TranslationKey) => translate(locale, key), [locale]);

  return { locale, setLocale, t };
}
