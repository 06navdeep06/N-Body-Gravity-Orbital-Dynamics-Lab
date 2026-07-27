/**
 * Seeded random-number utilities shared by the procedural generators.
 * Everything is driven from an explicit seed so a given seed always
 * reproduces the same universe.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number;
  /** Standard normal (mean 0, sd 1) via Box-Muller. */
  gaussian(): number;
  /** Rayleigh-distributed value with the given scale parameter σ. */
  rayleigh(sigma: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
}

/** mulberry32 — small, fast, and good enough for content generation. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    gaussian() {
      // Guard against log(0).
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    rayleigh(sigma) {
      let u = 0;
      while (u === 0) u = next();
      // Inverse CDF: r = σ√(−2 ln u)
      return sigma * Math.sqrt(-2 * Math.log(u));
    },
    chance: (p) => next() < p,
  };
}

/** Turns an arbitrary seed string into a 32-bit integer seed. */
export function seedFromString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Main-sequence stellar color from mass (in solar masses). Follows the
 * spectral sequence M → K → G → F → A → B: cool low-mass stars are red,
 * solar-mass stars yellow-white, massive stars blue-white.
 */
export function stellarColor(solarMasses: number): string {
  if (solarMasses < 0.45) return "#ffb56b"; // M — red dwarf
  if (solarMasses < 0.8) return "#ffd2a1"; // K — orange
  if (solarMasses < 1.04) return "#fff4e8"; // G — sun-like
  if (solarMasses < 1.4) return "#f8f7ff"; // F — yellow-white
  if (solarMasses < 2.1) return "#cad7ff"; // A — white
  if (solarMasses < 16) return "#aabfff"; // B — blue-white
  return "#9bb0ff"; // O — blue
}

/**
 * Samples a stellar mass from the Kroupa initial mass function:
 *   ξ(m) ∝ m^-1.3   for 0.08 ≤ m < 0.5
 *   ξ(m) ∝ m^-2.3   for m ≥ 0.5
 * Sampled by inverting the CDF of each segment, with the segments weighted
 * by their integrated probability — which is why low-mass stars vastly
 * outnumber massive ones, as observed.
 */
export function sampleKroupaMass(rng: Rng, mMin = 0.08, mMax = 50): number {
  const mBreak = 0.5;
  const a1 = -1.3;
  const a2 = -2.3;

  // Integral of m^a over [lo, hi].
  const integrate = (a: number, lo: number, hi: number) =>
    a === -1 ? Math.log(hi / lo) : (Math.pow(hi, a + 1) - Math.pow(lo, a + 1)) / (a + 1);

  // Continuity at the break: ξ2(mBreak) must equal ξ1(mBreak).
  const k2 = Math.pow(mBreak, a1 - a2);
  const w1 = integrate(a1, mMin, mBreak);
  const w2 = k2 * integrate(a2, mBreak, mMax);
  const total = w1 + w2;

  const u = rng.next();
  if (u < w1 / total) {
    // Invert within the low-mass segment.
    const t = (u * total) / 1;
    const target = t;
    const p = a1 + 1;
    return Math.pow(Math.pow(mMin, p) + target * p, 1 / p);
  }
  const target = ((u * total - w1) / k2) * 1;
  const p = a2 + 1;
  return Math.pow(Math.pow(mBreak, p) + target * p, 1 / p);
}
