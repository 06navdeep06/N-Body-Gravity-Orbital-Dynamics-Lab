/**
 * Accessibility preferences.
 *
 * OS-level preferences (`prefers-reduced-motion`, `prefers-contrast`) are
 * read from matchMedia and kept live; the color-blind palette is an explicit
 * user choice persisted to localStorage.
 *
 * Reduced motion deliberately does *not* stop the simulation — the orbital
 * motion is the content, not decoration. It suppresses the incidental
 * animation layered on top: trails, particle bursts, lens flares, shockwaves
 * and UI transitions.
 */

export interface A11yPreferences {
  reducedMotion: boolean;
  highContrast: boolean;
  colorBlindMode: boolean;
}

const STORAGE_KEY = "a11y-preferences";

/**
 * Okabe-Ito qualitative palette: eight hues chosen to stay mutually
 * distinguishable under deuteranopia, protanopia and tritanopia.
 */
export const OKABE_ITO = [
  "#e69f00", // orange
  "#56b4e9", // sky blue
  "#009e73", // bluish green
  "#f0e442", // yellow
  "#0072b2", // blue
  "#d55e00", // vermillion
  "#cc79a7", // reddish purple
  "#000000", // black
] as const;

/** Stable hash so a given body id always maps to the same palette entry. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Remaps a body color into the Okabe-Ito palette. Keyed by body id rather
 * than by the original color, so two bodies that happen to share a color
 * still get distinguishable ones.
 */
export function colorBlindColor(bodyId: string): string {
  // Skip pure black (index 7) for bodies — it's indistinguishable from the
  // background here.
  const index = hashId(bodyId) % (OKABE_ITO.length - 1);
  return OKABE_ITO[index]!;
}

function readStored(): Partial<A11yPreferences> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<A11yPreferences>) : {};
  } catch {
    return {};
  }
}

export function persistPreferences(prefs: Pick<A11yPreferences, "colorBlindMode">): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode — preferences just won't persist.
  }
}

/** Current preferences, combining OS media queries with stored choices. */
export function readPreferences(): A11yPreferences {
  const stored = readStored();
  const match = (query: string): boolean =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false;

  return {
    reducedMotion: match("(prefers-reduced-motion: reduce)"),
    highContrast: match("(prefers-contrast: more)"),
    colorBlindMode: stored.colorBlindMode ?? false,
  };
}

/** Subscribes to OS preference changes; returns an unsubscribe function. */
export function watchPreferences(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const queries = [
    window.matchMedia("(prefers-reduced-motion: reduce)"),
    window.matchMedia("(prefers-contrast: more)"),
  ];
  for (const q of queries) q.addEventListener("change", onChange);
  return () => {
    for (const q of queries) q.removeEventListener("change", onChange);
  };
}
