/**
 * Tidal-physics helpers: Hill sphere (gravitational sphere of influence),
 * Roche limit (fluid-body tidal disruption distance), and the tidal
 * acceleration gradient used for visualization.
 */

import type { CelestialBody } from "./types";
import { length, sub } from "./vector";

/**
 * Hill sphere radius: r_H = a * (m / 3M)^(1/3), where `a` is the orbital
 * distance from the primary (we use the current separation as a stand-in
 * for the semi-major axis, which is exact for circular orbits).
 */
export function hillSphereRadius(body: CelestialBody, primary: CelestialBody): number {
  if (primary.mass <= 0 || body.mass <= 0) return 0;
  const a = length(sub(body.position, primary.position));
  return a * Math.cbrt(body.mass / (3 * primary.mass));
}

/** Uniform density from mass and radius: rho = 3m / (4 pi R^3). */
export function uniformDensity(mass: number, radius: number): number {
  if (radius <= 0) return 0;
  return (3 * mass) / (4 * Math.PI * radius ** 3);
}

/**
 * Fluid-body Roche limit around `primary` for a satellite of density
 * `satelliteDensity`: d = 2.44 * R_primary * (rho_primary / rho_satellite)^(1/3).
 */
export function rocheLimit(primary: CelestialBody, satellite: CelestialBody): number {
  const rhoPrimary = uniformDensity(primary.mass, primary.radius);
  const rhoSatellite = uniformDensity(satellite.mass, satellite.radius);
  if (rhoPrimary <= 0 || rhoSatellite <= 0) return 0;
  return 2.44 * primary.radius * Math.cbrt(rhoPrimary / rhoSatellite);
}

/**
 * Roche limit for a "typical" satellite: uses the density of the least
 * dense non-primary body in the system, so a single ring can be drawn
 * around each massive primary without picking a specific satellite.
 */
export function rocheLimitForSystem(primary: CelestialBody, others: CelestialBody[]): number {
  const candidates = others.filter((b) => b.id !== primary.id && b.mass > 0 && b.radius > 0);
  if (candidates.length === 0) return 0;
  const leastDense = candidates.reduce((min, b) =>
    uniformDensity(b.mass, b.radius) < uniformDensity(min.mass, min.radius) ? b : min
  );
  return rocheLimit(primary, leastDense);
}

/**
 * Leading-order tidal acceleration magnitude at offset `deltaR` from a
 * body's center, due to mass `distantMass` at distance `d`:
 * a_tidal ≈ 2 G M δr / d³.
 */
export function tidalAcceleration(
  distantMass: number,
  distance: number,
  deltaR: number,
  G: number
): number {
  if (distance <= 0) return 0;
  return (2 * G * distantMass * deltaR) / distance ** 3;
}
