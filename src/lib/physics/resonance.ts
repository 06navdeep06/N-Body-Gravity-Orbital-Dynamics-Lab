/**
 * Mean-motion resonance detection and Kirkwood-gap analysis.
 *
 * Two bodies are in a p:q mean-motion resonance when their orbital periods
 * form a near-integer ratio — the repeated gravitational kicks at the same
 * orbital phase accumulate instead of averaging out. This is what carves the
 * Kirkwood gaps in the asteroid belt (resonances with Jupiter) and what locks
 * Neptune and Pluto into their 3:2 dance.
 */

import { computeOrbitalElements } from "./orbital-elements";
import type { CelestialBody } from "./types";

/** Fractional tolerance on the period ratio for a resonance to count. */
export const RESONANCE_TOLERANCE = 0.02;
/** Largest integer allowed in a p:q ratio. */
export const MAX_RESONANCE_ORDER = 7;

export interface ResonancePair {
  bodyA: string;
  bodyB: string;
  /** [p, q] with p > q, meaning bodyA completes p orbits per q of bodyB. */
  ratio: [number, number];
  /**
   * 0–1 score: how close the ratio is to exact, weighted down for
   * high-order resonances (which are physically much weaker).
   */
  strength: number;
  periodA: number;
  periodB: number;
}

interface Orbiter {
  body: CelestialBody;
  period: number;
  semiMajorAxis: number;
}

/** Keplerian periods for every bound, non-primary body. */
function collectOrbiters(
  bodies: CelestialBody[],
  primary: CelestialBody,
  G: number
): Orbiter[] {
  const orbiters: Orbiter[] = [];
  for (const body of bodies) {
    if (body.id === primary.id) continue;
    const elements = computeOrbitalElements(body, primary, G);
    if (!elements) continue;
    if (!Number.isFinite(elements.period) || elements.period <= 0) continue;
    orbiters.push({ body, period: elements.period, semiMajorAxis: elements.semiMajorAxis });
  }
  return orbiters;
}

/** Best simple integer ratio approximating `value` (>= 1), or null. */
function findIntegerRatio(value: number): { p: number; q: number; error: number } | null {
  let best: { p: number; q: number; error: number } | null = null;
  for (let q = 1; q <= MAX_RESONANCE_ORDER; q++) {
    for (let p = q; p <= MAX_RESONANCE_ORDER; p++) {
      // Only reduced fractions: 4:2 is the same resonance as 2:1.
      if (gcd(p, q) !== 1) continue;
      const error = Math.abs(value - p / q) / (p / q);
      if (error <= RESONANCE_TOLERANCE && (!best || error < best.error)) {
        best = { p, q, error };
      }
    }
  }
  return best;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Finds all mean-motion resonances among bodies orbiting `primary`.
 * 1:1 pairs (co-orbital / Trojan-like) are excluded — for a body against
 * itself or a near-identical orbit that's not an interesting resonance and
 * would flood the results in belt/ring presets.
 */
export function detectResonances(
  bodies: CelestialBody[],
  primary: CelestialBody,
  G: number
): ResonancePair[] {
  const orbiters = collectOrbiters(bodies, primary, G);
  const found: ResonancePair[] = [];

  for (let i = 0; i < orbiters.length; i++) {
    for (let j = i + 1; j < orbiters.length; j++) {
      const a = orbiters[i]!;
      const b = orbiters[j]!;
      // Orient so the ratio is >= 1: inner body (shorter period) is "p".
      const [inner, outer] = a.period <= b.period ? [a, b] : [b, a];
      const ratioValue = outer.period / inner.period;
      const match = findIntegerRatio(ratioValue);
      if (!match) continue;
      if (match.p === 1 && match.q === 1) continue;

      // Closeness to exact, damped by resonance order (p + q).
      const closeness = 1 - match.error / RESONANCE_TOLERANCE;
      const orderPenalty = 2 / (match.p + match.q);
      found.push({
        bodyA: inner.body.id,
        bodyB: outer.body.id,
        ratio: [match.p, match.q],
        strength: Math.max(0, Math.min(1, closeness * orderPenalty)),
        periodA: inner.period,
        periodB: outer.period,
      });
    }
  }

  return found.sort((x, y) => y.strength - x.strength);
}

// ---------------------------------------------------------------------------
// Kirkwood gaps
// ---------------------------------------------------------------------------

export interface KirkwoodBin {
  /** Bin center, in semi-major-axis units. */
  center: number;
  count: number;
}

export interface ResonanceLocation {
  /** Semi-major axis where this resonance with the perturber sits. */
  semiMajorAxis: number;
  label: string;
  /** True when the local population is depleted relative to its neighbours. */
  depleted: boolean;
}

export interface KirkwoodAnalysis {
  bins: KirkwoodBin[];
  resonances: ResonanceLocation[];
  /** The perturbing body the resonance locations were computed against. */
  perturberName: string;
  minA: number;
  maxA: number;
}

/** Resonance ratios that carve the real asteroid belt (perturber : asteroid). */
const KIRKWOOD_RATIOS: [number, number][] = [
  [3, 1],
  [5, 2],
  [7, 3],
  [2, 1],
];

/**
 * Histograms the semi-major axes of a small-body population and marks the
 * locations of strong resonances with the most massive non-primary body
 * (Jupiter's role in the real belt), flagging bins that are depleted
 * relative to their surroundings.
 */
export function analyzeKirkwoodGaps(
  bodies: CelestialBody[],
  primary: CelestialBody,
  G: number,
  binCount = 48
): KirkwoodAnalysis | null {
  const orbiters = collectOrbiters(bodies, primary, G);
  if (orbiters.length < 8) return null;

  // The perturber is the heaviest orbiting body; the "population" is
  // everything much lighter than it.
  const perturber = orbiters.reduce((max, o) => (o.body.mass > max.body.mass ? o : max));
  const population = orbiters.filter((o) => o.body.mass < perturber.body.mass * 0.1);
  if (population.length < 8) return null;

  const axes = population.map((o) => o.semiMajorAxis).filter((a) => Number.isFinite(a) && a > 0);
  if (axes.length < 8) return null;

  const minA = Math.min(...axes);
  const maxA = Math.max(...axes);
  const span = maxA - minA || 1;
  const binWidth = span / binCount;

  const bins: KirkwoodBin[] = Array.from({ length: binCount }, (_, i) => ({
    center: minA + (i + 0.5) * binWidth,
    count: 0,
  }));
  for (const a of axes) {
    const idx = Math.min(binCount - 1, Math.floor((a - minA) / binWidth));
    bins[idx]!.count += 1;
  }

  const meanCount = axes.length / binCount;

  // A p:q resonance with the perturber sits where the period ratio is p/q,
  // i.e. a_res = a_perturber * (q/p)^(2/3) by Kepler's third law.
  const resonances: ResonanceLocation[] = KIRKWOOD_RATIOS.map(([p, q]) => {
    const semiMajorAxis = perturber.semiMajorAxis * Math.cbrt((q / p) ** 2);
    const idx = Math.floor((semiMajorAxis - minA) / binWidth);
    const inRange = idx >= 0 && idx < binCount;
    const localCount = inRange ? bins[idx]!.count : 0;
    return {
      semiMajorAxis,
      label: `${p}:${q}`,
      depleted: inRange && localCount < meanCount * 0.5,
    };
  }).filter((r) => r.semiMajorAxis >= minA && r.semiMajorAxis <= maxA);

  return { bins, resonances, perturberName: perturber.body.name, minA, maxA };
}
