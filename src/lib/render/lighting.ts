/**
 * Where the light comes from.
 *
 * The atmosphere shader's terminator, the surface shading and the god-ray
 * source all have to agree about the primary light, or a planet ends up with
 * its halo on the night side. This module is that agreement: one function
 * that picks the dominant star, and one that gives the illumination direction
 * at a point.
 *
 * When there is no star-like body (a pure three-body toy, a galaxy collision)
 * the scene falls back to a fixed directional light — the same one the
 * original renderer used — for exactly the reason the old comment gave: a
 * point light centred on a body lights that body from inside itself.
 */

import * as THREE from "three";
import type { CelestialBody } from "@/lib/physics/types";

/** Fallback key-light position, unchanged from the pre-overhaul scene. */
export const FALLBACK_LIGHT_POSITION: readonly [number, number, number] = [60, 90, 40];

/** Normalised surface→light direction for the fallback light. */
export const FALLBACK_LIGHT_DIRECTION = new THREE.Vector3(
  ...FALLBACK_LIGHT_POSITION
).normalize();

/** A body must hold at least this share of system mass to count as the star. */
const STAR_MASS_FRACTION = 0.3;

/**
 * The body acting as the scene's primary light source: the most massive body
 * that dominates the system, or a fixed body if one is anchored. Returns null
 * when no body dominates, which is the signal to use the fallback light.
 */
export function dominantStar(bodies: CelestialBody[]): CelestialBody | null {
  let totalMass = 0;
  for (const body of bodies) totalMass += body.mass;
  if (totalMass <= 0) return null;

  let best: CelestialBody | null = null;
  for (const body of bodies) {
    // Black holes emit nothing; their accretion disk is drawn separately and
    // treating one as a key light would flood the scene from a black object.
    if (body.isBlackHole || body.isFragment) continue;
    if (!body.isFixed && body.mass / totalMass < STAR_MASS_FRACTION) continue;
    if (!best || body.mass > best.mass) best = body;
  }
  return best;
}

/**
 * Writes the normalised surface→light direction at `point` into `out`.
 *
 * With a real star this is genuinely per-body: Earth and Neptune see the Sun
 * in different directions, and using one global direction would put their
 * terminators in the same place regardless of orbital phase.
 */
export function lightDirectionAt(
  point: THREE.Vector3,
  star: CelestialBody | null,
  out: THREE.Vector3
): THREE.Vector3 {
  if (!star) return out.copy(FALLBACK_LIGHT_DIRECTION);
  out.set(star.position.x, star.position.y, star.position.z).sub(point);
  const lengthSq = out.lengthSq();
  // Degenerate only when the body *is* the star, in which case any direction
  // works — the star is drawn emissive and never reads its own terminator.
  if (lengthSq < 1e-12) return out.copy(FALLBACK_LIGHT_DIRECTION);
  return out.multiplyScalar(1 / Math.sqrt(lengthSq));
}
