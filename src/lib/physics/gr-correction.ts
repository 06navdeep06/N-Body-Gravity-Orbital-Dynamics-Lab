/**
 * Leading-order post-Newtonian (1PN / Schwarzschild) correction —
 * the same effect responsible for Mercury's perihelion advance. This is a
 * perturbative acceleration added on top of Newtonian gravity, not a full
 * GR integration:
 *
 *   a_GR = (GM / (r^2 c^2)) * [ (4GM/r - v^2) * r_hat + 4(v . r_hat) * v ]
 *
 * where r_hat points from the central body outward to the orbiting body,
 * and v is the orbiting body's velocity relative to the central body.
 */

import type { AccelerationFn } from "./rk4";
import { calculateAccelerations } from "./rk4";
import type { CelestialBody, Vector3D } from "./types";
import { add, dot, length, scale, sub } from "./vector";

const EPS = 1e-9;

/** GR correction acceleration on `body` due to `centralBody`. */
export function grCorrectionAcceleration(
  body: CelestialBody,
  centralBody: CelestialBody,
  G: number,
  c: number
): Vector3D {
  const r_vec = sub(body.position, centralBody.position);
  const r = length(r_vec);
  if (r < EPS || c <= 0) return { x: 0, y: 0, z: 0 };

  const r_hat = scale(r_vec, 1 / r);
  const v_vec = sub(body.velocity, centralBody.velocity);
  const v2 = dot(v_vec, v_vec);

  const mu = G * centralBody.mass;
  const radialTerm = scale(r_hat, 4 * mu / r - v2);
  const velocityTerm = scale(v_vec, 4 * dot(v_vec, r_hat));

  return scale(add(radialTerm, velocityTerm), mu / (r * r * c * c));
}

/**
 * Newtonian gravity plus a pairwise-summed GR correction: for every
 * ordered pair (i, j), body i receives `grCorrectionAcceleration(i, j)` in
 * addition to the usual softened Newtonian term. This generalizes the
 * two-body Schwarzschild correction to N bodies the same way pairwise
 * Newtonian forces generalize to N-body gravity — an approximation, but
 * the right leading-order behavior for near-Keplerian systems (e.g. a
 * light planet orbiting a dominant central mass).
 *
 * O(N^2), same as `calculateAccelerations` — the octree's far-field
 * approximation isn't compatible with this pairwise correction, so GR mode
 * always uses direct summation.
 */
export const calculateAccelerationsWithGR: (c: number) => AccelerationFn =
  (c: number) => (bodies: CelestialBody[], G: number, softening: number): Vector3D[] => {
    const newtonian = calculateAccelerations(bodies, G, softening);

    return bodies.map((bodyI, i) => {
      let acc = newtonian[i]!;
      for (let j = 0; j < bodies.length; j++) {
        if (i === j) continue;
        acc = add(acc, grCorrectionAcceleration(bodyI, bodies[j]!, G, c));
      }
      return acc;
    });
  };
