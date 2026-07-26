/**
 * Classical (Keplerian) orbital elements, computed from a body's
 * instantaneous state vector (r, v) relative to a chosen primary body.
 *
 * All angles are returned in radians; callers format for display (the
 * BodyInspector UI converts inclination/RAAN/argument-of-periapsis to
 * degrees).
 */

import type { CelestialBody, Vector3D } from "./types";
import { add, cross, dot, length, scale, sub } from "./vector";

export type OrbitType = "circular" | "elliptical" | "parabolic" | "hyperbolic";

export interface OrbitalElements {
  semiMajorAxis: number;
  eccentricity: number;
  /** Radians. */
  inclination: number;
  /** Radians. */
  raan: number;
  /** Radians. */
  argPeriapsis: number;
  /** Radians. */
  trueAnomaly: number;
  /** Orbital period, in simulation time units. Infinity for unbound orbits. */
  period: number;
  /** Infinity for parabolic/hyperbolic orbits (they never return). */
  apoapsisDistance: number;
  periapsisDistance: number;
  orbitType: OrbitType;
}

const EPS = 1e-9;

/**
 * Computes the six classical orbital elements of `body` relative to
 * `primary`, given the shared gravitational parameter `G`.
 *
 * Returns `null` if the body has (numerically) zero relative distance or
 * velocity relative to the primary, or if the primary's mass is zero — the
 * orbit is undefined in those degenerate cases.
 */
export function computeOrbitalElements(
  body: CelestialBody,
  primary: CelestialBody,
  G: number
): OrbitalElements | null {
  const mu = G * primary.mass;
  if (mu <= 0) return null;

  const r_vec = sub(body.position, primary.position);
  const v_vec = sub(body.velocity, primary.velocity);
  const r = length(r_vec);
  const v = length(v_vec);
  if (r < EPS) return null;

  const h_vec = cross(r_vec, v_vec);
  const h = length(h_vec);
  if (h < EPS) return null; // degenerate: purely radial trajectory

  // Semi-major axis from the vis-viva (energy) equation.
  const invA = 2 / r - (v * v) / mu;
  const semiMajorAxis = Math.abs(invA) < EPS ? Infinity : 1 / invA;

  // Eccentricity vector.
  const e_vec = scale(
    sub(scale(r_vec, v * v - mu / r), scale(v_vec, dot(r_vec, v_vec))),
    1 / mu
  );
  const eccentricity = length(e_vec);

  // Inclination: angle between the angular-momentum vector and +Z.
  const inclination = Math.acos(clamp(h_vec.z / h, -1, 1));

  // Node vector: points toward the ascending node, n = k x h.
  const n_vec: Vector3D = { x: -h_vec.y, y: h_vec.x, z: 0 };
  const n = length(n_vec);

  let raan = 0;
  if (n > EPS) {
    raan = Math.acos(clamp(n_vec.x / n, -1, 1));
    if (n_vec.y < 0) raan = 2 * Math.PI - raan;
  }

  let argPeriapsis = 0;
  if (n > EPS && eccentricity > EPS) {
    argPeriapsis = Math.acos(clamp(dot(n_vec, e_vec) / (n * eccentricity), -1, 1));
    if (e_vec.z < 0) argPeriapsis = 2 * Math.PI - argPeriapsis;
  }

  let trueAnomaly: number;
  if (eccentricity > EPS) {
    trueAnomaly = Math.acos(clamp(dot(e_vec, r_vec) / (eccentricity * r), -1, 1));
    if (dot(r_vec, v_vec) < 0) trueAnomaly = 2 * Math.PI - trueAnomaly;
  } else {
    // Near-circular: measure the angle from the ascending node instead,
    // since the eccentricity vector direction is numerically meaningless.
    const reference = n > EPS ? n_vec : { x: 1, y: 0, z: 0 };
    const refLen = n > EPS ? n : 1;
    trueAnomaly = Math.acos(clamp(dot(reference, r_vec) / (refLen * r), -1, 1));
    if (r_vec.z < 0) trueAnomaly = 2 * Math.PI - trueAnomaly;
  }

  const orbitType: OrbitType =
    eccentricity < 1e-3
      ? "circular"
      : Math.abs(eccentricity - 1) < 1e-3
        ? "parabolic"
        : eccentricity < 1
          ? "elliptical"
          : "hyperbolic";

  const bound = eccentricity < 1 && semiMajorAxis > 0;
  const period = bound ? 2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / mu) : Infinity;
  const apoapsisDistance = bound ? semiMajorAxis * (1 + eccentricity) : Infinity;
  const periapsisDistance = bound
    ? semiMajorAxis * (1 - eccentricity)
    : semiMajorAxis * (1 - eccentricity); // valid for hyperbolic too (a<0, e>1 -> positive)

  return {
    semiMajorAxis,
    eccentricity,
    inclination,
    raan,
    argPeriapsis,
    trueAnomaly,
    period,
    apoapsisDistance,
    periapsisDistance,
    orbitType,
  };
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

/** Picks the most massive `isFixed` (or, failing that, most massive overall) body as the default primary. */
export function inferPrimaryBody(bodies: CelestialBody[]): CelestialBody | null {
  if (bodies.length === 0) return null;
  const fixed = bodies.filter((b) => b.isFixed);
  const pool = fixed.length > 0 ? fixed : bodies;
  return pool.reduce((heaviest, b) => (b.mass > heaviest.mass ? b : heaviest), pool[0]!);
}

// `add` is re-exported for callers that build reference frames from these
// elements (e.g. OrbitEllipse.tsx) without importing vector.ts directly.
export { add };
