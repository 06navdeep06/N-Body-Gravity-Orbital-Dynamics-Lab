/**
 * Tidal disruption events.
 *
 * When a body passes deep inside a much heavier body's Roche limit, the tidal
 * field across its own diameter exceeds its self-gravity and it is pulled
 * apart. This module replaces such a body with a swarm of fragments laid out
 * along the tidal axis and sheared in velocity, which is what produces the
 * characteristic leading/trailing tidal tails.
 *
 * Nothing here special-cases the tails themselves: once the fragments exist,
 * the ordinary N-body integrator evolves them into streams on its own.
 */

import { rocheLimit, uniformDensity } from "./tidal";
import type { CelestialBody, SystemState, Vector3D } from "./types";
import { add, cross, length, scale, sub } from "./vector";

/** Disruptor must outweigh the victim by at least this factor. */
export const MIN_MASS_RATIO = 100;
/** Power-law slope for the fragment mass spectrum: m_k ∝ k^(-FRAGMENT_SLOPE). */
const FRAGMENT_SLOPE = 1.8;
const MIN_FRAGMENTS = 20;
const MAX_FRAGMENTS = 80;
/** Fragment cloud semi-major axis, in victim radii, along the tidal axis. */
const STREAM_ELONGATION = 3;

export interface TidalDisruptionEvent {
  disruptedBody: string;
  disruptorBody: string;
  fragments: CelestialBody[];
  timestamp: number;
}

/** Deterministic PRNG so a given disruption reproduces exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string, used to seed per-body PRNGs. */
function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Self-gravitational acceleration at the victim's own surface: a = Gm/R².
 * This is what holds it together.
 */
export function selfGravityAtSurface(body: CelestialBody, G: number): number {
  if (body.radius <= 0) return Infinity;
  return (G * body.mass) / (body.radius * body.radius);
}

/**
 * Differential (tidal) acceleration across the victim's diameter due to the
 * disruptor at distance d: a ≈ 2GMR/d³.
 */
export function tidalAccelerationAcross(
  disruptorMass: number,
  victimRadius: number,
  distance: number,
  G: number
): number {
  if (distance <= 0) return Infinity;
  return (2 * G * disruptorMass * victimRadius) / (distance * distance * distance);
}

/**
 * Decides whether `victim` should be torn apart by `disruptor` right now.
 *
 * Requires all of: a big enough mass ratio, the victim being inside the
 * Roche limit, and — the physically decisive test — the tidal acceleration
 * across the victim exceeding its own surface self-gravity. Black holes are
 * never disrupted (they have no material structure to shear).
 */
export function shouldDisrupt(
  victim: CelestialBody,
  disruptor: CelestialBody,
  G: number
): boolean {
  if (victim.isBlackHole || victim.isFixed) return false;
  if (victim.mass <= 0 || victim.radius <= 0) return false;
  if (disruptor.mass < victim.mass * MIN_MASS_RATIO) return false;

  const distance = length(sub(victim.position, disruptor.position));
  if (distance <= 0) return false;

  const limit = rocheLimit(disruptor, victim);
  if (limit <= 0 || distance > limit) return false;

  return (
    tidalAccelerationAcross(disruptor.mass, victim.radius, distance, G) >
    selfGravityAtSurface(victim, G)
  );
}

/**
 * Fragment masses following m_k ∝ k^(-1.8), renormalized to sum exactly to
 * `totalMass` so the disruption conserves mass to floating-point precision.
 */
function fragmentMasses(totalMass: number, count: number): number[] {
  const weights: number[] = [];
  let sum = 0;
  for (let k = 1; k <= count; k++) {
    const w = Math.pow(k, -FRAGMENT_SLOPE);
    weights.push(w);
    sum += w;
  }
  return weights.map((w) => (w / sum) * totalMass);
}

/** Any unit vector perpendicular to `v`. */
function perpendicular(v: Vector3D): Vector3D {
  const seed: Vector3D =
    Math.abs(v.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const p = cross(v, seed);
  const len = length(p);
  return len > 1e-12 ? scale(p, 1 / len) : { x: 0, y: 1, z: 0 };
}

/**
 * Builds the fragment cloud replacing `victim`.
 *
 * Fragments are spread along the tidal axis (victim → disruptor) inside a
 * prolate ellipsoid, and given a velocity shear proportional to their offset
 * along that axis: material nearer the disruptor orbits faster and runs
 * ahead, material further out lags. That shear is the entire origin of the
 * two-tailed stream.
 *
 * Total momentum is preserved exactly: the mass-weighted mean of the
 * fragment velocity perturbations is subtracted off before returning.
 */
export function generateFragments(
  victim: CelestialBody,
  disruptor: CelestialBody,
  G: number,
  timestamp: number
): CelestialBody[] {
  const rng = mulberry32(hashString(victim.id) ^ (timestamp & 0xffffffff));

  // More massive victims shatter into more pieces.
  const massDecades = Math.log10(Math.max(victim.mass, 1e-12) + 1);
  const count = Math.round(
    Math.max(MIN_FRAGMENTS, Math.min(MAX_FRAGMENTS, MIN_FRAGMENTS + massDecades * 24))
  );

  const toDisruptor = sub(disruptor.position, victim.position);
  const distance = length(toDisruptor);
  if (distance < 1e-12) return [victim];
  const axis = scale(toDisruptor, 1 / distance);
  const perpA = perpendicular(axis);
  const perpB = cross(axis, perpA);

  const masses = fragmentMasses(victim.mass, count);
  const density = uniformDensity(victim.mass, victim.radius);

  // Keplerian shear scale: the velocity difference across the victim's own
  // diameter at this distance, v_shear ≈ (dv/dr)·R ≈ (1/2)·v_orb·(R/d).
  const vOrbital = Math.sqrt((G * disruptor.mass) / distance);
  const shearScale = 0.5 * vOrbital * (victim.radius / distance);

  const semiMajor = victim.radius * STREAM_ELONGATION;
  const semiMinor = victim.radius * 0.75;

  const fragments: CelestialBody[] = [];
  const perturbations: Vector3D[] = [];

  for (let i = 0; i < count; i++) {
    const mass = masses[i]!;
    // Uniform-ish fill of a prolate ellipsoid, elongated along `axis`.
    const u = rng() * 2 - 1;
    const theta = rng() * Math.PI * 2;
    const radial = Math.sqrt(Math.max(0, 1 - u * u)) * Math.cbrt(rng());

    const alongAxis = u * semiMajor;
    const offAxisA = radial * semiMinor * Math.cos(theta);
    const offAxisB = radial * semiMinor * Math.sin(theta);

    const offset = add(
      scale(axis, alongAxis),
      add(scale(perpA, offAxisA), scale(perpB, offAxisB))
    );

    // Shear: displacement along the tidal axis maps to a velocity kick along
    // the orbital direction, which is what separates leading from trailing.
    const orbitalDir = cross(axis, perpB);
    const shear = scale(orbitalDir, -(alongAxis / Math.max(semiMajor, 1e-9)) * shearScale);
    // A little isotropic dispersion so the stream isn't a perfect line.
    const dispersion = scale(
      add(scale(perpA, rng() - 0.5), scale(perpB, rng() - 0.5)),
      shearScale * 0.25
    );
    const perturbation = add(shear, dispersion);
    perturbations.push(perturbation);

    const radius = density > 0 ? Math.cbrt((3 * mass) / (4 * Math.PI * density)) : victim.radius / count;

    fragments.push({
      id: `${victim.id}-frag-${i}`,
      name: `${victim.name} fragment ${i + 1}`,
      mass,
      position: add(victim.position, offset),
      velocity: victim.velocity, // perturbation applied below, after centering
      color: varyBrightness(victim.color, rng),
      radius: Math.max(radius, 1e-4),
      isFragment: true,
    });
  }

  // Re-center both the positions and the velocity perturbations on their
  // mass-weighted means. The random ellipsoid fill is not mass-symmetric on
  // its own, so without this the cloud's center of mass and net momentum
  // would both drift away from the victim's — the disruption has to be
  // exactly conservative, since any offset is indistinguishable from a
  // spurious impulse in the subsequent N-body evolution.
  let meanPos: Vector3D = { x: 0, y: 0, z: 0 };
  let meanVel: Vector3D = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < fragments.length; i++) {
    const w = fragments[i]!.mass / victim.mass;
    meanPos = add(meanPos, scale(sub(fragments[i]!.position, victim.position), w));
    meanVel = add(meanVel, scale(perturbations[i]!, w));
  }
  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i]!;
    fragment.position = sub(fragment.position, meanPos);
    fragment.velocity = add(victim.velocity, sub(perturbations[i]!, meanVel));
  }

  return fragments;
}

/** Perturbs a hex color's brightness by up to ±20%. */
function varyBrightness(hex: string, rng: () => number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const value = parseInt(match[1]!, 16);
  const factor = 0.8 + rng() * 0.4;
  const clamp = (c: number) => Math.max(0, Math.min(255, Math.round(c * factor)));
  const r = clamp((value >> 16) & 0xff);
  const g = clamp((value >> 8) & 0xff);
  const b = clamp(value & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Scans `state` for bodies that should be tidally disrupted and returns the
 * post-disruption body list plus the events that fired.
 *
 * Each body is disrupted at most once per call, by the heaviest disruptor
 * currently shredding it.
 */
export function detectAndResolveDisruptions(
  state: SystemState,
  timestamp: number = Date.now()
): { bodies: CelestialBody[]; events: TidalDisruptionEvent[] } {
  const { bodies, G } = state;
  const events: TidalDisruptionEvent[] = [];
  const result: CelestialBody[] = [];

  for (const victim of bodies) {
    // Fragments are already debris; re-shredding them would multiply the
    // body count without bound.
    if (victim.isFragment) {
      result.push(victim);
      continue;
    }

    let chosen: CelestialBody | null = null;
    for (const disruptor of bodies) {
      if (disruptor.id === victim.id) continue;
      if (!shouldDisrupt(victim, disruptor, G)) continue;
      if (!chosen || disruptor.mass > chosen.mass) chosen = disruptor;
    }

    if (!chosen) {
      result.push(victim);
      continue;
    }

    const fragments = generateFragments(victim, chosen, G, timestamp);
    events.push({
      disruptedBody: victim.id,
      disruptorBody: chosen.id,
      fragments,
      timestamp,
    });
    result.push(...fragments);
  }

  return { bodies: result, events };
}
